import {
  MULTIPLAYER_TICK_DT_SEC,
  MULTIPLAYER_TICK_HZ,
} from '../../../src/games/snow-rush/constants';
import {
  buildMultiplayerSnapshot,
  createInitialMultiplayerRaceState,
  hashStableUid,
  restoreMultiplayerStateFromSnapshot,
  setMultiplayerRacerConnection,
  startMultiplayerCountdown,
  stepMultiplayerSnowRushTick,
} from '../../../src/games/snow-rush/engine';
import type {
  MultiplayerRaceEvent,
  MultiplayerRaceState,
  SnowRushInputFrame,
  SnowRushSnapshot,
} from '../../../src/games/snow-rush/engine';
import { normalizeTrackSeed } from '../../../src/games/snow-rush/track';
import {
  isValidSnowRushRoomId,
  parseSnowRushClientMessage,
  SNOW_RUSH_DEFAULT_SNAPSHOT_HZ,
  SNOW_RUSH_MAX_SNAPSHOT_HZ,
  SNOW_RUSH_MIN_SNAPSHOT_HZ,
  SNOW_RUSH_PROTOCOL_VERSION,
  SNOW_RUSH_SERVER_AUTH_TIMEOUT_MS,
  SNOW_RUSH_WS_CLOSE_CODES,
  SNOW_RUSH_WS_HARD_RATE_LIMIT_PER_SEC,
  SNOW_RUSH_WS_SOFT_RATE_LIMIT_PER_SEC,
} from '../../../src/games/snow-rush/network/protocol';
import type {
  SnowRushNetworkErrorCode,
  SnowRushServerMessage,
  SnowRushWsCloseCode,
} from '../../../src/games/snow-rush/network/protocol';
import { verifySnowRushRoomAccess } from './auth/verifyFirebaseToken';
import type { FetchLike, VerifiedSnowRushRoom } from './auth/verifyFirebaseToken';
import type { DurableObjectState, SnowRushWorkerEnv, SqlStorageValue } from './cloudflareTypes';

/**
 * Snow Rush: Avalanche Escape — Step 4.7 Room Durable Object (`SnowRushRoomDO`)
 *
 * 1 Durable Object = 1 Active Snow Rush Room:
 * - SQLite-backed Durable Object (`new_sqlite_classes = ["SnowRushRoomDO"]`) for Free-Tier compatibility
 *   and minimal crash-recovery checkpointing (~12–15 SQLite writes per entire race, NEVER per tick).
 * - Duplicate UID Policy: Replace-Oldest (single active WebSocket per UID; prior socket receives
 *   `DUPLICATE_SESSION_REPLACED` and closes with `4409` without marking the racer disconnected).
 * - Active-Only `20 Hz` (`50 ms`) simulation loop: runs ONLY while `phase` is `countdown`, `racing`,
 *   or `finish_window`. Immediately stops upon `finished` or room abandonment (zero idle timers).
 * - Configurable `10–20 Hz` snapshot broadcast (default `10 Hz`) + immediate broadcast on lifecycle
 *   and combat events.
 * - Never writes race coordinates, `status: 'finished'`, `winnerId`, XP, or Points to Firestore.
 */

const TICK_INTERVAL_MS = Math.round(1000 / MULTIPLAYER_TICK_HZ); // 50 ms (20 Hz)
const DEFAULT_PRE_COUNTDOWN_SYNC_MS = 1200; // Wait up to 1.2s for all 2–4 racers before 3-2-1 countdown
const SQLITE_CHECKPOINT_EVERY_TICKS = 100; // Every 5 seconds (100 ticks at 20 Hz)
const ABANDONED_RACE_STOP_MS = 60_000; // Stop simulation if 0 sockets remain connected for 60s
const POST_FINISH_STORAGE_CLEANUP_ALARM_MS = 300_000; // Clean up SQLite checkpoint 5 min after finish
const MAX_INVALID_MESSAGES_PER_SOCKET = 5;

interface SocketSessionState {
  readonly socketId: number;
  uid: string | null;
  authenticated: boolean;
  authenticating: boolean;
  replacedByNewSession: boolean;
  connectedAtMs: number;
  windowStartMs: number;
  windowMessageCount: number;
  warnedRateLimitInWindow: boolean;
  invalidMessageCount: number;
  authTimeoutTimer: ReturnType<typeof setTimeout> | null;
}

