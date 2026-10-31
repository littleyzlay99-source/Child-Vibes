import type { MultiplayerPlayerInit } from '../../../../src/games/snow-rush/engine/multiplayerTypes';
import {
  isValidSnowRushRoomId,
  SNOW_RUSH_WS_CLOSE_CODES,
} from '../../../../src/games/snow-rush/network/protocol';
import type {
  SnowRushNetworkErrorCode,
  SnowRushWsCloseCode,
} from '../../../../src/games/snow-rush/network/protocol';

/**
 * Snow Rush: Avalanche Escape — Step 4.7 Cryptographic Firebase Auth & Named Firestore Verifier
 *
 * Security Guarantees:
 * 1. Cryptographically verifies Firebase ID Tokens (RS256) via Web Crypto (`crypto.subtle`)
 *    against Google SecureToken public JWKS (`securetoken@system.gserviceaccount.com`).
 * 2. Strictly validates `alg === 'RS256'`, `kid`, `aud === FIREBASE_PROJECT_ID`,
 *    `iss === 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID`, `exp`, `iat`, and `sub` (UID).
 * 3. Queries the exact Named Firestore Database (`ai-studio-47dffdd9-9dac-40e5-b320-95d71826db89`,
 *    NEVER `(default)`) via Firestore REST v1 using the verified user's Bearer token — requiring
 *    ZERO service account private keys or secrets in the Worker!
 * 4. Fails closed on every network, signature, claim, or room status violation (zero unauthenticated fallback).
 */

export const GOOGLE_SECURETOKEN_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const CLOCK_SKEW_TOLERANCE_SEC = 30;
const MIN_JWKS_CACHE_TTL_MS = 60_000;
const DEFAULT_JWKS_CACHE_TTL_MS = 3_600_000;
const MAX_JWKS_CACHE_TTL_MS = 21_600_000;
const JWKS_ROTATION_MIN_REFRESH_INTERVAL_MS = 60_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface VerifiedFirebaseToken {
  readonly uid: string;
  readonly projectId: string;
  readonly issuedAtSec: number;
  readonly expiresAtSec: number;
  readonly rawToken: string;
}

export type TokenVerificationResult =
  | { readonly ok: true; readonly token: VerifiedFirebaseToken }
  | {
      readonly ok: false;
      readonly errorCode: SnowRushNetworkErrorCode;
      readonly closeCode: SnowRushWsCloseCode;
      readonly message: string;
    };

export interface VerifiedSnowRushRoom {
  readonly roomId: string;
  readonly gameType: 'snow_rush';
  readonly status: 'playing';
  readonly gameRound: number;
  readonly maxPlayers: number;
  readonly hostId: string;
  readonly players: readonly MultiplayerPlayerInit[];
}

export type RoomVerificationResult =
  | {
      readonly ok: true;
      readonly token: VerifiedFirebaseToken;
      readonly room: VerifiedSnowRushRoom;
    }
  | {
      readonly ok: false;
      readonly errorCode: SnowRushNetworkErrorCode;
      readonly closeCode: SnowRushWsCloseCode;
      readonly message: string;
    };

interface GoogleJwkEntry extends JsonWebKey {
  readonly kid?: string;
  readonly alg?: string;
  readonly kty?: string;
  readonly use?: string;
}

interface JwksCacheState {
  keysByKid: Map<string, CryptoKey>;
  fetchedAtMs: number;
  expiresAtMs: number;
}

