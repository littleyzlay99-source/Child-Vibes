import { sanitizeClientInputPayload } from '../engine/multiplayerSimulation';
import type {
  MultiplayerRaceEvent,
  RaceFinishState,
  SnowRushInputFrame,
  SnowRushSnapshot,
  SnowRushSteerAxis,
} from '../engine/multiplayerTypes';

/**
 * Snow Rush: Avalanche Escape — Step 4.7 Shared Wire Protocol
 *
 * 100% Pure TypeScript Runtime-Agnostic Contract shared between:
 * - Frontend WebSocket Client (`src/games/snow-rush/network/`)
 * - Companion Cloudflare Worker & Durable Object (`workers/snow-rush-server/`)
 *
 * Zero DOM / Browser / React / Firebase SDK dependencies.
 */

export const SNOW_RUSH_PROTOCOL_VERSION = 1 as const;

/** Maximum allowed inbound UTF-8 WebSocket frame size (2 KB). */
export const SNOW_RUSH_WS_MAX_MESSAGE_BYTES = 2048;

/** Maximum allowed messages per second per WebSocket before dropping. */
export const SNOW_RUSH_WS_SOFT_RATE_LIMIT_PER_SEC = 30;

/** Hard flood ceiling per second per WebSocket before closing with 4429. */
export const SNOW_RUSH_WS_HARD_RATE_LIMIT_PER_SEC = 45;

/** Client input send rate cap (20 Hz = 50 ms minimum interval). */
export const SNOW_RUSH_CLIENT_INPUT_SEND_HZ = 20;
export const SNOW_RUSH_CLIENT_INPUT_MIN_INTERVAL_MS = 50;

/** Client RTT measurement ping cadence (every 5 seconds). */
export const SNOW_RUSH_CLIENT_PING_INTERVAL_MS = 5000;

/** Server unauthenticated WebSocket grace timeout before closing with 4401. */
export const SNOW_RUSH_SERVER_AUTH_TIMEOUT_MS = 5000;

/** Configurable server snapshot broadcast bounds (10–20 Hz, default 10 Hz for Free-tier efficiency). */
export const SNOW_RUSH_MIN_SNAPSHOT_HZ = 10;
export const SNOW_RUSH_MAX_SNAPSHOT_HZ = 20;
export const SNOW_RUSH_DEFAULT_SNAPSHOT_HZ = 10;

/**
 * Private-use WebSocket close codes (3000–4999 per RFC 6455 / WHATWG WebSocket spec).
 * All codes are valid in `ws.close(code, reason)` across Browser, Node.js, and Cloudflare Workers.
 */
export const SNOW_RUSH_WS_CLOSE_CODES = {
  NORMAL: 1000,
  RACE_COMPLETED: 4000,
  BAD_REQUEST: 4400,
  UNAUTHORIZED: 4401,
  FORBIDDEN_ROOM: 4403,
  ROOM_NOT_FOUND: 4404,
  DUPLICATE_SESSION: 4409,
  ROOM_INVALID_STATE: 4412,
  PAYLOAD_TOO_LARGE: 4413,
  RATE_LIMITED: 4429,
} as const;

export type SnowRushWsCloseCode =
  (typeof SNOW_RUSH_WS_CLOSE_CODES)[keyof typeof SNOW_RUSH_WS_CLOSE_CODES];

export type SnowRushNetworkErrorCode =
  | 'AUTH_TIMEOUT'
  | 'INVALID_TOKEN'
  | 'EXPIRED_TOKEN'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_VERIFY_FAILED'
  | 'WRONG_GAME_TYPE'
  | 'ROOM_NOT_PLAYING'
  | 'ROOM_ALREADY_FINISHED'
  | 'NOT_ROOM_MEMBER'
  | 'ROOM_CAPACITY_INVALID'
  | 'ROOM_ROUND_MISMATCH'
  | 'DUPLICATE_SESSION_REPLACED'
  | 'UNAUTHENTICATED_MESSAGE'
  | 'MESSAGE_TOO_LARGE'
  | 'INVALID_JSON'
  | 'UNKNOWN_MESSAGE_TYPE'
  | 'INVALID_PAYLOAD'
  | 'RATE_LIMIT_EXCEEDED'
  | 'PROTOCOL_MISMATCH';

// ============================================================================
// Client -> Server Messages
// ============================================================================

export interface SnowRushClientAuthMessage {
  readonly type: 'auth';
  readonly protocolVersion: typeof SNOW_RUSH_PROTOCOL_VERSION;
  readonly roomId: string;
  readonly idToken: string;
}