interface PersistedRaceCheckpointRow extends Record<string, SqlStorageValue> {
  room_id: string;
  game_round: number;
  updated_at_ms: number;
  snapshot_json: string;
}

export interface SnowRushRoomDOOverrides {
  readonly fetchFn?: FetchLike;
  readonly nowMs?: () => number;
  readonly jwksUrl?: string;
  readonly preCountdownSyncMs?: number;
  readonly autoTickLoop?: boolean;
}

function clampSnapshotHz(rawValue: string | undefined): number {
  if (!rawValue) return SNOW_RUSH_DEFAULT_SNAPSHOT_HZ;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return SNOW_RUSH_DEFAULT_SNAPSHOT_HZ;
  return Math.max(SNOW_RUSH_MIN_SNAPSHOT_HZ, Math.min(SNOW_RUSH_MAX_SNAPSHOT_HZ, parsed));
}

function isCombatOrMilestoneEvent(events: readonly MultiplayerRaceEvent[]): boolean {
  for (let i = 0; i < events.length; i += 1) {
    const type = events[i].type;
    if (
      type === 'race_started' ||
      type === 'item_pickup' ||
      type === 'nitro_activate' ||
      type === 'snowball_launch' ||
      type === 'snowball_hit' ||
      type === 'trap_place' ||
      type === 'trap_hit' ||
      type === 'shield_activate' ||
      type === 'shield_break' ||
      type === 'racer_snow_tumble' ||
      type === 'racer_recovery' ||
      type === 'racer_finished' ||
      type === 'finish_window_started' ||
      type === 'race_finalized'
    ) {
      return true;
    }
  }
  return false;
}

export class SnowRushRoomDO {
  private readonly ctx: DurableObjectState;
  private readonly env: SnowRushWorkerEnv;
  private readonly fetchFn: FetchLike;
  private readonly nowMs: () => number;
  private readonly jwksUrl: string | undefined;
  private readonly preCountdownSyncMs: number;
  private readonly autoTickLoop: boolean;
  private readonly snapshotHz: number;
  private readonly ticksPerBroadcast: number;

  private sqlTableReady = false;
  private checkpointLoaded = false;

  private roomId: string | null = null;
  private gameRound = 0;
  private expectedPlayerCount = 0;
  private raceState: MultiplayerRaceState | null = null;

  private nextSocketId = 1;
  private readonly sessionsBySocket = new Map<WebSocket, SocketSessionState>();
  private readonly activeSocketByUid = new Map<string, WebSocket>();
  private readonly pendingInputsByUid = new Map<string, SnowRushInputFrame>();

  private preCountdownTimer: ReturnType<typeof setTimeout> | null = null;
  private tickIntervalTimer: ReturnType<typeof setInterval> | null = null;
  private allDisconnectedSinceMs: number | null = null;
  private ticksSinceLastBroadcast = 0;
  private ticksSinceLastCheckpoint = 0;
  private pendingBroadcastEvents: MultiplayerRaceEvent[] = [];

  constructor(
    ctx: DurableObjectState,
    env: SnowRushWorkerEnv,
    overrides?: SnowRushRoomDOOverrides
  ) {
    this.ctx = ctx;
    this.env = env;
    this.fetchFn = overrides?.fetchFn ?? fetch;
    this.nowMs = overrides?.nowMs ?? (() => Date.now());
    this.jwksUrl = overrides?.jwksUrl;
    this.preCountdownSyncMs = overrides?.preCountdownSyncMs ?? DEFAULT_PRE_COUNTDOWN_SYNC_MS;
    this.autoTickLoop = overrides?.autoTickLoop ?? true;
    this.snapshotHz = clampSnapshotHz(env.SNAPSHOT_BROADCAST_HZ);
    this.ticksPerBroadcast = Math.max(1, Math.round(MULTIPLAYER_TICK_HZ / this.snapshotHz));
  }