let sharedJwksCache: JwksCacheState | null = null;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function clearJwksCacheForTests(): void {
  sharedJwksCache = null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const BASE64URL_SEGMENT_REGEX = /^[A-Za-z0-9_-]+$/;

function decodeBase64UrlToBytes(segment: string): Uint8Array | null {
  if (!segment || !BASE64URL_SEGMENT_REGEX.test(segment)) {
    return null;
  }
  const mod = segment.length % 4;
  if (mod === 1) {
    return null;
  }
  const padLength = mod === 0 ? 0 : 4 - mod;
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLength);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function parseMaxAgeMs(cacheControlHeader: string | null): number {
  if (!cacheControlHeader) {
    return DEFAULT_JWKS_CACHE_TTL_MS;
  }
  const match = /max-age=(\d+)/i.exec(cacheControlHeader);
  if (!match) {
    return DEFAULT_JWKS_CACHE_TTL_MS;
  }
  const sec = Number.parseInt(match[1], 10);
  if (!Number.isFinite(sec) || sec <= 0) {
    return DEFAULT_JWKS_CACHE_TTL_MS;
  }
  const ttlMs = sec * 1000;
  return Math.max(MIN_JWKS_CACHE_TTL_MS, Math.min(MAX_JWKS_CACHE_TTL_MS, ttlMs));
}

async function fetchAndCacheGoogleJwks(
  fetchFn: FetchLike,
  nowMs: number,
  jwksUrl: string
): Promise<Map<string, CryptoKey> | null> {
  let response: Response;
  try {
    response = await fetchFn(jwksUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }

  if (!isPlainRecord(body) || !Array.isArray(body.keys)) {
    return null;
  }

  const keysByKid = new Map<string, CryptoKey>();
  for (let i = 0; i < body.keys.length; i += 1) {
    const rawKey = body.keys[i];
    if (!isPlainRecord(rawKey)) continue;
    const jwk = rawKey as unknown as GoogleJwkEntry;
    if (
      typeof jwk.kid !== 'string' ||
      jwk.kid.length === 0 ||
      jwk.kty !== 'RSA' ||
      (jwk.alg !== undefined && jwk.alg !== 'RS256')
    ) {
      continue;
    }
    try {
      const cryptoKey = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      );
      keysByKid.set(jwk.kid, cryptoKey);
    } catch {
      // Skip malformed JWK entry
    }
  }

  if (keysByKid.size === 0) {
    return null;
  }

  const ttlMs = parseMaxAgeMs(response.headers.get('cache-control'));
  sharedJwksCache = {
    keysByKid,
    fetchedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  };
  return keysByKid;
}

async function resolveSigningKeyForKid(
  kid: string,
  fetchFn: FetchLike,
  nowMs: number,
  jwksUrl: string
): Promise<CryptoKey | null> {
  if (sharedJwksCache && nowMs < sharedJwksCache.expiresAtMs) {
    const cachedKey = sharedJwksCache.keysByKid.get(kid);
    if (cachedKey) {
      return cachedKey;
    }
    // Refresh at most once per minute if Google rotated signing keys mid-TTL
    if (nowMs - sharedJwksCache.fetchedAtMs < JWKS_ROTATION_MIN_REFRESH_INTERVAL_MS) {
      return null;
    }
  }

  const refreshed = await fetchAndCacheGoogleJwks(fetchFn, nowMs, jwksUrl);
  if (!refreshed) {
    return null;
  }
  return refreshed.get(kid) ?? null;
}

export interface VerifyFirebaseTokenOptions {
  readonly idToken: string;
  readonly expectedProjectId: string;
  readonly nowMs?: number;
  readonly fetchFn?: FetchLike;
  readonly jwksUrl?: string;
}

/**
 * Cryptographically verifies a Firebase Auth RS256 ID Token and validates all SecureToken claims.
 */
export async function verifyFirebaseIdToken(
  options: VerifyFirebaseTokenOptions
): Promise<TokenVerificationResult> {
  const {
    idToken,
    expectedProjectId,
    nowMs = Date.now(),
    fetchFn = fetch,
    jwksUrl = GOOGLE_SECURETOKEN_JWKS_URL,
  } = options;

  if (!expectedProjectId || typeof expectedProjectId !== 'string') {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Server Firebase Project ID configuration is missing.',
    };
  }

  if (typeof idToken !== 'string' || idToken.length < 32 || idToken.length > 16384) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Firebase ID token is missing or malformed.',
    };
  }

  const segments = idToken.split('.');
  if (segments.length !== 3) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'JWT must contain exactly 3 segments.',
    };
  }

  const [headerB64, payloadB64, signatureB64] = segments;
  const headerBytes = decodeBase64UrlToBytes(headerB64);
  const payloadBytes = decodeBase64UrlToBytes(payloadB64);
  const signatureBytes = decodeBase64UrlToBytes(signatureB64);

  if (!headerBytes || !payloadBytes || !signatureBytes || signatureBytes.byteLength < 64) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Invalid base64url JWT encoding.',
    };
  }

  let headerJson: unknown;
  let payloadJson: unknown;
  try {
    headerJson = JSON.parse(textDecoder.decode(headerBytes));
    payloadJson = JSON.parse(textDecoder.decode(payloadBytes));
  } catch {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Malformed JWT JSON header or payload.',
    };
  }

  if (!isPlainRecord(headerJson) || !isPlainRecord(payloadJson)) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'JWT header and payload must be JSON objects.',
    };
  }

  // Strictly enforce RS256 and non-empty kid (rejects `alg: "none"`, `HS256`, etc.)
  if (
    headerJson.alg !== 'RS256' ||
    typeof headerJson.kid !== 'string' ||
    headerJson.kid.trim().length === 0 ||
    headerJson.kid.length > 128
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Unsupported JWT algorithm or missing signing key ID.',
    };
  }

  const nowSec = Math.floor(nowMs / 1000);
  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;

  if (payloadJson.aud !== expectedProjectId) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Token audience (aud) does not match Firebase Project ID.',
    };
  }

  if (payloadJson.iss !== expectedIssuer) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Token issuer (iss) does not match Firebase SecureToken issuer.',
    };
  }

  if (
    typeof payloadJson.sub !== 'string' ||
    payloadJson.sub.trim().length === 0 ||
    payloadJson.sub.length > 128 ||
    payloadJson.sub !== payloadJson.sub.trim()
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Token subject (sub / UID) is missing or invalid.',
    };
  }

  if (typeof payloadJson.exp !== 'number' || !Number.isFinite(payloadJson.exp)) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Token expiration (exp) claim is missing.',
    };
  }

  if (payloadJson.exp <= nowSec) {
    return {
      ok: false,
      errorCode: 'EXPIRED_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Firebase ID token has expired.',
    };
  }

  if (
    typeof payloadJson.iat !== 'number' ||
    !Number.isFinite(payloadJson.iat) ||
    payloadJson.iat <= 0 ||
    payloadJson.iat > nowSec + CLOCK_SKEW_TOLERANCE_SEC
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Token issued-at (iat) claim is invalid or in the future.',
    };
  }

  if (
    payloadJson.auth_time !== undefined &&
    (typeof payloadJson.auth_time !== 'number' ||
      !Number.isFinite(payloadJson.auth_time) ||
      payloadJson.auth_time > nowSec + CLOCK_SKEW_TOLERANCE_SEC)
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Token auth_time claim is invalid.',
    };
  }

  // Cryptographic RS256 signature check against Google SecureToken JWKS
  const signingKey = await resolveSigningKeyForKid(headerJson.kid, fetchFn, nowMs, jwksUrl);
  if (!signingKey) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Unable to resolve Google SecureToken signing key for token kid.',
    };
  }

  const signingInputBytes = textEncoder.encode(`${headerB64}.${payloadB64}`);
  let signatureValid = false;
  try {
    signatureValid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      signingKey,
      toExactArrayBuffer(signatureBytes),
      toExactArrayBuffer(signingInputBytes)
    );
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Cryptographic RS256 token signature verification failed.',
    };
  }

  return {
    ok: true,
    token: {
      uid: payloadJson.sub,
      projectId: expectedProjectId,
      issuedAtSec: payloadJson.iat,
      expiresAtSec: payloadJson.exp,
      rawToken: idToken,
    },
  };
}