export interface SnowRushClientInputMessage {
  readonly type: 'input';
  readonly seq: number;
  readonly steer: SnowRushSteerAxis;
  readonly jumpPressed: boolean;
  readonly useItemPressed: boolean;
}

export interface SnowRushClientPingMessage {
  readonly type: 'ping';
  readonly clientSentAtMs: number;
}

export interface SnowRushClientRequestSnapshotMessage {
  readonly type: 'request_snapshot';
}

export type SnowRushClientMessage =
  | SnowRushClientAuthMessage
  | SnowRushClientInputMessage
  | SnowRushClientPingMessage
  | SnowRushClientRequestSnapshotMessage;

// ============================================================================
// Server -> Client Messages
// ============================================================================

export interface SnowRushServerWelcomeMessage {
  readonly type: 'welcome';
  readonly protocolVersion: typeof SNOW_RUSH_PROTOCOL_VERSION;
  readonly roomId: string;
  readonly gameRound: number;
  readonly uid: string;
  readonly snapshotHz: number;
  readonly serverTimeMs: number;
  readonly snapshot: SnowRushSnapshot;
}

export interface SnowRushServerSnapshotMessage {
  readonly type: 'snapshot';
  readonly serverTimeMs: number;
  readonly snapshot: SnowRushSnapshot;
  readonly events?: readonly MultiplayerRaceEvent[];
}

export interface SnowRushServerPongMessage {
  readonly type: 'pong';
  readonly clientSentAtMs: number;
  readonly serverTimeMs: number;
}

export interface SnowRushServerPlayerConnectionMessage {
  readonly type: 'player_connection';
  readonly uid: string;
  readonly isConnected: boolean;
  readonly connectedCount: number;
}

export interface SnowRushServerRaceFinishedMessage {
  readonly type: 'race_finished';
  readonly roomId: string;
  readonly gameRound: number;
  readonly finishState: RaceFinishState;
  readonly snapshot: SnowRushSnapshot;
}

export interface SnowRushServerErrorMessage {
  readonly type: 'error';
  readonly code: SnowRushNetworkErrorCode;
  readonly message: string;
  readonly fatal: boolean;
}

export type SnowRushServerMessage =
  | SnowRushServerWelcomeMessage
  | SnowRushServerSnapshotMessage
  | SnowRushServerPongMessage
  | SnowRushServerPlayerConnectionMessage
  | SnowRushServerRaceFinishedMessage
  | SnowRushServerErrorMessage;

// ============================================================================
// Validation & Parsing Helpers
// ============================================================================

const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const sharedTextEncoder = new TextEncoder();

export function isValidSnowRushRoomId(roomId: unknown): roomId is string {
  return typeof roomId === 'string' && ROOM_ID_PATTERN.test(roomId);
}

