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
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
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