// ============================================================================
// Firestore REST v1 Value Parsers (Named Database Only)
// ============================================================================

function readFirestoreString(field: unknown): string | null {
  if (!isPlainRecord(field)) return null;
  return typeof field.stringValue === 'string' ? field.stringValue : null;
}

function readFirestoreInt(field: unknown): number | null {
  if (!isPlainRecord(field)) return null;
  if (typeof field.integerValue === 'string') {
    const parsed = Number.parseInt(field.integerValue, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof field.integerValue === 'number' && Number.isFinite(field.integerValue)) {
    return Math.floor(field.integerValue);
  }
  if (typeof field.doubleValue === 'number' && Number.isFinite(field.doubleValue)) {
    return Math.floor(field.doubleValue);
  }
  return null;
}

function readFirestoreRoomPlayers(field: unknown): MultiplayerPlayerInit[] {
  if (!isPlainRecord(field) || !isPlainRecord(field.arrayValue)) {
    return [];
  }
  const values = field.arrayValue.values;
  if (!Array.isArray(values)) {
    return [];
  }

  const seenUids = new Set<string>();
  const players: MultiplayerPlayerInit[] = [];

  for (let i = 0; i < values.length; i += 1) {
    const entry = values[i];
    if (!isPlainRecord(entry) || !isPlainRecord(entry.mapValue)) continue;
    const mapFields = entry.mapValue.fields;
    if (!isPlainRecord(mapFields)) continue;

    const uid = readFirestoreString(mapFields.uid)?.trim() ?? '';
    if (!uid || seenUids.has(uid)) continue;
    seenUids.add(uid);

    const displayName =
      readFirestoreString(mapFields.displayName)?.trim() ||
      readFirestoreString(mapFields.name)?.trim() ||
      `Racer ${players.length + 1}`;
    const color = readFirestoreString(mapFields.color)?.trim() || undefined;

    players.push({
      uid,
      displayName,
      color,
    });
  }

  return players;
}

export interface VerifySnowRushRoomAccessOptions {
  readonly roomId: string;
  readonly idToken: string;
  readonly projectId: string;
  readonly databaseId: string;
  readonly nowMs?: number;
  readonly fetchFn?: FetchLike;
  readonly jwksUrl?: string;
}

/**
 * End-to-end zero-secret room membership & state verification:
 * 1. Verifies RS256 Firebase ID Token via Google SecureToken JWKS.
 * 2. Reads `/rooms/{roomId}` from Named Firestore Database (`ai-studio-47dffdd9-9dac-40e5-b320-95d71826db89`)
 *    using the verified user's Bearer token.
 * 3. Enforces `gameType === 'snow_rush'`, `status === 'playing'`, `2 <= players.length <= 4`,
 *    and membership of `token.uid` in `room.players`.
 */
export async function verifySnowRushRoomAccess(
  options: VerifySnowRushRoomAccessOptions
): Promise<RoomVerificationResult> {
  const {
    roomId,
    idToken,
    projectId,
    databaseId,
    nowMs = Date.now(),
    fetchFn = fetch,
    jwksUrl,
  } = options;

  if (!isValidSnowRushRoomId(roomId)) {
    return {
      ok: false,
      errorCode: 'ROOM_NOT_FOUND',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.ROOM_NOT_FOUND,
      message: 'Invalid roomId format.',
    };
  }

  // Strictly forbid empty or `(default)` Firestore database IDs
  if (!databaseId || databaseId.trim().length === 0 || databaseId.trim() === '(default)') {
    return {
      ok: false,
      errorCode: 'ROOM_VERIFY_FAILED',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.FORBIDDEN_ROOM,
      message: 'Named Firestore database ID is required; (default) database is forbidden.',
    };
  }

  const tokenResult = await verifyFirebaseIdToken({
    idToken,
    expectedProjectId: projectId,
    nowMs,
    fetchFn,
    jwksUrl,
  });

  if (!tokenResult.ok) {
    return tokenResult;
  }

  const firestoreDocUrl =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/databases/${encodeURIComponent(databaseId)}/documents/rooms/${encodeURIComponent(roomId)}`;

  let roomResp: Response;
  try {
    roomResp = await fetchFn(firestoreDocUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenResult.token.rawToken}`,
        Accept: 'application/json',
      },
    });
  } catch {
    return {
      ok: false,
      errorCode: 'ROOM_VERIFY_FAILED',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.FORBIDDEN_ROOM,
      message: 'Failed to reach Firestore to verify room state.',
    };
  }

  if (roomResp.status === 404) {
    return {
      ok: false,
      errorCode: 'ROOM_NOT_FOUND',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.ROOM_NOT_FOUND,
      message: 'Room document does not exist in Firestore.',
    };
  }

  if (roomResp.status === 401) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      message: 'Firestore rejected the provided Firebase ID token.',
    };
  }

  if (!roomResp.ok) {
    return {
      ok: false,
      errorCode: 'ROOM_VERIFY_FAILED',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.FORBIDDEN_ROOM,
      message: `Firestore room lookup failed with HTTP ${roomResp.status}.`,
    };
  }

  let docJson: unknown;
  try {
    docJson = await roomResp.json();
  } catch {
    return {
      ok: false,
      errorCode: 'ROOM_VERIFY_FAILED',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.FORBIDDEN_ROOM,
      message: 'Malformed JSON from Firestore room lookup.',
    };
  }

  if (!isPlainRecord(docJson) || !isPlainRecord(docJson.fields)) {
    return {
      ok: false,
      errorCode: 'ROOM_VERIFY_FAILED',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.FORBIDDEN_ROOM,
      message: 'Firestore room document is missing fields.',
    };
  }

  const fields = docJson.fields;
  const gameType = readFirestoreString(fields.gameType);
  if (gameType !== 'snow_rush') {
    return {
      ok: false,
      errorCode: 'WRONG_GAME_TYPE',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.ROOM_INVALID_STATE,
      message: `Room gameType "${gameType ?? 'unknown'}" is not "snow_rush".`,
    };
  }

  const status = readFirestoreString(fields.status);
  if (status === 'finished') {
    return {
      ok: false,
      errorCode: 'ROOM_ALREADY_FINISHED',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.ROOM_INVALID_STATE,
      message: 'Snow Rush room has already finished.',
    };
  }

  if (status !== 'playing') {
    return {
      ok: false,
      errorCode: 'ROOM_NOT_PLAYING',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.ROOM_INVALID_STATE,
      message: `Snow Rush room status must be "playing" (got "${status ?? 'unknown'}").`,
    };
  }

  const maxPlayersRaw = readFirestoreInt(fields.maxPlayers) ?? 4;
  const maxPlayers = Math.max(2, Math.min(4, maxPlayersRaw));
  const players = readFirestoreRoomPlayers(fields.players);

  if (players.length < 2 || players.length > 4 || players.length > maxPlayers) {
    return {
      ok: false,
      errorCode: 'ROOM_CAPACITY_INVALID',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.ROOM_INVALID_STATE,
      message: `Snow Rush requires 2–4 room players (found ${players.length}).`,
    };
  }

  const isMember = players.some((p) => p.uid === tokenResult.token.uid);
  if (!isMember) {
    return {
      ok: false,
      errorCode: 'NOT_ROOM_MEMBER',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.FORBIDDEN_ROOM,
      message: 'Authenticated user UID is not a member of this Snow Rush room.',
    };
  }

  const gameRoundRaw = readFirestoreInt(fields.gameRound) ?? 1;
  const gameRound = Math.max(1, gameRoundRaw);
  const hostId = readFirestoreString(fields.hostId) ?? players[0].uid;

  return {
    ok: true,
    token: tokenResult.token,
    room: {
      roomId,
      gameType: 'snow_rush',
      status: 'playing',
      gameRound,
      maxPlayers,
      hostId,
      players,
    },
  };
}