  /**
   * Diagnostics helper for deterministic tests (never exposed to untrusted clients).
   */
  public getDebugMetrics(): {
    readonly hasActiveTickTimer: boolean;
    readonly hasPreCountdownTimer: boolean;
    readonly connectedPlayerCount: number;
    readonly totalSocketCount: number;
    readonly racePhase: string | null;
    readonly serverTick: number;
    readonly gameRound: number;
  } {
    return {
      hasActiveTickTimer: this.tickIntervalTimer !== null,
      hasPreCountdownTimer: this.preCountdownTimer !== null,
      connectedPlayerCount: this.activeSocketByUid.size,
      totalSocketCount: this.sessionsBySocket.size,
      racePhase: this.raceState?.phase ?? null,
      serverTick: this.raceState?.serverTick ?? 0,
      gameRound: this.gameRound,
    };
  }

  /**
   * Manual deterministic step hook used by automated tests when `autoTickLoop` is false
   * (or to advance exact ticks deterministically).
   */
  public stepAuthoritativeTickForTest(): void {
    this.executeSimulationTick();
  }

  public async fetch(request: Request): Promise<Response> {
    this.ensureCheckpointRestored();

    const headerRoomId = request.headers.get('X-Snow-Rush-Room-Id');
    const url = new URL(request.url);
    const pathMatch = /^\/ws\/snow-rush\/([^/]+)$/.exec(url.pathname);
    const candidateRoomId =
      headerRoomId ?? (pathMatch ? decodeURIComponent(pathMatch[1]) : null);

    if (!isValidSnowRushRoomId(candidateRoomId)) {
      return new Response(JSON.stringify({ error: 'Invalid Snow Rush roomId.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response(JSON.stringify({ error: 'Expected WebSocket Upgrade header.' }), {
        status: 426,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (this.roomId !== null && this.roomId !== candidateRoomId) {
      return new Response(JSON.stringify({ error: 'Room ID mismatch for Durable Object.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    this.roomId = candidateRoomId;

    const pair = new WebSocketPair();
    const clientWs = pair[0];
    const serverWs = pair[1];

    this.ctx.acceptWebSocket(serverWs);

    const now = this.nowMs();
    const session: SocketSessionState = {
      socketId: this.nextSocketId++,
      uid: null,
      authenticated: false,
      authenticating: false,
      replacedByNewSession: false,
      connectedAtMs: now,
      windowStartMs: now,
      windowMessageCount: 0,
      warnedRateLimitInWindow: false,
      invalidMessageCount: 0,
      authTimeoutTimer: setTimeout(() => {
        const current = this.sessionsBySocket.get(serverWs);
        if (current && !current.authenticated) {
          this.sendErrorAndClose(
            serverWs,
            'AUTH_TIMEOUT',
            'WebSocket အကောင့်အတည်ပြုချိန် ကျော်လွန်သွားပါသည်။',
            SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED
          );
        }
      }, SNOW_RUSH_SERVER_AUTH_TIMEOUT_MS),
    };

    serverWs.serializeAttachment({ socketId: session.socketId, roomId: candidateRoomId });
    this.sessionsBySocket.set(serverWs, session);

    return new Response(null, {
      status: 101,
      webSocket: clientWs,
    });
  }

  public async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    this.ensureCheckpointRestored();

    const session = this.sessionsBySocket.get(ws);
    if (!session) {
      this.safeCloseSocket(ws, SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED, 'Unknown socket session');
      return;
    }

    // Binary frames are disallowed in the Snow Rush JSON protocol
    if (typeof rawMessage !== 'string') {
      this.sendErrorAndClose(
        ws,
        'INVALID_PAYLOAD',
        'Text JSON WebSocket frames only.',
        SNOW_RUSH_WS_CLOSE_CODES.BAD_REQUEST
      );
      return;
    }

    // Per-connection sliding 1-second message rate limiter
    const now = this.nowMs();
    if (now - session.windowStartMs >= 1000) {
      session.windowStartMs = now;
      session.windowMessageCount = 0;
      session.warnedRateLimitInWindow = false;
    }
    session.windowMessageCount += 1;

    if (session.windowMessageCount > SNOW_RUSH_WS_HARD_RATE_LIMIT_PER_SEC) {
      this.sendErrorAndClose(
        ws,
        'RATE_LIMIT_EXCEEDED',
        'ခလုတ်ပို့လွှတ်မှုနှုန်း သတ်မှတ်ပမာဏထက် ကျော်လွန်နေပါသည်။',
        SNOW_RUSH_WS_CLOSE_CODES.RATE_LIMITED
      );
      return;
    }

    if (session.windowMessageCount > SNOW_RUSH_WS_SOFT_RATE_LIMIT_PER_SEC) {
      if (!session.warnedRateLimitInWindow) {
        session.warnedRateLimitInWindow = true;
        this.sendToSocket(ws, {
          type: 'error',
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Input rate throttled to 20 Hz.',
          fatal: false,
        });
      }
      return;
    }

    const parsed = parseSnowRushClientMessage(rawMessage);
    if (!parsed.ok) {
      if (parsed.errorCode === 'MESSAGE_TOO_LARGE' || !session.authenticated) {
        this.sendErrorAndClose(ws, parsed.errorCode, parsed.reason, parsed.closeCode);
        return;
      }

      session.invalidMessageCount += 1;
      if (session.invalidMessageCount >= MAX_INVALID_MESSAGES_PER_SOCKET) {
        this.sendErrorAndClose(ws, parsed.errorCode, parsed.reason, parsed.closeCode);
        return;
      }

      this.sendToSocket(ws, {
        type: 'error',
        code: parsed.errorCode,
        message: parsed.reason,
        fatal: false,
      });
      return;
    }

    const msg = parsed.message;

    // Require `auth` as the very first protocol action before accepting any gameplay frames
    if (!session.authenticated) {
      if (msg.type !== 'auth') {
        this.sendErrorAndClose(
          ws,
          'UNAUTHENTICATED_MESSAGE',
          'Must authenticate with Firebase ID token before sending game messages.',
          SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED
        );
        return;
      }
      if (session.authenticating) {
        return;
      }
      await this.handleAuthenticateMessage(ws, session, msg.roomId, msg.idToken);
      return;
    }

    // Authenticated message routing
    switch (msg.type) {
      case 'auth': {
        // Already authenticated on this socket; send fresh snapshot confirmation
        if (this.raceState && session.uid) {
          this.sendToSocket(ws, {
            type: 'snapshot',
            serverTimeMs: now,
            snapshot: buildMultiplayerSnapshot(this.raceState),
          });
        }
        return;
      }

      case 'ping': {
        this.sendToSocket(ws, {
          type: 'pong',
          clientSentAtMs: msg.clientSentAtMs,
          serverTimeMs: now,
        });
        return;
      }

      case 'request_snapshot': {
        if (this.raceState) {
          this.sendToSocket(ws, {
            type: 'snapshot',
            serverTimeMs: now,
            snapshot: buildMultiplayerSnapshot(this.raceState),
          });
        }
        return;
      }

      case 'input': {
        if (!session.uid || !this.raceState || this.raceState.phase === 'finished') {
          return;
        }
        const uid = session.uid;
        if (!Object.prototype.hasOwnProperty.call(this.raceState.racers, uid)) {
          return;
        }

        const existingPending = this.pendingInputsByUid.get(uid);
        if (!existingPending) {
          this.pendingInputsByUid.set(uid, {
            steer: msg.steer,
            jumpPressed: msg.jumpPressed,
            useItemPressed: msg.useItemPressed,
            seq: msg.seq,
          });
        } else if (msg.seq > existingPending.seq) {
          // Coalesce sub-tick rapid edges while advancing monotonic seq
          this.pendingInputsByUid.set(uid, {
            steer: msg.steer,
            jumpPressed: existingPending.jumpPressed || msg.jumpPressed,
            useItemPressed: existingPending.useItemPressed || msg.useItemPressed,
            seq: msg.seq,
          });
        }
        return;
      }
    }
  }

  public async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    this.cleanupClosedSocket(ws);
  }

  public async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    this.cleanupClosedSocket(ws);
  }

  public async alarm(): Promise<void> {
    // Post-finish or idle storage cleanup alarm: wipe stale race checkpoint when no sockets remain
    if (
      this.activeSocketByUid.size === 0 &&
      (!this.raceState || this.raceState.phase === 'finished')
    ) {
      this.stopAllTimers();
      this.clearSqliteCheckpoint();
      this.raceState = null;
    }
  }

  // ==========================================================================
  // Internal Auth & Room Lifecycle
  // ==========================================================================

  private async handleAuthenticateMessage(
    ws: WebSocket,
    session: SocketSessionState,
    claimedRoomId: string,
    idToken: string
  ): Promise<void> {
    if (this.roomId !== null && claimedRoomId !== this.roomId) {
      this.sendErrorAndClose(
        ws,
        'ROOM_VERIFY_FAILED',
        'Auth roomId does not match WebSocket endpoint roomId.',
        SNOW_RUSH_WS_CLOSE_CODES.BAD_REQUEST
      );
      return;
    }

    session.authenticating = true;

    const verifyResult = await verifySnowRushRoomAccess({
      roomId: claimedRoomId,
      idToken,
      projectId: this.env.FIREBASE_PROJECT_ID,
      databaseId: this.env.FIRESTORE_DATABASE_ID,
      nowMs: this.nowMs(),
      fetchFn: this.fetchFn,
      jwksUrl: this.jwksUrl,
    });

    // Socket may have closed while awaiting async JWKS / Firestore verification
    if (!this.sessionsBySocket.has(ws)) {
      return;
    }

    session.authenticating = false;

    if (!verifyResult.ok) {
      this.sendErrorAndClose(
        ws,
        verifyResult.errorCode,
        verifyResult.message,
        verifyResult.closeCode
      );
      return;
    }

    if (session.authTimeoutTimer !== null) {
      clearTimeout(session.authTimeoutTimer);
      session.authTimeoutTimer = null;
    }

    const { token, room } = verifyResult;
    const uid = token.uid;

    // Initialize or advance authoritative room race state for verified `gameRound`
    const roundOk = this.ensureAuthoritativeRaceForVerifiedRoom(room);
    if (!roundOk || !this.raceState) {
      this.sendErrorAndClose(
        ws,
        'ROOM_ROUND_MISMATCH',
        'Stale gameRound rejected by Snow Rush room server.',
        SNOW_RUSH_WS_CLOSE_CODES.ROOM_INVALID_STATE
      );
      return;
    }

    // Enforce 2–4 player roster membership on active race state
    if (!Object.prototype.hasOwnProperty.call(this.raceState.racers, uid)) {
      this.sendErrorAndClose(
        ws,
        'NOT_ROOM_MEMBER',
        'Authenticated UID is not part of the locked race starting grid.',
        SNOW_RUSH_WS_CLOSE_CODES.FORBIDDEN_ROOM
      );
      return;
    }

    // Explicit Duplicate UID Session Policy: Replace-Oldest
    const previousWs = this.activeSocketByUid.get(uid);
    if (previousWs && previousWs !== ws) {
      const prevSession = this.sessionsBySocket.get(previousWs);
      if (prevSession) {
        prevSession.replacedByNewSession = true;
        prevSession.uid = null;
        prevSession.authenticated = false;
      }
      this.sendToSocket(previousWs, {
        type: 'error',
        code: 'DUPLICATE_SESSION_REPLACED',
        message: 'အခြား စက် သို့မဟုတ် Tab အသစ်မှ ဝင်ရောက်လာသဖြင့် ယခင်ချိတ်ဆက်မှုကို ပိတ်လိုက်ပါသည်။',
        fatal: true,
      });
      this.safeCloseSocket(
        previousWs,
        SNOW_RUSH_WS_CLOSE_CODES.DUPLICATE_SESSION,
        'Duplicate UID session replaced'
      );
      this.sessionsBySocket.delete(previousWs);
    }

    // Bind new authenticated socket
    session.uid = uid;
    session.authenticated = true;
    this.activeSocketByUid.set(uid, ws);
    this.allDisconnectedSinceMs = null;

    this.raceState = setMultiplayerRacerConnection(this.raceState, uid, true);
    const snapshot = buildMultiplayerSnapshot(this.raceState);

    this.sendToSocket(ws, {
      type: 'welcome',
      protocolVersion: SNOW_RUSH_PROTOCOL_VERSION,
      roomId: room.roomId,
      gameRound: this.gameRound,
      uid,
      snapshotHz: this.snapshotHz,
      serverTimeMs: this.nowMs(),
      snapshot,
    });

    this.broadcastExcept(ws, {
      type: 'player_connection',
      uid,
      isConnected: true,
      connectedCount: this.activeSocketByUid.size,
    });

    this.maybeStartCountdownAndSimulationLoop();
  }

  private ensureAuthoritativeRaceForVerifiedRoom(room: VerifiedSnowRushRoom): boolean {
    this.roomId = room.roomId;

    // Reject stale round below current round
    if (this.raceState !== null && room.gameRound < this.gameRound) {
      return false;
    }

    // Create fresh authoritative race when none exists OR when Play Again incremented `gameRound`
    if (this.raceState === null || room.gameRound > this.gameRound) {
      this.stopAllTimers();
      this.pendingInputsByUid.clear();

      const deterministicSeed = normalizeTrackSeed(
        hashStableUid(`${room.roomId}:round:${room.gameRound}`)
      );

      let initial = createInitialMultiplayerRaceState({
        players: room.players,
        trackSeed: deterministicSeed,
      });

      // Mark all racers disconnected until each socket authenticates
      for (let i = 0; i < initial.racerOrder.length; i += 1) {
        initial = setMultiplayerRacerConnection(initial, initial.racerOrder[i], false);
      }

      this.gameRound = room.gameRound;
      this.expectedPlayerCount = room.players.length;
      this.raceState = initial;
      this.ticksSinceLastBroadcast = 0;
      this.ticksSinceLastCheckpoint = 0;
      this.pendingBroadcastEvents = [];
      this.writeSqliteCheckpoint(buildMultiplayerSnapshot(initial));
    }

    return true;
  }

  private maybeStartCountdownAndSimulationLoop(): void {
    if (!this.raceState) return;

    if (this.raceState.phase === 'finished') {
      this.stopAllTimers();
      return;
    }

    if (this.raceState.phase === 'ready') {
      const allExpectedConnected =
        this.expectedPlayerCount > 0 &&
        this.activeSocketByUid.size >= this.expectedPlayerCount;

      if (allExpectedConnected || this.preCountdownSyncMs <= 0) {
        this.transitionReadyToCountdown();
      } else if (this.preCountdownTimer === null) {
        this.preCountdownTimer = setTimeout(() => {
          this.preCountdownTimer = null;
          if (this.raceState && this.raceState.phase === 'ready' && this.activeSocketByUid.size > 0) {
            this.transitionReadyToCountdown();
          }
        }, this.preCountdownSyncMs);
      }
      return;
    }

    // Already in `countdown` / `racing` / `finish_window` (e.g. restored from SQLite checkpoint)
    this.ensureTickLoopRunning();
  }

  private transitionReadyToCountdown(): void {
    if (!this.raceState || this.raceState.phase !== 'ready') return;
    if (this.preCountdownTimer !== null) {
      clearTimeout(this.preCountdownTimer);
      this.preCountdownTimer = null;
    }

    this.raceState = startMultiplayerCountdown(this.raceState);
    const snap = buildMultiplayerSnapshot(this.raceState);
    this.writeSqliteCheckpoint(snap);

    this.broadcastAll({
      type: 'snapshot',
      serverTimeMs: this.nowMs(),
      snapshot: snap,
      events: this.raceState.events,
    });

    this.ensureTickLoopRunning();
  }

  private ensureTickLoopRunning(): void {
    if (!this.autoTickLoop) return;
    if (this.tickIntervalTimer !== null) return;
    if (
      !this.raceState ||
      (this.raceState.phase !== 'countdown' &&
        this.raceState.phase !== 'racing' &&
        this.raceState.phase !== 'finish_window')
    ) {
      return;
    }

    this.tickIntervalTimer = setInterval(() => {
      this.executeSimulationTick();
    }, TICK_INTERVAL_MS);
  }

  private executeSimulationTick(): void {
    if (!this.raceState) {
      this.stopAllTimers();
      return;
    }

    if (this.raceState.phase === 'finished' || this.raceState.phase === 'ready') {
      this.stopAllTimers();
      return;
    }

    const now = this.nowMs();

    // Abandoned-room safeguard: if every player disconnected for >= 60s, halt loop & save Free-tier duration
    if (this.activeSocketByUid.size === 0) {
      if (this.allDisconnectedSinceMs === null) {
        this.allDisconnectedSinceMs = now;
      } else if (now - this.allDisconnectedSinceMs >= ABANDONED_RACE_STOP_MS) {
        this.writeSqliteCheckpoint(buildMultiplayerSnapshot(this.raceState));
        this.stopAllTimers();
        void this.scheduleCleanupAlarm(now + POST_FINISH_STORAGE_CLEANUP_ALARM_MS);
        return;
      }
    } else {
      this.allDisconnectedSinceMs = null;
    }

    const prevPhase = this.raceState.phase;
    const inputsRecord: Record<string, SnowRushInputFrame> = {};
    for (const [uid, inputFrame] of this.pendingInputsByUid.entries()) {
      inputsRecord[uid] = inputFrame;
    }
    this.pendingInputsByUid.clear();

    this.raceState = stepMultiplayerSnowRushTick(
      this.raceState,
      inputsRecord,
      MULTIPLAYER_TICK_DT_SEC
    );

    const events = this.raceState.events;
    if (events.length > 0) {
      this.pendingBroadcastEvents.push(...events);
    }
    const phaseChanged = this.raceState.phase !== prevPhase;
    this.ticksSinceLastBroadcast += 1;
    this.ticksSinceLastCheckpoint += 1;

    // Immediate termination & final broadcast when race reaches `finished`
    if (this.raceState.phase === 'finished') {
      this.stopAllTimers();
      const finalSnapshot = buildMultiplayerSnapshot(this.raceState);
      this.writeSqliteCheckpoint(finalSnapshot);
      const flushedEvents = this.pendingBroadcastEvents;
      this.pendingBroadcastEvents = [];

      this.broadcastAll({
        type: 'snapshot',
        serverTimeMs: now,
        snapshot: finalSnapshot,
        events: flushedEvents,
      });

      if (this.roomId !== null) {
        this.broadcastAll({
          type: 'race_finished',
          roomId: this.roomId,
          gameRound: this.gameRound,
          finishState: this.raceState.finishState,
          snapshot: finalSnapshot,
        });
      }

      void this.scheduleCleanupAlarm(now + POST_FINISH_STORAGE_CLEANUP_ALARM_MS);
      return;
    }

    const shouldBroadcastSnapshot =
      phaseChanged ||
      this.ticksSinceLastBroadcast >= this.ticksPerBroadcast ||
      isCombatOrMilestoneEvent(events);

    if (shouldBroadcastSnapshot && this.activeSocketByUid.size > 0) {
      this.ticksSinceLastBroadcast = 0;
      const flushedEvents = this.pendingBroadcastEvents;
      this.pendingBroadcastEvents = [];
      const snap = buildMultiplayerSnapshot(this.raceState);
      this.broadcastAll({
        type: 'snapshot',
        serverTimeMs: now,
        snapshot: snap,
        events: flushedEvents.length > 0 ? flushedEvents : undefined,
      });
    }

    // Low-frequency SQLite checkpointing (every 100 ticks = 5 seconds) to protect Free-tier row writes
    if (this.ticksSinceLastCheckpoint >= SQLITE_CHECKPOINT_EVERY_TICKS) {
      this.ticksSinceLastCheckpoint = 0;
      this.writeSqliteCheckpoint(buildMultiplayerSnapshot(this.raceState));
    }
  }

  private cleanupClosedSocket(ws: WebSocket): void {
    const session = this.sessionsBySocket.get(ws);
    if (!session) return;

    if (session.authTimeoutTimer !== null) {
      clearTimeout(session.authTimeoutTimer);
      session.authTimeoutTimer = null;
    }

    this.sessionsBySocket.delete(ws);

    const uid = session.uid;
    if (uid && !session.replacedByNewSession && this.activeSocketByUid.get(uid) === ws) {
      this.activeSocketByUid.delete(uid);
      this.pendingInputsByUid.delete(uid);

      if (this.raceState) {
        this.raceState = setMultiplayerRacerConnection(this.raceState, uid, false);
      }

      this.broadcastAll({
        type: 'player_connection',
        uid,
        isConnected: false,
        connectedCount: this.activeSocketByUid.size,
      });

      if (this.activeSocketByUid.size === 0) {
        this.allDisconnectedSinceMs = this.nowMs();
        if (!this.raceState || this.raceState.phase === 'ready' || this.raceState.phase === 'finished') {
          this.stopAllTimers();
        }
      }
    }
  }

  private stopAllTimers(): void {
    if (this.preCountdownTimer !== null) {
      clearTimeout(this.preCountdownTimer);
      this.preCountdownTimer = null;
    }
    if (this.tickIntervalTimer !== null) {
      clearInterval(this.tickIntervalTimer);
      this.tickIntervalTimer = null;
    }
  }

  // ==========================================================================
  // Minimal SQLite Checkpointing (`ctx.storage.sql`)
  // ==========================================================================

  private ensureSqlTable(): void {
    if (this.sqlTableReady) return;
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS race_checkpoint (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        room_id TEXT NOT NULL,
        game_round INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL
      )`
    );
    this.sqlTableReady = true;
  }

  private ensureCheckpointRestored(): void {
    if (this.checkpointLoaded) return;
    this.checkpointLoaded = true;
    try {
      this.ensureSqlTable();
      const rows = this.ctx.storage.sql
        .exec<PersistedRaceCheckpointRow>(
          'SELECT room_id, game_round, updated_at_ms, snapshot_json FROM race_checkpoint WHERE id = 1'
        )
        .toArray();
      if (rows.length === 0) return;

      const row = rows[0];
      const parsedSnapshot = JSON.parse(row.snapshot_json) as SnowRushSnapshot;
      let restored = restoreMultiplayerStateFromSnapshot(parsedSnapshot);

      // Reset transient connection flags on DO cold-restore until sockets re-auth
      for (let i = 0; i < restored.racerOrder.length; i += 1) {
        restored = setMultiplayerRacerConnection(restored, restored.racerOrder[i], false);
      }

      this.roomId = row.room_id;
      this.gameRound = row.game_round;
      this.expectedPlayerCount = restored.racerOrder.length;
      this.raceState = restored;
    } catch {
      // Corrupted checkpoint is safely discarded rather than crashing room startup
      this.clearSqliteCheckpoint();
    }
  }

  private writeSqliteCheckpoint(snapshot: SnowRushSnapshot): void {
    if (!this.roomId || this.gameRound <= 0) return;
    try {
      this.ensureSqlTable();
      this.ctx.storage.sql.exec(
        `INSERT INTO race_checkpoint (id, room_id, game_round, updated_at_ms, snapshot_json)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           room_id = excluded.room_id,
           game_round = excluded.game_round,
           updated_at_ms = excluded.updated_at_ms,
           snapshot_json = excluded.snapshot_json`,
        this.roomId,
        this.gameRound,
        this.nowMs(),
        JSON.stringify(snapshot)
      );
    } catch {
      // Non-fatal in-memory continuation
    }
  }

  private clearSqliteCheckpoint(): void {
    try {
      this.ensureSqlTable();
      this.ctx.storage.sql.exec('DELETE FROM race_checkpoint WHERE id = 1');
    } catch {
      // Ignore cleanup errors
    }
  }

  private async scheduleCleanupAlarm(whenMs: number): Promise<void> {
    try {
      await this.ctx.storage.setAlarm(whenMs);
    } catch {
      // Ignore alarm scheduling failure in restricted runtimes
    }
  }

  // ==========================================================================
  // Safe WebSocket Send & Close Helpers
  // ==========================================================================

  private sendToSocket(ws: WebSocket, message: SnowRushServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Ignore broken pipe; close event will clean up session
    }
  }

  private broadcastAll(message: SnowRushServerMessage): void {
    const serialized = JSON.stringify(message);
    for (const ws of this.activeSocketByUid.values()) {
      try {
        ws.send(serialized);
      } catch {
        // Ignore broken pipe
      }
    }
  }

  private broadcastExcept(excludedWs: WebSocket, message: SnowRushServerMessage): void {
    const serialized = JSON.stringify(message);
    for (const ws of this.activeSocketByUid.values()) {
      if (ws === excludedWs) continue;
      try {
        ws.send(serialized);
      } catch {
        // Ignore broken pipe
      }
    }
  }

  private sendErrorAndClose(
    ws: WebSocket,
    code: SnowRushNetworkErrorCode,
    message: string,
    closeCode: SnowRushWsCloseCode
  ): void {
    this.sendToSocket(ws, {
      type: 'error',
      code,
      message,
      fatal: true,
    });
    this.cleanupClosedSocket(ws);
    this.safeCloseSocket(ws, closeCode, code);
  }

  private safeCloseSocket(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason.slice(0, 120));
    } catch {
      // Ignore already closed socket
    }
  }
}
