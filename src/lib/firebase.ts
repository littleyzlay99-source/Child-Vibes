import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfigJson from '../../firebase-applet-config.json';

// Support both static json config and Cloudflare environment variables (trimmed against copy/paste whitespace)
const viteEnv = (import.meta as any)?.env || {};
function cleanEnvString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const resolvedConfig = {
  projectId: cleanEnvString(viteEnv.VITE_FIREBASE_PROJECT_ID) || firebaseConfigJson.projectId,
  appId: cleanEnvString(viteEnv.VITE_FIREBASE_APP_ID) || firebaseConfigJson.appId,
  apiKey: cleanEnvString(viteEnv.VITE_FIREBASE_API_KEY) || firebaseConfigJson.apiKey,
  authDomain: cleanEnvString(viteEnv.VITE_FIREBASE_AUTH_DOMAIN) || firebaseConfigJson.authDomain,
  firestoreDatabaseId:
    cleanEnvString(viteEnv.VITE_FIREBASE_DATABASE_ID) ||
    firebaseConfigJson.firestoreDatabaseId ||
    '(default)',
  storageBucket:
    cleanEnvString(viteEnv.VITE_FIREBASE_STORAGE_BUCKET) || firebaseConfigJson.storageBucket,
  messagingSenderId:
    cleanEnvString(viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID) ||
    firebaseConfigJson.messagingSenderId,
};

export const FIREBASE_PROJECT_ID = resolvedConfig.projectId;
export const FIREBASE_DATABASE_ID = resolvedConfig.firestoreDatabaseId;

const app = getApps().length === 0 ? initializeApp(resolvedConfig) : getApp();
export const db = getFirestore(app, resolvedConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  errorCode: string;
  error: string;
  operationType: OperationType;
  path: string | null;
  authState: {
    isAuthenticated: boolean;
    isAnonymous: boolean | null;
    providerIds: string[];
  };
}

export function redactPiiFromMessage(raw: string): string {
  return raw
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [redacted-token]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
    .slice(0, 240);
}

export function redactFirestorePath(path: string | null): string | null {
  if (!path) return null;
  // Redact user UIDs in paths such as users/<uid> while keeping collection context clear
  return path.replace(/^users\/[^/]+/, 'users/[redacted-user]');
}

export function extractFirebaseErrorCode(error: unknown): string {
  const rawCode = (error as { code?: unknown })?.code;
  if (typeof rawCode === 'string' && rawCode.trim()) {
    const cleaned = rawCode.trim().toLowerCase();
    return cleaned.startsWith('firestore/') ? cleaned.slice('firestore/'.length) : cleaned;
  }
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (msg.includes('missing or insufficient permissions')) return 'permission-denied';
  if (msg.includes('unauthenticated')) return 'unauthenticated';
  if (msg.includes('failed-precondition') || msg.includes('failed precondition')) {
    return 'failed-precondition';
  }
  return 'unknown';
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    errorCode: extractFirebaseErrorCode(error),
    error: redactPiiFromMessage(rawMessage),
    authState: {
      isAuthenticated: Boolean(auth.currentUser?.uid),
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      providerIds:
        auth.currentUser?.providerData
          ?.map((provider) => provider.providerId)
          .filter((id): id is string => Boolean(id)) || [],
    },
    operationType,
    path: redactFirestorePath(path),
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test initial connection as required by Firebase skill
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase configuration notice: the client is currently offline or connecting.');
    }
  }
}
testConnection();

export { signInWithPopup, signOut };
