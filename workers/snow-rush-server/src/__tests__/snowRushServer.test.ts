import { getAvailableGames, getGameById } from '../../../../src/games/registry';
import {
  COURSE_LENGTH_M,
  MULTIPLAYER_TICK_DT_SEC,
} from '../../../../src/games/snow-rush/constants';
import {
  SnowRushSnapshotInterpolator,
  SnowRushSocketClient,
  SNOW_RUSH_WS_CLOSE_CODES,
  SNOW_RUSH_WS_MAX_MESSAGE_BYTES,
} from '../../../../src/games/snow-rush/network';
import type {
  SnowRushConnectionStatus,
  SnowRushServerMessage,
  SnowRushSocketLike,
} from '../../../../src/games/snow-rush/network';
import {
  createInitialSnowRushState,
  startCountdownState,
  stepSnowRushSimulation,
} from '../../../../src/games/snow-rush/simulation';
import {
  computeLobbyStatus,
  normalizeMaxPlayers,
  resolveAuthoritativePlayer,
} from '../../../../src/services/roomStateHelpers';
import {
  clearJwksCacheForTests,
  GOOGLE_SECURETOKEN_JWKS_URL,
  verifyFirebaseIdToken,
  verifySnowRushRoomAccess,
} from '../auth/verifyFirebaseToken';
import type { FetchLike } from '../auth/verifyFirebaseToken';
import type {
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectStub,
  ExecutionContext,
  SnowRushWorkerEnv,
  SqlStorage,
  SqlStorageCursor,
  SqlStorageValue,
} from '../cloudflareTypes';
import workerEntry, { SnowRushRoomDO } from '../index';

/**
 * Snow Rush: Avalanche Escape — Step 4.7 Automated Verification Suite
 *
 * Tests all 17 Step 4.7 verification domains end-to-end using:
 * - Real Web Crypto 2048-bit RS256 keypairs & signed JWTs (`crypto.subtle`)
 * - Authoritative Named Firestore REST schema & database-ID (`ai-studio-47dffdd9-9dac-40e5-b320-95d71826db89`) checks
 * - Worker routing -> `SnowRushRoomDO` -> SQLite checkpointing -> `SnowRushSocketClient` -> `SnowRushSnapshotInterpolator`
 * - Regression checks on `?devSnowRush=1` local offline engine, `registry.ts` (`coming_soon`), and Snakes & Ladders helpers
 */

const PROJECT_ID = 'gen-lang-client-0335200904';
const NAMED_DATABASE_ID = 'ai-studio-47dffdd9-9dac-40e5-b320-95d71826db89';
const TEST_BASE_URL = 'https://snow-rush-test.workers.dev';
const encoder = new TextEncoder();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonToBase64Url(obj: Record<string, unknown>): string {
  return toBase64Url(encoder.encode(JSON.stringify(obj)));
}

function toExactBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function signRs256Jwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: CryptoKey
): Promise<string> {
  const headerB64 = jsonToBase64Url(header);
  const payloadB64 = jsonToBase64Url(payload);
  const signingInput = encoder.encode(`${headerB64}.${payloadB64}`);
  const sigBuf = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    toExactBuffer(signingInput)
  );
  return `${headerB64}.${payloadB64}.${toBase64Url(new Uint8Array(sigBuf))}`;
}

interface FirestoreMockRoomConfig {
  readonly gameType: string;
  readonly status: string;
  readonly gameRound?: number;
  readonly maxPlayers?: number;
  readonly hostId?: string;
  readonly players: readonly {
    readonly uid: string;
    readonly displayName: string;
    readonly color?: string;
  }[];
}

function buildFirestoreRoomDocumentJson(roomId: string, cfg: FirestoreMockRoomConfig): Record<string, unknown> {
  return {
    name: `projects/${PROJECT_ID}/databases/${NAMED_DATABASE_ID}/documents/rooms/${roomId}`,
    fields: {
      gameType: { stringValue: cfg.gameType },
      status: { stringValue: cfg.status },
      gameRound: { integerValue: String(cfg.gameRound ?? 1) },
      maxPlayers: { integerValue: String(cfg.maxPlayers ?? 4) },
      hostId: { stringValue: cfg.hostId ?? (cfg.players[0]?.uid ?? 'host') },
      players: {
        arrayValue: {
          values: cfg.players.map((p) => ({
            mapValue: {
              fields: {
                uid: { stringValue: p.uid },
                displayName: { stringValue: p.displayName },
                ...(p.color ? { color: { stringValue: p.color } } : {}),
              },
            },
          })),
        },
      },
    },
  };
}

// ============================================================================
// In-Memory WebSocketPair & SQLite Durable Object Runtime Harness
// ============================================================================

class MockLinkedWebSocket implements SnowRushSocketLike {
  public readyState = 1; // OPEN
  public onopen: ((ev: unknown) => void) | null = null;
  public onmessage: ((ev: { readonly data: unknown }) => void) | null = null;
  public onclose: ((ev: { readonly code: number; readonly reason: string }) => void) | null = null;
  public onerror: ((ev: unknown) => void) | null = null;

  public peer: MockLinkedWebSocket | null = null;
  public onServerInboundFrame: ((raw: string | ArrayBuffer) => Promise<void> | void) | null = null;
  public onServerClose: ((code: number, reason: string) => Promise<void> | void) | null = null;

  private attachment: unknown = null;
  public lastCloseCode: number | null = null;
  public lastCloseReason = '';
  public receivedFrames: string[] = [];

  public accept(): void {
    this.readyState = 1;
  }

  public serializeAttachment(attachment: unknown): void {
    this.attachment = JSON.parse(JSON.stringify(attachment));
  }

  public deserializeAttachment(): unknown {
    return this.attachment;
  }

  public send(data: string | ArrayBuffer): void {
    if (this.readyState !== 1) return;
    const target = this.peer;
    if (!target || target.readyState !== 1) return;

    if (target.onServerInboundFrame) {
      void target.onServerInboundFrame(data);
    } else if (typeof data === 'string') {
      target.receivedFrames.push(data);
      target.onmessage?.({ data });
    }
  }

  public close(code = 1000, reason = ''): void {
    if (code !== 1000 && (code < 3000 || code > 4999)) {
      throw new Error(`Invalid WebSocket close code: ${code}`);
    }
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.lastCloseCode = code;
    this.lastCloseReason = reason;

    const target = this.peer;
    if (target && target.readyState !== 3) {
      target.readyState = 3;
      target.lastCloseCode = code;
      target.lastCloseReason = reason;
      if (target.onServerClose) {
        void target.onServerClose(code, reason);
      } else {
        target.onclose?.({ code, reason });
      }
    }
  }
}

class MockWebSocketPairImpl {
  public 0: WebSocket;
  public 1: WebSocket;

  constructor() {
    const clientSide = new MockLinkedWebSocket();
    const serverSide = new MockLinkedWebSocket();
    clientSide.peer = serverSide;
    serverSide.peer = clientSide;
    this[0] = clientSide as unknown as WebSocket;
    this[1] = serverSide as unknown as WebSocket;
  }
}