export function getUtf8ByteLength(text: string): number {
  return sharedTextEncoder.encode(text).byteLength;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type ParsedClientMessageResult =
  | { readonly ok: true; readonly message: SnowRushClientMessage }
  | {
      readonly ok: false;
      readonly errorCode: SnowRushNetworkErrorCode;
      readonly closeCode: SnowRushWsCloseCode;
      readonly reason: string;
    };

/**
 * Strictly validates and sanitizes raw client WebSocket text frames.
 * - Rejects frames > 2048 UTF-8 bytes
 * - Rejects malformed JSON or non-object payloads
 * - Rejects unknown `type` values
 * - Strips untrusted client state claims on `input` via `sanitizeClientInputPayload`
 */
export function parseSnowRushClientMessage(rawText: string): ParsedClientMessageResult {
  if (typeof rawText !== 'string') {
    return {
      ok: false,
      errorCode: 'INVALID_PAYLOAD',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.BAD_REQUEST,
      reason: 'Text WebSocket frame required.',
    };
  }

  const byteLen = getUtf8ByteLength(rawText);
  if (byteLen > SNOW_RUSH_WS_MAX_MESSAGE_BYTES) {
    return {
      ok: false,
      errorCode: 'MESSAGE_TOO_LARGE',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.PAYLOAD_TOO_LARGE,
      reason: `Message exceeds ${SNOW_RUSH_WS_MAX_MESSAGE_BYTES} byte limit (${byteLen} bytes).`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      errorCode: 'INVALID_JSON',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.BAD_REQUEST,
      reason: 'Malformed JSON payload.',
    };
  }

  if (!isPlainObject(parsed) || typeof parsed.type !== 'string') {
    return {
      ok: false,
      errorCode: 'INVALID_PAYLOAD',
      closeCode: SNOW_RUSH_WS_CLOSE_CODES.BAD_REQUEST,
      reason: 'Message must be a JSON object with a string `type` field.',
    };
  }

  switch (parsed.type) {
    case 'auth': {
      if (parsed.protocolVersion !== SNOW_RUSH_PROTOCOL_VERSION) {
        return {
          ok: false,
          errorCode: 'PROTOCOL_MISMATCH',
          closeCode: SNOW_RUSH_WS_CLOSE_CODES.BAD_REQUEST,
          reason: `Unsupported protocolVersion (expected ${SNOW_RUSH_PROTOCOL_VERSION}).`,
        };
      }
      if (!isValidSnowRushRoomId(parsed.roomId)) {
        return {
          ok: false,
          errorCode: 'INVALID_PAYLOAD',
          closeCode: SNOW_RUSH_WS_CLOSE_CODES.BAD_REQUEST,
          reason: 'Invalid roomId in auth message.',
        };
      }
      if (
        typeof parsed.idToken !== 'string' ||
        parsed.idToken.trim().length < 32 ||
        parsed.idToken.length > 16384
      ) {
        return {
          ok: false,
          errorCode: 'INVALID_TOKEN',
          closeCode: SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
          reason: 'Missing or malformed Firebase ID token.',
        };
      }
      return {
        ok: true,
        message: {
          type: 'auth',
          protocolVersion: SNOW_RUSH_PROTOCOL_VERSION,
          roomId: parsed.roomId,
          idToken: parsed.idToken.trim(),
        },
      };
    }

    case 'input': {
      const cleanFrame: SnowRushInputFrame | null = sanitizeClientInputPayload(parsed);
      if (cleanFrame === null) {
        return {
          ok: false,
          errorCode: 'INVALID_PAYLOAD',
          closeCode: SNOW_RUSH_WS_CLOSE_CODES.BAD_REQUEST,
          reason: 'Invalid input frame payload.',
        };
      }
      return {
        ok: true,
        message: {
          type: 'input',
          seq: cleanFrame.seq,
          steer: cleanFrame.steer,
          jumpPressed: cleanFrame.jumpPressed,
          useItemPressed: cleanFrame.useItemPressed,
        },
      };
    }

    case 'ping': {
      if (typeof parsed.clientSentAtMs !== 'number' || !Number.isFinite(parsed.clientSentAtMs)) {
        return {
          ok: false,
          errorCode: 'INVALID_PAYLOAD',
          closeCode: SNOW_RUSH_WS_CLOSE_CODES.BAD_REQUEST,
          reason: 'Invalid ping timestamp.',
        };
      }
      return {
        ok: true,
        message: {
          type: 'ping',
          clientSentAtMs: parsed.clientSentAtMs,
        },
      };
    }

    case 'request_snapshot': {
      return {
        ok: true,
        message: { type: 'request_snapshot' },
      };
    }

    default: {
      return {
        ok: false,
        errorCode: 'UNKNOWN_MESSAGE_TYPE',
        closeCode: SNOW_RUSH_WS_CLOSE_CODES.BAD_REQUEST,
        reason: `Unknown message type: ${parsed.type.slice(0, 32)}`,
      };
    }
  }
}

/**
 * Safely parses an inbound server WebSocket JSON message on the client.
 */
export function parseSnowRushServerMessage(rawText: string): SnowRushServerMessage | null {
  if (typeof rawText !== 'string' || rawText.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || typeof parsed.type !== 'string') {
    return null;
  }

  switch (parsed.type) {
    case 'welcome':
      if (
        typeof parsed.roomId === 'string' &&
        typeof parsed.uid === 'string' &&
        typeof parsed.gameRound === 'number' &&
        typeof parsed.snapshotHz === 'number' &&
        typeof parsed.serverTimeMs === 'number' &&
        isPlainObject(parsed.snapshot)
      ) {
        return parsed as unknown as SnowRushServerWelcomeMessage;
      }
      return null;

    case 'snapshot':
      if (typeof parsed.serverTimeMs === 'number' && isPlainObject(parsed.snapshot)) {
        return parsed as unknown as SnowRushServerSnapshotMessage;
      }
      return null;

    case 'pong':
      if (typeof parsed.clientSentAtMs === 'number' && typeof parsed.serverTimeMs === 'number') {
        return parsed as unknown as SnowRushServerPongMessage;
      }
      return null;

    case 'player_connection':
      if (
        typeof parsed.uid === 'string' &&
        typeof parsed.isConnected === 'boolean' &&
        typeof parsed.connectedCount === 'number'
      ) {
        return parsed as unknown as SnowRushServerPlayerConnectionMessage;
      }
      return null;

    case 'race_finished':
      if (
        typeof parsed.roomId === 'string' &&
        typeof parsed.gameRound === 'number' &&
        isPlainObject(parsed.finishState) &&
        isPlainObject(parsed.snapshot)
      ) {
        return parsed as unknown as SnowRushServerRaceFinishedMessage;
      }
      return null;

    case 'error':
      if (
        typeof parsed.code === 'string' &&
        typeof parsed.message === 'string' &&
        typeof parsed.fatal === 'boolean'
      ) {
        return parsed as unknown as SnowRushServerErrorMessage;
      }
      return null;

    default:
      return null;
  }
}

function readConfiguredSnowRushWorkerBaseUrl(explicitBaseUrl?: string | null): string | null {
  let rawBase = '';
  if (explicitBaseUrl !== undefined) {
    rawBase = explicitBaseUrl ?? '';
  } else {
    try {
      const metaEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env;
      if (metaEnv && typeof metaEnv.VITE_SNOW_RUSH_WS_URL === 'string') {
        rawBase = metaEnv.VITE_SNOW_RUSH_WS_URL;
      }
    } catch {
      rawBase = '';
    }
  }

  const trimmed = rawBase
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(ws\/snow-rush(?:\/[^/]+)?|health)$/i, '')
    .replace(/\/+$/, '');

  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== 'https:' &&
    parsed.protocol !== 'http:' &&
    parsed.protocol !== 'wss:' &&
    parsed.protocol !== 'ws:'
  ) {
    return null;
  }

  const basePath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host}${basePath}`;
}

/**
 * Resolves the WebSocket URL for a given Snow Rush `roomId` from explicit override
 * or `VITE_SNOW_RUSH_WS_URL`. Returns `null` when unconfigured (keeping production disabled by default).
 */
export function resolveSnowRushWorkerWsUrl(
  roomId: string,
  explicitBaseUrl?: string | null
): string | null {
  if (!isValidSnowRushRoomId(roomId)) {
    return null;
  }

  const normalizedBase = readConfiguredSnowRushWorkerBaseUrl(explicitBaseUrl);
  if (!normalizedBase) {
    return null;
  }

  let wsBase = normalizedBase;
  if (wsBase.startsWith('https://')) {
    wsBase = `wss://${wsBase.slice('https://'.length)}`;
  } else if (wsBase.startsWith('http://')) {
    wsBase = `ws://${wsBase.slice('http://'.length)}`;
  }

  if (!wsBase.startsWith('ws://') && !wsBase.startsWith('wss://')) {
    return null;
  }

  return `${wsBase}/ws/snow-rush/${encodeURIComponent(roomId)}`;
}