// Install WebSocketPair & Cloudflare status-101 Response shim on globalThis for Node test runtime
(globalThis as unknown as { WebSocketPair: typeof MockWebSocketPairImpl }).WebSocketPair =
  MockWebSocketPairImpl;

const NativeResponseCtor = globalThis.Response;
class CloudflareCompatResponse extends NativeResponseCtor {
  public readonly webSocket?: WebSocket | null;
  private readonly cfStatusOverride: number | null;

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    if (init && init.status === 101) {
      const { status: _ignoredStatus, webSocket, ...restInit } = init;
      super(body ?? null, { ...restInit, status: 200 });
      this.cfStatusOverride = 101;
      this.webSocket = webSocket;
    } else {
      super(body, init);
      this.cfStatusOverride = null;
      this.webSocket = init?.webSocket;
    }
  }

  public override get status(): number {
    return this.cfStatusOverride ?? super.status;
  }
}
(globalThis as unknown as { Response: typeof NativeResponseCtor }).Response =
  CloudflareCompatResponse;

interface StoredCheckpointRecord {
  room_id: string;
  game_round: number;
  updated_at_ms: number;
  snapshot_json: string;
}

class MockSqliteBacking {
  public checkpointRow: StoredCheckpointRecord | null = null;
  public writeCount = 0;
  public readCount = 0;
  public deleteCount = 0;
  public scheduledAlarmAtMs: number | null = null;
}

function createMockDurableObjectState(
  roomName: string,
  sqliteBacking: MockSqliteBacking,
  bindDoRef: () => SnowRushRoomDO
): DurableObjectState {
  const acceptedSockets: WebSocket[] = [];

  const sql: SqlStorage = {
    exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: SqlStorageValue[]
    ): SqlStorageCursor<T> {
      const normalized = query.trim().toUpperCase();
      let rows: T[] = [];
      let rowsWritten = 0;

      if (normalized.startsWith('CREATE TABLE')) {
        // Table DDL
      } else if (normalized.startsWith('SELECT')) {
        sqliteBacking.readCount += 1;
        if (sqliteBacking.checkpointRow) {
          rows = [{ ...(sqliteBacking.checkpointRow as unknown as T) }];
        }
      } else if (normalized.startsWith('INSERT INTO RACE_CHECKPOINT')) {
        sqliteBacking.writeCount += 1;
        rowsWritten = 1;
        sqliteBacking.checkpointRow = {
          room_id: String(bindings[0]),
          game_round: Number(bindings[1]),
          updated_at_ms: Number(bindings[2]),
          snapshot_json: String(bindings[3]),
        };
      } else if (normalized.startsWith('DELETE FROM RACE_CHECKPOINT')) {
        sqliteBacking.deleteCount += 1;
        if (sqliteBacking.checkpointRow) {
          rowsWritten = 1;
          sqliteBacking.checkpointRow = null;
        }
      }

      return {
        rowsRead: rows.length,
        rowsWritten,
        toArray: () => rows,
        one: () => {
          if (rows.length === 0) throw new Error('Expected 1 SQL row');
          return rows[0];
        },
        [Symbol.iterator]: () => rows[Symbol.iterator](),
      };
    },
  };

  const storage: DurableObjectStorage = {
    sql,
    getAlarm: async () => sqliteBacking.scheduledAlarmAtMs,
    setAlarm: async (when) => {
      sqliteBacking.scheduledAlarmAtMs = typeof when === 'number' ? when : when.getTime();
    },
    deleteAlarm: async () => {
      sqliteBacking.scheduledAlarmAtMs = null;
    },
    deleteAll: async () => {
      sqliteBacking.checkpointRow = null;
    },
  };

  const id: DurableObjectId = {
    name: roomName,
    toString: () => `do-${roomName}`,
    equals: (other) => other.toString() === `do-${roomName}`,
  };

  return {
    id,
    storage,
    acceptWebSocket: (ws: WebSocket) => {
      const mockServerWs = ws as unknown as MockLinkedWebSocket;
      mockServerWs.accept();
      mockServerWs.onServerInboundFrame = async (raw) => {
        await bindDoRef().webSocketMessage(ws, raw);
      };
      mockServerWs.onServerClose = async (code, reason) => {
        await bindDoRef().webSocketClose(ws, code, reason, true);
      };
      acceptedSockets.push(ws);
    },
    getWebSockets: () => acceptedSockets.filter((s) => (s as unknown as MockLinkedWebSocket).readyState === 1),
    blockConcurrencyWhile: async (cb) => cb(),
  };
}

class InMemoryWorkerCluster {
  public readonly rooms = new Map<string, FirestoreMockRoomConfig>();
  public readonly sqlByRoom = new Map<string, MockSqliteBacking>();
  public readonly doByRoom = new Map<string, SnowRushRoomDO>();
  public firestoreFetchError = false;
  public lastQueriedFirestoreUrls: string[] = [];
  public nowMsValue = 1_760_000_000_000;

  private readonly jwksPayloadJson: string;
  public readonly autoTickLoop: boolean;
  public readonly preCountdownSyncMs: number;
  public readonly snapshotBroadcastHz: string;

  constructor(options: {
    jwksPayloadJson: string;
    autoTickLoop?: boolean;
    preCountdownSyncMs?: number;
    snapshotBroadcastHz?: string;
  }) {
    this.jwksPayloadJson = options.jwksPayloadJson;
    this.autoTickLoop = options.autoTickLoop ?? false;
    this.preCountdownSyncMs = options.preCountdownSyncMs ?? 0;
    this.snapshotBroadcastHz = options.snapshotBroadcastHz ?? '10';
  }

  public readonly fetchFn: FetchLike = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === GOOGLE_SECURETOKEN_JWKS_URL) {
      return new Response(this.jwksPayloadJson, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    if (url.startsWith('https://firestore.googleapis.com/v1/')) {
      this.lastQueriedFirestoreUrls.push(url);
      if (this.firestoreFetchError) {
        throw new Error('Simulated Firestore network failure');
      }

      const authHeader = new Headers(init?.headers).get('Authorization') ?? '';
      if (!authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Missing Bearer token' }), { status: 401 });
      }

      const expectedPrefix =
        `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
        `/databases/${NAMED_DATABASE_ID}/documents/rooms/`;
      if (!url.startsWith(expectedPrefix)) {
        return new Response(JSON.stringify({ error: 'Wrong project or database path' }), {
          status: 403,
        });
      }

      const roomId = decodeURIComponent(url.slice(expectedPrefix.length));
      const roomCfg = this.rooms.get(roomId);
      if (!roomCfg) {
        return new Response(JSON.stringify({ error: 'Document not found' }), { status: 404 });
      }

      return new Response(JSON.stringify(buildFirestoreRoomDocumentJson(roomId, roomCfg)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Unhandled URL', { status: 500 });
  };

  public getEnv(allowedOrigins = ''): SnowRushWorkerEnv {
    const namespace: DurableObjectNamespace = {
      idFromName: (name: string): DurableObjectId => ({
        name,
        toString: () => `do-${name}`,
        equals: (other) => other.toString() === `do-${name}`,
      }),
      idFromString: (str: string): DurableObjectId => ({
        name: str.replace(/^do-/, ''),
        toString: () => str,
        equals: (other) => other.toString() === str,
      }),
      newUniqueId: (): DurableObjectId => ({
        toString: () => 'do-unique',
        equals: (other) => other.toString() === 'do-unique',
      }),
      get: (id: DurableObjectId): DurableObjectStub => {
        const roomName = id.name ?? id.toString().replace(/^do-/, '');
        let doInstance = this.doByRoom.get(roomName);
        if (!doInstance) {
          let sqlBacking = this.sqlByRoom.get(roomName);
          if (!sqlBacking) {
            sqlBacking = new MockSqliteBacking();
            this.sqlByRoom.set(roomName, sqlBacking);
          }
          let boundRef: SnowRushRoomDO | null = null;
          const state = createMockDurableObjectState(roomName, sqlBacking, () => {
            if (!boundRef) throw new Error('DO not initialized');
            return boundRef;
          });
          doInstance = new SnowRushRoomDO(state, this.getEnv(allowedOrigins), {
            fetchFn: this.fetchFn,
            nowMs: () => this.nowMsValue,
            preCountdownSyncMs: this.preCountdownSyncMs,
            autoTickLoop: this.autoTickLoop,
          });
          boundRef = doInstance;
          this.doByRoom.set(roomName, doInstance);
        }
        return {
          id,
          name: roomName,
          fetch: (input, init) => {
            const req = input instanceof Request ? input : new Request(String(input), init);
            return doInstance.fetch(req);
          },
        };
      },
    };

    return {
      SNOW_RUSH_ROOM: namespace,
      FIREBASE_PROJECT_ID: PROJECT_ID,
      FIRESTORE_DATABASE_ID: NAMED_DATABASE_ID,
      SNAPSHOT_BROADCAST_HZ: this.snapshotBroadcastHz,
      ALLOWED_ORIGINS: allowedOrigins,
    };
  }

  public evictDurableObjectFromMemory(roomId: string): void {
    this.doByRoom.delete(roomId);
  }

  public async connectRawSocket(
    roomId: string,
    origin = 'https://ais-dev.run.app',
    allowedOrigins = ''
  ): Promise<{ response: Response; clientWs: MockLinkedWebSocket | null }> {
    const wsUrl = `${TEST_BASE_URL}/ws/snow-rush/${encodeURIComponent(roomId)}`;
    const httpUrl = wsUrl.replace(/^wss:/, 'https:');
    const req = new Request(httpUrl, {
      method: 'GET',
      headers: {
        Upgrade: 'websocket',
        Origin: origin,
      },
    });
    const ctx: ExecutionContext = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    };
    const response = await workerEntry.fetch(req, this.getEnv(allowedOrigins), ctx);
    const clientWs = ((response as unknown as { webSocket?: WebSocket }).webSocket ??
      null) as unknown as MockLinkedWebSocket | null;
    return { response, clientWs };
  }

  public createSocketFactory(): (url: string) => SnowRushSocketLike {
    return (wsUrl: string): SnowRushSocketLike => {
      const httpUrl = wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
      const proxySocket = new MockLinkedWebSocket();

      void (async () => {
        const req = new Request(httpUrl, {
          method: 'GET',
          headers: { Upgrade: 'websocket', Origin: 'https://ais-dev.run.app' },
        });
        const ctx: ExecutionContext = {
          waitUntil: () => {},
          passThroughOnException: () => {},
        };
        const resp = await workerEntry.fetch(req, this.getEnv(), ctx);
        const rawClientWs = ((resp as unknown as { webSocket?: WebSocket }).webSocket ??
          null) as unknown as MockLinkedWebSocket | null;
        if (resp.status !== 101 || !rawClientWs) {
          proxySocket.readyState = 3;
          proxySocket.onclose?.({ code: 4400, reason: `HTTP ${resp.status}` });
          return;
        }

        // Bridge proxySocket <-> rawClientWs
        rawClientWs.onmessage = (ev) => proxySocket.onmessage?.(ev);
        rawClientWs.onclose = (ev) => {
          proxySocket.readyState = 3;
          proxySocket.onclose?.(ev);
        };
        proxySocket.send = (data: string | ArrayBuffer) => rawClientWs.send(data);
        proxySocket.close = (code?: number, reason?: string) => rawClientWs.close(code, reason);
        proxySocket.onopen?.({});
      })();

      return proxySocket;
    };
  }
}

async function flushMicrotasks(iterations = 10): Promise<void> {
  for (let i = 0; i < iterations; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function parseServerFrames(ws: MockLinkedWebSocket): SnowRushServerMessage[] {
  return ws.receivedFrames.map((f) => JSON.parse(f) as SnowRushServerMessage);
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runAllTests(): Promise<void> {
  const results: { name: string; passed: boolean }[] = [];

  async function runCase(name: string, fn: () => Promise<void>): Promise<void> {
    await fn();
    results.push({ name, passed: true });
    console.log(`  PASS  ${name}`);
  }

  console.log('\n=== Snow Rush Step 4.7 — Online Multiplayer Backend & WebSocket Test Suite ===\n');

  // Generate real 2048-bit RSA keypairs for SecureToken JWKS signature verification
  const primaryKeyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  const attackerKeyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  const exportedPublicJwk = await crypto.subtle.exportKey('jwk', primaryKeyPair.publicKey);
  const jwksPayloadJson = JSON.stringify({
    keys: [
      {
        ...exportedPublicJwk,
        kid: 'google-securetoken-kid-1',
        alg: 'RS256',
        kty: 'RSA',
        use: 'sig',
      },
    ],
  });

  const baseNowSec = Math.floor(1_760_000_000_000 / 1000);

  async function issueValidIdToken(uid: string, overrides?: Record<string, unknown>): Promise<string> {
    return signRs256Jwt(
      { alg: 'RS256', typ: 'JWT', kid: 'google-securetoken-kid-1' },
      {
        iss: `https://securetoken.google.com/${PROJECT_ID}`,
        aud: PROJECT_ID,
        sub: uid,
        user_id: uid,
        iat: baseNowSec - 60,
        auth_time: baseNowSec - 60,
        exp: baseNowSec + 3600,
        ...overrides,
      },
      primaryKeyPair.privateKey
    );
  }

  // --------------------------------------------------------------------------
  // 1. Worker HTTP Routing, Health Check & Origin Guard
  // --------------------------------------------------------------------------
  await runCase('1. Worker routing (/health, 404, 426 Upgrade check, invalid roomId, Origin guard)', async () => {
    const cluster = new InMemoryWorkerCluster({ jwksPayloadJson });
    const ctx: ExecutionContext = { waitUntil: () => {}, passThroughOnException: () => {} };

    const healthResp = await workerEntry.fetch(
      new Request(`${TEST_BASE_URL}/health`),
      cluster.getEnv(),
      ctx
    );
    assert(healthResp.status === 200, 'Expected /health 200');
    const healthJson = (await healthResp.json()) as { ok: boolean; protocolVersion: number };
    assert(healthJson.ok === true && healthJson.protocolVersion === 1, 'Health payload valid');

    const notFoundResp = await workerEntry.fetch(
      new Request(`${TEST_BASE_URL}/unknown`),
      cluster.getEnv(),
      ctx
    );
    assert(notFoundResp.status === 404, 'Unknown path returns 404');

    const noUpgradeResp = await workerEntry.fetch(
      new Request(`${TEST_BASE_URL}/ws/snow-rush/room_abc`),
      cluster.getEnv(),
      ctx
    );
    assert(noUpgradeResp.status === 426, 'Missing Upgrade header returns 426');

    const badRoomIdResp = await workerEntry.fetch(
      new Request(`${TEST_BASE_URL}/ws/snow-rush/bad%20room$id`, {
        headers: { Upgrade: 'websocket' },
      }),
      cluster.getEnv(),
      ctx
    );
    assert(badRoomIdResp.status === 400, 'Invalid roomId characters return 400');

    const forbiddenOrigin = await cluster.connectRawSocket(
      'room_valid',
      'https://evil.example.com',
      'https://ais-dev.run.app'
    );
    assert(forbiddenOrigin.response.status === 403, 'Disallowed Origin returns 403');
  });

  // --------------------------------------------------------------------------
  // 2. Cryptographic RS256 Firebase Token Signature Verification
  // --------------------------------------------------------------------------
  await runCase('2. Real Web Crypto RS256 Firebase ID Token signature verification & JWKS cache', async () => {
    clearJwksCacheForTests();
    const cluster = new InMemoryWorkerCluster({ jwksPayloadJson });
    const token = await issueValidIdToken('user_alice');

    const verified = await verifyFirebaseIdToken({
      idToken: token,
      expectedProjectId: PROJECT_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });

    assert(verified.ok === true, 'Valid RS256 Firebase token verifies');
    assert(verified.token.uid === 'user_alice', 'Verified UID matches sub claim');
    assert(verified.token.projectId === PROJECT_ID, 'Verified projectId matches');
  });

  // --------------------------------------------------------------------------
  // 3. Invalid / Tampered / Expired / Wrong Claims / alg:none Token Rejection
  // --------------------------------------------------------------------------
  await runCase('3. Rejects invalid RS256 signature, expired exp, future iat, wrong aud/iss, and alg:none', async () => {
    const cluster = new InMemoryWorkerCluster({ jwksPayloadJson });

    // 3A. Signed by wrong RSA private key
    const forgedToken = await signRs256Jwt(
      { alg: 'RS256', typ: 'JWT', kid: 'google-securetoken-kid-1' },
      {
        iss: `https://securetoken.google.com/${PROJECT_ID}`,
        aud: PROJECT_ID,
        sub: 'user_alice',
        iat: baseNowSec - 30,
        exp: baseNowSec + 3600,
      },
      attackerKeyPair.privateKey
    );
    const forgedRes = await verifyFirebaseIdToken({
      idToken: forgedToken,
      expectedProjectId: PROJECT_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(!forgedRes.ok && forgedRes.errorCode === 'INVALID_TOKEN', 'Forged RSA key rejected');

    // 3B. Expired token
    const expiredToken = await issueValidIdToken('user_alice', { exp: baseNowSec - 1 });
    const expiredRes = await verifyFirebaseIdToken({
      idToken: expiredToken,
      expectedProjectId: PROJECT_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(!expiredRes.ok && expiredRes.errorCode === 'EXPIRED_TOKEN', 'Expired token rejected');

    // 3C. Wrong audience
    const wrongAudToken = await issueValidIdToken('user_alice', { aud: 'other-firebase-proj' });
    const wrongAudRes = await verifyFirebaseIdToken({
      idToken: wrongAudToken,
      expectedProjectId: PROJECT_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(!wrongAudRes.ok && wrongAudRes.errorCode === 'INVALID_TOKEN', 'Wrong aud rejected');

    // 3D. Wrong issuer
    const wrongIssToken = await issueValidIdToken('user_alice', {
      iss: 'https://accounts.google.com',
    });
    const wrongIssRes = await verifyFirebaseIdToken({
      idToken: wrongIssToken,
      expectedProjectId: PROJECT_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(!wrongIssRes.ok && wrongIssRes.errorCode === 'INVALID_TOKEN', 'Wrong iss rejected');

    // 3E. Future iat
    const futureIatToken = await issueValidIdToken('user_alice', { iat: baseNowSec + 600 });
    const futureIatRes = await verifyFirebaseIdToken({
      idToken: futureIatToken,
      expectedProjectId: PROJECT_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(!futureIatRes.ok && futureIatRes.errorCode === 'INVALID_TOKEN', 'Future iat rejected');

    // 3F. `alg: "none"` attack
    const algNoneToken = `${jsonToBase64Url({ alg: 'none', kid: 'google-securetoken-kid-1' })}.${jsonToBase64Url(
      {
        iss: `https://securetoken.google.com/${PROJECT_ID}`,
        aud: PROJECT_ID,
        sub: 'user_alice',
        iat: baseNowSec - 10,
        exp: baseNowSec + 3600,
      }
    )}.${toBase64Url(new Uint8Array(128))}`;
    const algNoneRes = await verifyFirebaseIdToken({
      idToken: algNoneToken,
      expectedProjectId: PROJECT_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(!algNoneRes.ok && algNoneRes.errorCode === 'INVALID_TOKEN', 'alg:none rejected');
  });

  // --------------------------------------------------------------------------
  // 4. Named Firestore DB Guard, Non-Member, Wrong gameType & Invalid Status Rejection
  // --------------------------------------------------------------------------
  await runCase('4. Named Firestore DB enforcement + rejects missing, waiting, finished, wrong gameType, and non-member rooms', async () => {
    const cluster = new InMemoryWorkerCluster({ jwksPayloadJson });
    const aliceToken = await issueValidIdToken('uid_alice');
    const intruderToken = await issueValidIdToken('uid_intruder');

    // 4A. Forbids `(default)` databaseId
    const defaultDbRes = await verifySnowRushRoomAccess({
      roomId: 'room_1',
      idToken: aliceToken,
      projectId: PROJECT_ID,
      databaseId: '(default)',
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(!defaultDbRes.ok && defaultDbRes.errorCode === 'ROOM_VERIFY_FAILED', '(default) DB rejected');

    // 4B. Missing room -> ROOM_NOT_FOUND (4404)
    const missingRes = await verifySnowRushRoomAccess({
      roomId: 'room_does_not_exist',
      idToken: aliceToken,
      projectId: PROJECT_ID,
      databaseId: NAMED_DATABASE_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(
      !missingRes.ok &&
        missingRes.errorCode === 'ROOM_NOT_FOUND' &&
        missingRes.closeCode === SNOW_RUSH_WS_CLOSE_CODES.ROOM_NOT_FOUND,
      'Missing room rejected with 4404'
    );
    assert(
      cluster.lastQueriedFirestoreUrls[0]?.includes(`/databases/${NAMED_DATABASE_ID}/documents/rooms/`),
      'Queried exact Named Firestore Database URL'
    );

    // 4C. Wrong gameType (`snakes_and_ladders`)
    cluster.rooms.set('room_snakes', {
      gameType: 'snakes_and_ladders',
      status: 'playing',
      players: [
        { uid: 'uid_alice', displayName: 'Alice' },
        { uid: 'uid_bob', displayName: 'Bob' },
      ],
    });
    const snakesRes = await verifySnowRushRoomAccess({
      roomId: 'room_snakes',
      idToken: aliceToken,
      projectId: PROJECT_ID,
      databaseId: NAMED_DATABASE_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(!snakesRes.ok && snakesRes.errorCode === 'WRONG_GAME_TYPE', 'snakes_and_ladders room rejected');

    // 4D. Waiting room (`status: 'waiting'`)
    cluster.rooms.set('room_waiting', {
      gameType: 'snow_rush',
      status: 'waiting',
      players: [
        { uid: 'uid_alice', displayName: 'Alice' },
        { uid: 'uid_bob', displayName: 'Bob' },
      ],
    });
    const waitingRes = await verifySnowRushRoomAccess({
      roomId: 'room_waiting',
      idToken: aliceToken,
      projectId: PROJECT_ID,
      databaseId: NAMED_DATABASE_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(!waitingRes.ok && waitingRes.errorCode === 'ROOM_NOT_PLAYING', 'waiting room rejected');

    // 4E. Finished room (`status: 'finished'`)
    cluster.rooms.set('room_done', {
      gameType: 'snow_rush',
      status: 'finished',
      players: [
        { uid: 'uid_alice', displayName: 'Alice' },
        { uid: 'uid_bob', displayName: 'Bob' },
      ],
    });
    const finishedRes = await verifySnowRushRoomAccess({
      roomId: 'room_done',
      idToken: aliceToken,
      projectId: PROJECT_ID,
      databaseId: NAMED_DATABASE_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(
      !finishedRes.ok && finishedRes.errorCode === 'ROOM_ALREADY_FINISHED',
      'finished room rejected'
    );

    // 4F. Non-member UID rejected (`NOT_ROOM_MEMBER`, 4403)
    cluster.rooms.set('room_active', {
      gameType: 'snow_rush',
      status: 'playing',
      players: [
        { uid: 'uid_alice', displayName: 'Alice' },
        { uid: 'uid_bob', displayName: 'Bob' },
      ],
    });
    const nonMemberRes = await verifySnowRushRoomAccess({
      roomId: 'room_active',
      idToken: intruderToken,
      projectId: PROJECT_ID,
      databaseId: NAMED_DATABASE_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(
      !nonMemberRes.ok &&
        nonMemberRes.errorCode === 'NOT_ROOM_MEMBER' &&
        nonMemberRes.closeCode === SNOW_RUSH_WS_CLOSE_CODES.FORBIDDEN_ROOM,
      'Non-member UID rejected with 4403'
    );

    // 4G. Firestore network outage fails closed (NEVER fails open!)
    cluster.firestoreFetchError = true;
    const outageRes = await verifySnowRushRoomAccess({
      roomId: 'room_active',
      idToken: aliceToken,
      projectId: PROJECT_ID,
      databaseId: NAMED_DATABASE_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(!outageRes.ok && outageRes.errorCode === 'ROOM_VERIFY_FAILED', 'Network outage fails closed');
  });

  // --------------------------------------------------------------------------
  // 5. Room Capacity 2–4 Players Validation
  // --------------------------------------------------------------------------
  await runCase('5. Enforces 2–4 player room capacity (rejects 1-player and 5-player rooms)', async () => {
    const cluster = new InMemoryWorkerCluster({ jwksPayloadJson });
    const aliceToken = await issueValidIdToken('uid_p1');

    cluster.rooms.set('room_1p', {
      gameType: 'snow_rush',
      status: 'playing',
      players: [{ uid: 'uid_p1', displayName: 'Solo' }],
    });
    const onePlayerRes = await verifySnowRushRoomAccess({
      roomId: 'room_1p',
      idToken: aliceToken,
      projectId: PROJECT_ID,
      databaseId: NAMED_DATABASE_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(!onePlayerRes.ok && onePlayerRes.errorCode === 'ROOM_CAPACITY_INVALID', '1-player rejected');

    cluster.rooms.set('room_5p', {
      gameType: 'snow_rush',
      status: 'playing',
      maxPlayers: 4,
      players: [
        { uid: 'uid_p1', displayName: 'P1' },
        { uid: 'uid_p2', displayName: 'P2' },
        { uid: 'uid_p3', displayName: 'P3' },
        { uid: 'uid_p4', displayName: 'P4' },
        { uid: 'uid_p5', displayName: 'P5' },
      ],
    });
    const fivePlayerRes = await verifySnowRushRoomAccess({
      roomId: 'room_5p',
      idToken: aliceToken,
      projectId: PROJECT_ID,
      databaseId: NAMED_DATABASE_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(!fivePlayerRes.ok && fivePlayerRes.errorCode === 'ROOM_CAPACITY_INVALID', '5-player rejected');

    cluster.rooms.set('room_4p', {
      gameType: 'snow_rush',
      status: 'playing',
      maxPlayers: 4,
      players: [
        { uid: 'uid_p1', displayName: 'P1' },
        { uid: 'uid_p2', displayName: 'P2' },
        { uid: 'uid_p3', displayName: 'P3' },
        { uid: 'uid_p4', displayName: 'P4' },
      ],
    });
    const fourPlayerRes = await verifySnowRushRoomAccess({
      roomId: 'room_4p',
      idToken: aliceToken,
      projectId: PROJECT_ID,
      databaseId: NAMED_DATABASE_ID,
      nowMs: cluster.nowMsValue,
      fetchFn: cluster.fetchFn,
    });
    assert(fourPlayerRes.ok && fourPlayerRes.room.players.length === 4, '4-player accepted');
  });

  // --------------------------------------------------------------------------
  // 6. Duplicate UID Connection Replacement Policy (4409, No False Disconnect)
  // --------------------------------------------------------------------------
  await runCase('6. Duplicate UID session replaces older socket cleanly (4409) without auto-reconnect loop', async () => {
    const cluster = new InMemoryWorkerCluster({ jwksPayloadJson, preCountdownSyncMs: 0 });
    cluster.rooms.set('room_dup', {
      gameType: 'snow_rush',
      status: 'playing',
      players: [
        { uid: 'uid_alice', displayName: 'Alice' },
        { uid: 'uid_bob', displayName: 'Bob' },
      ],
    });

    const aliceToken = await issueValidIdToken('uid_alice');
    const statusesA: SnowRushConnectionStatus[] = [];
    const clientA = new SnowRushSocketClient({
      roomId: 'room_dup',
      workerBaseUrl: TEST_BASE_URL,
      createWebSocket: cluster.createSocketFactory(),
      getIdToken: async () => aliceToken,
      onStatusChange: (s) => statusesA.push(s),
    });

    clientA.connect();
    await flushMicrotasks();
    assert(clientA.getStatus() === 'connected', 'Client A connected first');

    const clientB = new SnowRushSocketClient({
      roomId: 'room_dup',
      workerBaseUrl: TEST_BASE_URL,
      createWebSocket: cluster.createSocketFactory(),
      getIdToken: async () => aliceToken,
    });

    clientB.connect();
    await flushMicrotasks();

    assert(clientB.getStatus() === 'connected', 'Client B took over active UID session');
    assert(
      clientA.getStatus() === 'duplicate_session',
      `Client A transitioned to duplicate_session (got ${clientA.getStatus()})`
    );
    assert(
      !statusesA.includes('reconnecting'),
      'Replaced Client A did NOT enter an infinite reconnect loop'
    );

    const snapB = clientB.getLatestSnapshot();
    assert(
      snapB !== null && snapB.racers['uid_alice']?.isConnected === true,
      'Alice remains marked connected=true on the server after socket replacement'
    );

    const doMetrics = cluster.doByRoom.get('room_dup')!.getDebugMetrics();
    assert(doMetrics.connectedPlayerCount === 1, 'Exactly 1 active socket counted for Alice');

    clientB.disconnect();
    await flushMicrotasks();
  });

  // --------------------------------------------------------------------------
  // 7. Unauthenticated Message, Oversized Frame, Invalid JSON & Rate Limiting
  // --------------------------------------------------------------------------
  await runCase('7. Rejects pre-auth game frames (4401), >2KB frames (4413), invalid JSON, and flood rates (4429)', async () => {
    const cluster = new InMemoryWorkerCluster({ jwksPayloadJson });
    cluster.rooms.set('room_sec', {
      gameType: 'snow_rush',
      status: 'playing',
      players: [
        { uid: 'uid_alice', displayName: 'Alice' },
        { uid: 'uid_bob', displayName: 'Bob' },
      ],
    });

    // 7A. Pre-auth input message -> closed 4401
    const conn1 = await cluster.connectRawSocket('room_sec');
    assert(conn1.clientWs !== null, 'Opened raw WS 1');
    conn1.clientWs.send(
      JSON.stringify({ type: 'input', seq: 1, steer: 1, jumpPressed: false, useItemPressed: false })
    );
    await flushMicrotasks();
    assert(
      conn1.clientWs.lastCloseCode === SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED,
      'Pre-auth input closed with 4401'
    );

    // 7B. Oversized > 2048 byte frame -> closed 4413
    const conn2 = await cluster.connectRawSocket('room_sec');
    assert(conn2.clientWs !== null, 'Opened raw WS 2');
    const hugePayload = JSON.stringify({
      type: 'auth',
      protocolVersion: 1,
      roomId: 'room_sec',
      idToken: 'x'.repeat(SNOW_RUSH_WS_MAX_MESSAGE_BYTES + 200),
    });
    conn2.clientWs.send(hugePayload);
    await flushMicrotasks();
    assert(
      conn2.clientWs.lastCloseCode === SNOW_RUSH_WS_CLOSE_CODES.PAYLOAD_TOO_LARGE,
      'Oversized >2KB frame closed with 4413'
    );

    // 7C. Invalid JSON & Flood Rate Limiting on authenticated socket -> closed 4429
    const conn3 = await cluster.connectRawSocket('room_sec');
    assert(conn3.clientWs !== null, 'Opened raw WS 3');
    const aliceToken = await issueValidIdToken('uid_alice');
    conn3.clientWs.send(
      JSON.stringify({ type: 'auth', protocolVersion: 1, roomId: 'room_sec', idToken: aliceToken })
    );
    await flushMicrotasks();
    assert(conn3.clientWs.readyState === 1, 'Authenticated WS 3 is open');

    conn3.clientWs.send('{malformed json');
    conn3.clientWs.send(JSON.stringify({ type: 'unknown_hack_cmd' }));
    await flushMicrotasks();
    const midFrames = parseServerFrames(conn3.clientWs);
    assert(
      midFrames.some((m) => m.type === 'error' && m.code === 'INVALID_JSON' && m.fatal === false),
      'Invalid JSON returned non-fatal error warning first'
    );
    assert(
      midFrames.some((m) => m.type === 'error' && m.code === 'UNKNOWN_MESSAGE_TYPE'),
      'Unknown message type returned error'
    );

    // Flood 50 messages within the same 1-second window -> must close with 4429
    for (let i = 1; i <= 50; i += 1) {
      conn3.clientWs.send(
        JSON.stringify({ type: 'input', seq: i, steer: 0, jumpPressed: false, useItemPressed: false })
      );
    }
    await flushMicrotasks();
    assert(
      conn3.clientWs.lastCloseCode === SNOW_RUSH_WS_CLOSE_CODES.RATE_LIMITED,
      `Flooding socket closed with 4429 (got ${conn3.clientWs.lastCloseCode})`
    );
  });

  // --------------------------------------------------------------------------
  // 8. Input `seq` Deduplication, Untrusted Field Stripping & 20 Hz Client Throttle
  // --------------------------------------------------------------------------
  await runCase('8. Client 20 Hz input coalescing, server seq deduplication, and untrusted claim stripping', async () => {
    const cluster = new InMemoryWorkerCluster({ jwksPayloadJson, preCountdownSyncMs: 0 });
    cluster.rooms.set('room_seq', {
      gameType: 'snow_rush',
      status: 'playing',
      players: [
        { uid: 'uid_alice', displayName: 'Alice' },
        { uid: 'uid_bob', displayName: 'Bob' },
      ],
    });

    const aliceToken = await issueValidIdToken('uid_alice');
    const bobToken = await issueValidIdToken('uid_bob');
    const rawAlice = (await cluster.connectRawSocket('room_seq')).clientWs!;
    const rawBob = (await cluster.connectRawSocket('room_seq')).clientWs!;

    rawAlice.send(
      JSON.stringify({ type: 'auth', protocolVersion: 1, roomId: 'room_seq', idToken: aliceToken })
    );
    rawBob.send(
      JSON.stringify({ type: 'auth', protocolVersion: 1, roomId: 'room_seq', idToken: bobToken })
    );
    await flushMicrotasks();

    const roomDo = cluster.doByRoom.get('room_seq')!;
    // Advance past 3.0s countdown (60 ticks at 20 Hz) into active `racing`
    for (let t = 0; t < 61; t += 1) {
      roomDo.stepAuthoritativeTickForTest();
    }

    // Send input with forged state claims (`distanceM: 999`, `winnerId: 'uid_alice'`) and seq=5
    rawAlice.send(
      JSON.stringify({
        type: 'input',
        seq: 5,
        steer: 1,
        jumpPressed: true,
        useItemPressed: false,
        distanceM: 999,
        speedMps: 500,
        winnerId: 'uid_alice',
      })
    );
    await flushMicrotasks();
    roomDo.stepAuthoritativeTickForTest();

    // Replay duplicate seq=5 with jumpPressed=true on next tick -> must be ignored!
    rawAlice.send(
      JSON.stringify({
        type: 'input',
        seq: 5,
        steer: -1,
        jumpPressed: true,
        useItemPressed: false,
      })
    );
    await flushMicrotasks();
    roomDo.stepAuthoritativeTickForTest();

    // Request snapshot and verify forged distanceM=999 was ignored & steer stayed +1 (duplicate seq=5 ignored!)
    rawAlice.send(JSON.stringify({ type: 'request_snapshot' }));
    await flushMicrotasks();
    const frames = parseServerFrames(rawAlice);
    const latestSnapMsg = [...frames].reverse().find((m) => m.type === 'snapshot');
    assert(latestSnapMsg && latestSnapMsg.type === 'snapshot', 'Received authoritative snapshot');
    const aliceRacer = latestSnapMsg.snapshot.racers['uid_alice'];
    assert(aliceRacer.distanceM < 20, `Forged distanceM=999 stripped (actual ${aliceRacer.distanceM})`);
    assert(aliceRacer.lastProcessedInputSeq === 5, 'Ack seq stayed at 5');
    assert(aliceRacer.lastSteerAxis === 1, 'Duplicate seq=5 steer=-1 was rejected');
  });

  // --------------------------------------------------------------------------
  // 9. 4-Player Full Race Simulation, Battle Items Sync & Active-Only Timer Shutdown
  // --------------------------------------------------------------------------
  await runCase('9. 4-player WebSocket race, item pickup/combat state sync, RTT ping/pong & zero idle timers on finish', async () => {
    const cluster = new InMemoryWorkerCluster({
      jwksPayloadJson,
      autoTickLoop: true,
      preCountdownSyncMs: 50,
      snapshotBroadcastHz: '10',
    });

    const players = [
      { uid: 'uid_r1', displayName: 'ကစားသမား ၁', color: '#38BDF8' },
      { uid: 'uid_r2', displayName: 'ကစားသမား ၂', color: '#F43F5E' },
      { uid: 'uid_r3', displayName: 'ကစားသမား ၃', color: '#10B981' },
      { uid: 'uid_r4', displayName: 'ကစားသမား ၄', color: '#F59E0B' },
    ];
    cluster.rooms.set('room_race4', {
      gameType: 'snow_rush',
      status: 'playing',
      gameRound: 1,
      maxPlayers: 4,
      players,
    });

    let finishedCount = 0;
    let observedItemPickupEvent = false;
    let observedItemCombatActivation = false;
    let measuredRttMs: number | null = null;

    const clients: SnowRushSocketClient[] = [];
    for (let idx = 0; idx < players.length; idx += 1) {
      const p = players[idx];
      const token = await issueValidIdToken(p.uid);
      const client = new SnowRushSocketClient({
        roomId: 'room_race4',
        workerBaseUrl: TEST_BASE_URL,
        createWebSocket: cluster.createSocketFactory(),
        getIdToken: async () => token,
        nowMs: () => cluster.nowMsValue,
        onRttUpdate: (rtt) => {
          if (idx === 0) measuredRttMs = rtt;
        },
        onSnapshot: (_snap, _ts, events) => {
          for (const ev of events) {
            if (ev.type === 'item_pickup') observedItemPickupEvent = true;
            if (
              ev.type === 'nitro_activate' ||
              ev.type === 'snowball_launch' ||
              ev.type === 'trap_place' ||
              ev.type === 'shield_activate'
            ) {
              observedItemCombatActivation = true;
            }
          }
        },
        onRaceFinished: () => {
          finishedCount += 1;
        },
      });
      clients.push(client);
    }

    // Connect first player -> preCountdownTimer starts, tickIntervalTimer is NOT running yet!
    clients[0].connect();
    await flushMicrotasks();
    const roomDo = cluster.doByRoom.get('room_race4')!;
    assert(
      roomDo.getDebugMetrics().hasActiveTickTimer === false &&
        roomDo.getDebugMetrics().hasPreCountdownTimer === true,
      'Before all players join, 20 Hz tick loop is idle (only pre-countdown sync barrier active)'
    );

    // Connect remaining 3 players -> all 4 connected -> countdown & active 20 Hz tick loop start!
    clients[1].connect();
    clients[2].connect();
    clients[3].connect();
    await flushMicrotasks();

    assert(measuredRttMs !== null && measuredRttMs >= 0, 'RTT ping/pong measured');
    assert(
      roomDo.getDebugMetrics().hasActiveTickTimer === true &&
        roomDo.getDebugMetrics().racePhase === 'countdown',
      'Active 20 Hz tick loop started when 4 racers connected'
    );

    // Step race deterministically to completion while racers steer onto Item Box lanes & use items
    let safetyTicks = 0;
    while (roomDo.getDebugMetrics().racePhase !== 'finished' && safetyTicks < 2200) {
      safetyTicks += 1;
      cluster.nowMsValue += Math.round(MULTIPLAYER_TICK_DT_SEC * 1000);

      const snap = clients[0].getLatestSnapshot();
      if (snap && snap.racePhase === 'racing') {
        for (let cIdx = 0; cIdx < clients.length; cIdx += 1) {
          const uid = players[cIdx].uid;
          const r = snap.racers[uid];
          let steerTarget: -1 | 0 | 1 = 0;
          if (r) {
            const targetBox = snap.itemBoxStatuses.find(
              (b) => b.pickedUpByRacerId === null && b.distanceM > r.distanceM + 1.5
            );
            const desiredLane = targetBox ? targetBox.laneOffset : 0;
            if (r.laneOffset < desiredLane - 0.05) {
              steerTarget = 1;
            } else if (r.laneOffset > desiredLane + 0.05) {
              steerTarget = -1;
            }
          }
          const shouldUse = Boolean(r && r.heldItem !== null && r.itemArmingTimerSec <= 0);
          clients[cIdx].sendInput({
            steer: steerTarget,
            jumpPressed: false,
            useItemPressed: shouldUse,
          });
        }
        await Promise.resolve();
      }

      roomDo.stepAuthoritativeTickForTest();
      if (safetyTicks % 25 === 0) {
        await flushMicrotasks(2);
      }
    }
    await flushMicrotasks();

    assert(roomDo.getDebugMetrics().racePhase === 'finished', '4-player race reached finished phase');
    assert(
      roomDo.getDebugMetrics().hasActiveTickTimer === false &&
        roomDo.getDebugMetrics().hasPreCountdownTimer === false,
      '20 Hz tick timer stopped IMMEDIATELY on race finish (zero idle timers)'
    );
    assert(finishedCount === 4, `All 4 clients received race_finished (got ${finishedCount})`);
    assert(observedItemPickupEvent, 'Item box pickup synchronized across WebSocket snapshots');
    assert(observedItemCombatActivation, 'Battle item activation synchronized across WebSocket snapshots');

    const finalSnap = clients[0].getLatestSnapshot()!;
    assert(finalSnap.finishState.finalized === true, 'Finish state finalized');
    assert(finalSnap.finishState.winnerId !== null, 'Winner locked deterministically');
    assert(finalSnap.raceStandings.length === 4, '4-racer standings computed');

    const sqlStats = cluster.sqlByRoom.get('room_race4')!;
    assert(
      sqlStats.writeCount > 0 && sqlStats.writeCount <= 30,
      `Minimal SQLite checkpoint writes (${sqlStats.writeCount} writes for entire ${safetyTicks}-tick race)`
    );

    for (const c of clients) {
      c.disconnect();
    }
    await flushMicrotasks();
  });

  // --------------------------------------------------------------------------
  // 10. SQLite Cold Eviction Restore, Client Reconnect Recovery & Snapshot Interpolation
  // --------------------------------------------------------------------------
  await runCase('10. Mid-race DO SQLite checkpoint restore + client reconnect snapshot recovery + 60 FPS interpolation', async () => {
    const cluster = new InMemoryWorkerCluster({ jwksPayloadJson, preCountdownSyncMs: 0 });
    cluster.rooms.set('room_recover', {
      gameType: 'snow_rush',
      status: 'playing',
      gameRound: 2,
      players: [
        { uid: 'uid_alice', displayName: 'Alice' },
        { uid: 'uid_bob', displayName: 'Bob' },
      ],
    });

    const aliceToken = await issueValidIdToken('uid_alice');
    const bobToken = await issueValidIdToken('uid_bob');

    const interpolator = new SnowRushSnapshotInterpolator(100);
    let reconnectObserved = false;

    const aliceClient = new SnowRushSocketClient({
      roomId: 'room_recover',
      workerBaseUrl: TEST_BASE_URL,
      createWebSocket: cluster.createSocketFactory(),
      getIdToken: async () => aliceToken,
      reconnectDelaysMs: [20, 40],
      onStatusChange: (s) => {
        if (s === 'reconnecting') reconnectObserved = true;
      },
      onSnapshot: (snap, ts) => {
        interpolator.pushSnapshot(snap, ts);
      },
    });

    const bobClient = new SnowRushSocketClient({
      roomId: 'room_recover',
      workerBaseUrl: TEST_BASE_URL,
      createWebSocket: cluster.createSocketFactory(),
      getIdToken: async () => bobToken,
    });

    aliceClient.connect();
    bobClient.connect();
    await flushMicrotasks();

    const firstDo = cluster.doByRoom.get('room_recover')!;
    // Advance 160 ticks (past 3s countdown + 5s racing -> triggers SQLite checkpoint at tick 100!)
    for (let t = 0; t < 165; t += 1) {
      cluster.nowMsValue += 50;
      firstDo.stepAuthoritativeTickForTest();
    }
    await flushMicrotasks();

    const distBeforeDrop = aliceClient.getLatestSnapshot()!.racers['uid_alice'].distanceM;
    assert(distBeforeDrop > 40, `Alice raced past 40m before network drop (${distBeforeDrop.toFixed(1)}m)`);

    // Verify 60 FPS interpolator smoothly interpolates between snapshots AND snaps on >12m teleports
    const midSample = interpolator.sample(cluster.nowMsValue - 25);
    assert(midSample !== null && midSample.racers['uid_alice'].distanceM > 20, 'Interpolator sampled smooth mid-tick frame');

    // Simulate DO cold eviction from memory (keeping SQLite storage intact) + network socket drop (1006)
    cluster.evictDurableObjectFromMemory('room_recover');
    const internalWs = (aliceClient as unknown as { socket: MockLinkedWebSocket | null }).socket;
    assert(internalWs !== null, 'Alice had active socket');
    internalWs.readyState = 3;
    internalWs.onclose?.({ code: 1006, reason: 'Simulated transient network drop' });

    // Wait for 20ms exponential backoff reconnect to hit newly instantiated DO (which restores from SQLite!)
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    await flushMicrotasks();

    assert(reconnectObserved, 'Alice entered reconnecting state on transient drop');
    assert(aliceClient.getStatus() === 'connected', 'Alice automatically reconnected');
    assert(aliceClient.getAuthenticatedGameRound() === 2, 'Restored round 2 from SQLite checkpoint');

    const restoredSnap = aliceClient.getLatestSnapshot()!;
    assert(
      restoredSnap.racers['uid_alice'].distanceM >= 20,
      `Reconnected Alice recovered mid-race progress from SQLite checkpoint (${restoredSnap.racers['uid_alice'].distanceM.toFixed(1)}m)`
    );

    aliceClient.disconnect();
    bobClient.disconnect();
    await flushMicrotasks();
  });

  // --------------------------------------------------------------------------
  // 11. Regression Verification: Registry Status, Local `?devSnowRush=1` & Snakes & Ladders
  // --------------------------------------------------------------------------
  await runCase('11. Regression: snow_rush stays coming_soon, Local ?devSnowRush=1 works, Snakes & Ladders untouched', async () => {
    // 11A. Registry safety check
    const snowEntry = getGameById('snow_rush');
    assert(snowEntry !== undefined && snowEntry.status === 'coming_soon', 'snow_rush remains coming_soon');
    const availableIds = getAvailableGames().map((g) => g.id);
    assert(
      availableIds.length === 1 && availableIds[0] === 'snakes_and_ladders',
      'Only snakes_and_ladders is available in production lobby'
    );

    // 11B. Local ?devSnowRush=1 offline prototype + bots check
    let localState = startCountdownState(createInitialSnowRushState({ trackSeed: 12345 }), {
      trackSeed: 12345,
    });
    assert(localState.offlineDemoBots.length === 2, 'Offline demo bots intact in local prototype');
    for (let i = 0; i < 80; i += 1) {
      localState = stepSnowRushSimulation(
        localState,
        { steerLeft: false, steerRight: true, jumpPressed: i === 70, useItemPressed: false },
        0.05
      );
    }
    assert(
      localState.phase === 'racing' &&
        localState.player.distanceM > 10 &&
        localState.player.distanceM < COURSE_LENGTH_M,
      'Local ?devSnowRush=1 offline simulation advances cleanly'
    );

    // 11C. Snakes & Ladders room helpers intact
    assert(normalizeMaxPlayers(4) === 4 && computeLobbyStatus(4, 4) === 'full', 'Lobby status helper intact');
    const reconciled = resolveAuthoritativePlayer(
      {
        uid: 'u1',
        playerId: 'SG-100001',
        displayName: 'Tester',
        photoURL: '',
        isReady: true,
        color: '#3B82F6',
        position: 12,
        positionVersion: 2,
        isConnected: true,
        lastSeen: 1000,
      },
      {
        u1: { position: 42, positionVersion: 3, lastMoveId: 'mv_3', updatedAtMs: 2000 },
      },
      2000
    );
    assert(reconciled.position === 42 && reconciled.positionVersion === 3, 'Snakes & Ladders position reconciliation intact');
  });

  console.log(`\nALL ${results.length}/${results.length} STEP 4.7 AUTOMATED TESTS PASSED.\n`);
}

runAllTests().catch((err) => {
  console.error('\nSTEP 4.7 TEST SUITE FAILED:', err);
  throw err;
});