/**
 * Resolves the HTTP `GET /health` URL from `VITE_SNOW_RUSH_WS_URL` (converting `wss://` -> `https://`
 * and `ws://` -> `http://`). Returns `null` when unconfigured.
 */
export function resolveSnowRushWorkerHealthUrl(explicitBaseUrl?: string | null): string | null {
  const normalizedBase = readConfiguredSnowRushWorkerBaseUrl(explicitBaseUrl);
  if (!normalizedBase) {
    return null;
  }

  let httpBase = normalizedBase;
  if (httpBase.startsWith('wss://')) {
    httpBase = `https://${httpBase.slice('wss://'.length)}`;
  } else if (httpBase.startsWith('ws://')) {
    httpBase = `http://${httpBase.slice('ws://'.length)}`;
  }

  if (!httpBase.startsWith('http://') && !httpBase.startsWith('https://')) {
    return null;
  }

  return `${httpBase}/health`;
}

/**
 * Maps custom close codes to terminal vs transient classification so the client
 * never enters an infinite reconnect loop on unauthorized or invalid rooms.
 */
export function isTerminalSnowRushCloseCode(code: number): boolean {
  return (
    code === SNOW_RUSH_WS_CLOSE_CODES.RACE_COMPLETED ||
    code === SNOW_RUSH_WS_CLOSE_CODES.BAD_REQUEST ||
    code === SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED ||
    code === SNOW_RUSH_WS_CLOSE_CODES.FORBIDDEN_ROOM ||
    code === SNOW_RUSH_WS_CLOSE_CODES.ROOM_NOT_FOUND ||
    code === SNOW_RUSH_WS_CLOSE_CODES.DUPLICATE_SESSION ||
    code === SNOW_RUSH_WS_CLOSE_CODES.ROOM_INVALID_STATE
  );
}
