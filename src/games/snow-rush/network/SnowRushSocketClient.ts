import type {
  MultiplayerRaceEvent,
  RaceFinishState,
  SnowRushSnapshot,
  SnowRushSteerAxis,
} from '../engine/multiplayerTypes';
import {
  isTerminalSnowRushCloseCode,
  parseSnowRushServerMessage,
  resolveSnowRushWorkerWsUrl,
  SNOW_RUSH_CLIENT_INPUT_MIN_INTERVAL_MS,
  SNOW_RUSH_CLIENT_PING_INTERVAL_MS,
  SNOW_RUSH_PROTOCOL_VERSION,
  SNOW_RUSH_WS_CLOSE_CODES,
} from './protocol';
import type {
  SnowRushClientMessage,
  SnowRushNetworkErrorCode,
  SnowRushServerWelcomeMessage,
} from './protocol';

/**
 * Snow Rush: Avalanche Escape — Step 4.7 Frontend Multiplayer WebSocket Client
 *
 * Responsibilities:
 * - Connects to room-scoped Cloudflare Durable Object WebSocket (`/ws/snow-rush/:roomId`)
 * - Authenticates immediately on `open` with fresh Firebase ID Token (`auth` message)
 * - Sends event-driven, rate-limited (max 20 Hz / 50 ms) `input` frames with monotonic `seq`
 * - Coalesces rapid button edges (`jumpPressed`, `useItemPressed`) between 50 ms windows
 * - Measures smoothed RTT via `ping`/`pong`
 * - Recovers cleanly on transient network drops via bounded exponential backoff + snapshot resync
 * - Never loops on terminal close codes (`4401`, `4403`, `4404`, `4409`, `4412`, `4000`)
 * - Prevents duplicate concurrent sockets from the same client instance
 */

export type SnowRushConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'duplicate_session'
  | 'rejected'
  | 'error';

export interface SnowRushInputIntent {
  readonly steer: SnowRushSteerAxis;
  readonly jumpPressed: boolean;
  readonly useItemPressed: boolean;
}

export interface SnowRushSocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { readonly data: unknown }) => void) | null;
  onclose: ((ev: { readonly code: number; readonly reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type SnowRushWebSocketFactory = (url: string) => SnowRushSocketLike;

export interface SnowRushSocketClientOptions {
  readonly roomId: string;
  readonly getIdToken: (forceRefresh?: boolean) => Promise<string>;
  readonly workerBaseUrl?: string | null;
  readonly createWebSocket?: SnowRushWebSocketFactory;
  readonly nowMs?: () => number;
  readonly maxReconnectAttempts?: number;
  readonly reconnectDelaysMs?: readonly number[];
  readonly onStatusChange?: (status: SnowRushConnectionStatus) => void;
  readonly onWelcome?: (welcome: SnowRushServerWelcomeMessage) => void;
  readonly onSnapshot?: (
    snapshot: SnowRushSnapshot,
    serverTimeMs: number,
    events: readonly MultiplayerRaceEvent[]
  ) => void;
  readonly onPlayerConnection?: (
    uid: string,
    isConnected: boolean,
    connectedCount: number
  ) => void;
  readonly onRaceFinished?: (
    finishState: RaceFinishState,
    snapshot: SnowRushSnapshot,
    gameRound: number
  ) => void;
  readonly onRttUpdate?: (rttMs: number) => void;
  readonly onError?: (code: SnowRushNetworkErrorCode | 'WS_UNCONFIGURED' | 'CONNECTION_FAILED', message: string, fatal: boolean) => void;
}

const WS_READY_STATE_OPEN = 1;
const DEFAULT_RECONNECT_DELAYS_MS: readonly number[] = [500, 1000, 2000, 4000, 6000];
const STEER_KEEPALIVE_INTERVAL_MS = 200;

function defaultNowMs(): number {
  return Date.now();
}

function defaultWebSocketFactory(url: string): SnowRushSocketLike {
  if (typeof WebSocket === 'undefined') {
    throw new Error('Global WebSocket constructor is not available in this runtime.');
  }
  return new WebSocket(url) as unknown as SnowRushSocketLike;
}

export class SnowRushSocketClient {
  private readonly options: SnowRushSocketClientOptions;
  private readonly nowMs: () => number;
  private readonly createWs: SnowRushWebSocketFactory;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelaysMs: readonly number[];

  private status: SnowRushConnectionStatus = 'idle';
  private socket: SnowRushSocketLike | null = null;
  private activeConnectionGeneration = 0;
  private intentionalDisconnect = false;
  private raceCompleted = false;

  private authenticatedUid: string | null = null;
  private authenticatedRound: number | null = null;
  private latestSnapshot: SnowRushSnapshot | null = null;
  private rttMs: number | null = null;
  private lastErrorCode: SnowRushNetworkErrorCode | 'WS_UNCONFIGURED' | 'CONNECTION_FAILED' | null = null;
  private lastErrorMessage: string | null = null;

  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private inputFlushTimer: ReturnType<typeof setTimeout> | null = null;

  private nextInputSeq = 1;
  private lastSentInputAtMs = 0;
  private lastSentSteer: SnowRushSteerAxis = 0;
  private pendingIntent: SnowRushInputIntent | null = null;

  constructor(options: SnowRushSocketClientOptions) {
    this.options = options;
    this.nowMs = options.nowMs ?? defaultNowMs;
    this.createWs = options.createWebSocket ?? defaultWebSocketFactory;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
  }

  public getStatus(): SnowRushConnectionStatus {
    return this.status;
  }

  public getRttMs(): number | null {
    return this.rttMs;
  }

  public getReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  public getLatestSnapshot(): SnowRushSnapshot | null {
    return this.latestSnapshot;
  }

  public getAuthenticatedUid(): string | null {
    return this.authenticatedUid;
  }

  public getAuthenticatedGameRound(): number | null {
    return this.authenticatedRound;
  }

  public getLastError(): {
    readonly code: SnowRushNetworkErrorCode | 'WS_UNCONFIGURED' | 'CONNECTION_FAILED' | null;
    readonly message: string | null;
  } {
    return {
      code: this.lastErrorCode,
      message: this.lastErrorMessage,
    };
  }

  /**
   * Opens (or cleanly replaces) the room WebSocket connection and initiates Firebase ID token auth.
   */
  public connect(): void {
    this.intentionalDisconnect = false;
    this.raceCompleted = false;
    this.reconnectAttempt = 0;
    this.lastErrorCode = null;
    this.lastErrorMessage = null;
    this.openSocketInternal(false);
  }

  /**
   * Cleanly closes any active socket and cancels all timers without triggering auto-reconnect.
   */
  public disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearTimers();
    this.teardownCurrentSocket(SNOW_RUSH_WS_CLOSE_CODES.NORMAL, 'Client disconnected');
    this.setStatus('disconnected');
  }

  public dispose(): void {
    this.disconnect();
  }

  /**
   * Requests an immediate authoritative snapshot resync from the room Durable Object.
   */
  public requestSnapshotResync(): boolean {
    if (this.status !== 'connected') {
      return false;
    }
    return this.sendMessage({ type: 'request_snapshot' });
  }

  /**
   * Event-driven + throttled (max 20 Hz / 50 ms) input transmission.
   * Latches one-shot `jumpPressed` and `useItemPressed` edges across sub-50ms bursts
   * so quick taps are never dropped.
   */
  public sendInput(intent: SnowRushInputIntent): void {
    if (this.status !== 'connected' || this.raceCompleted) {
      return;
    }

    const normalizedSteer: SnowRushSteerAxis =
      intent.steer < 0 ? -1 : intent.steer > 0 ? 1 : 0;
    const nextPending: SnowRushInputIntent = {
      steer: normalizedSteer,
      jumpPressed: Boolean(intent.jumpPressed) || Boolean(this.pendingIntent?.jumpPressed),
      useItemPressed:
        Boolean(intent.useItemPressed) || Boolean(this.pendingIntent?.useItemPressed),
    };

    const now = this.nowMs();
    const elapsedSinceLastSend = now - this.lastSentInputAtMs;
    const steerChanged = nextPending.steer !== this.lastSentSteer;
    const hasOneShotAction = nextPending.jumpPressed || nextPending.useItemPressed;
    const needsSteerKeepalive =
      nextPending.steer !== 0 && elapsedSinceLastSend >= STEER_KEEPALIVE_INTERVAL_MS;

    if (!steerChanged && !hasOneShotAction && !needsSteerKeepalive && this.pendingIntent === null) {
      return;
    }

    this.pendingIntent = nextPending;

    if (elapsedSinceLastSend >= SNOW_RUSH_CLIENT_INPUT_MIN_INTERVAL_MS) {
      this.flushPendingInput();
      return;
    }

    if (this.inputFlushTimer === null) {
      const waitMs = Math.max(1, SNOW_RUSH_CLIENT_INPUT_MIN_INTERVAL_MS - elapsedSinceLastSend);
      this.inputFlushTimer = setTimeout(() => {
        this.inputFlushTimer = null;
        this.flushPendingInput();
      }, waitMs);
    }
  }

  private flushPendingInput(): void {
    if (this.inputFlushTimer !== null) {
      clearTimeout(this.inputFlushTimer);
      this.inputFlushTimer = null;
    }
    if (this.status !== 'connected' || this.pendingIntent === null || this.raceCompleted) {
      this.pendingIntent = null;
      return;
    }

    const intent = this.pendingIntent;
    this.pendingIntent = null;

    const seq = this.nextInputSeq;
    this.nextInputSeq += 1;

    const sent = this.sendMessage({
      type: 'input',
      seq,
      steer: intent.steer,
      jumpPressed: intent.jumpPressed,
      useItemPressed: intent.useItemPressed,
    });

    if (sent) {
      this.lastSentInputAtMs = this.nowMs();
      this.lastSentSteer = intent.steer;
    }
  }

  private openSocketInternal(isReconnect: boolean): void {
    this.clearTimers();
    this.teardownCurrentSocket(SNOW_RUSH_WS_CLOSE_CODES.NORMAL, 'Replacing client socket');

    const wsUrl = resolveSnowRushWorkerWsUrl(this.options.roomId, this.options.workerBaseUrl);
    if (!wsUrl) {
      this.recordError(
        'WS_UNCONFIGURED',
        'Multiplayer Server URL (VITE_SNOW_RUSH_WS_URL) မသတ်မှတ်ရသေးပါ။',
        true
      );
      this.setStatus('error');
      return;
    }

    const generation = ++this.activeConnectionGeneration;
    this.setStatus(isReconnect ? 'reconnecting' : 'connecting');

    let ws: SnowRushSocketLike;
    try {
      ws = this.createWs(wsUrl);
    } catch {
      this.handleTransientFailure(generation, 'WebSocket ချိတ်ဆက်မှု စတင်၍မရပါ။');
      return;
    }

    this.socket = ws;

    ws.onopen = () => {
      if (generation !== this.activeConnectionGeneration) return;
      this.setStatus('authenticating');
      void this.authenticateOpenSocket(generation, isReconnect);
    };

    ws.onmessage = (event) => {
      if (generation !== this.activeConnectionGeneration) return;
      if (typeof event.data !== 'string') return;
      this.handleInboundTextFrame(event.data);
    };

    ws.onerror = () => {
      if (generation !== this.activeConnectionGeneration) return;
      // Browser fires `onclose` immediately after `onerror`; let `onclose` drive state/reconnect cleanly.
    };

    ws.onclose = (event) => {
      if (generation !== this.activeConnectionGeneration) return;
      this.clearPingAndInputTimers();
      this.socket = null;

      if (this.intentionalDisconnect) {
        this.setStatus('disconnected');
        return;
      }

      if (event.code === SNOW_RUSH_WS_CLOSE_CODES.DUPLICATE_SESSION) {
        this.recordError(
          'DUPLICATE_SESSION_REPLACED',
          'အခြား စက် သို့မဟုတ် Tab အသစ်မှ ဝင်ရောက်လာသဖြင့် ဤချိတ်ဆက်မှုကို ရပ်နားလိုက်ပါသည်။',
          true
        );
        this.setStatus('duplicate_session');
        return;
      }

      if (event.code === SNOW_RUSH_WS_CLOSE_CODES.RACE_COMPLETED || this.raceCompleted) {
        this.setStatus('disconnected');
        return;
      }

      if (isTerminalSnowRushCloseCode(event.code)) {
        if (!this.lastErrorCode) {
          this.recordError(
            'ROOM_VERIFY_FAILED',
            event.reason || 'အခန်းချိတ်ဆက်ခွင့် ငြင်းပယ်ခံရပါသည်။',
            true
          );
        }
        this.setStatus('rejected');
        return;
      }

      this.handleTransientFailure(
        generation,
        event.reason || 'အင်တာနက်ချိတ်ဆက်မှု ခေတ္တပြတ်တောက်သွားပါသည်။'
      );
    };
  }

  private async authenticateOpenSocket(
    generation: number,
    forceRefreshToken: boolean
  ): Promise<void> {
    let idToken: string;
    try {
      idToken = await this.options.getIdToken(forceRefreshToken);
    } catch {
      if (generation !== this.activeConnectionGeneration) return;
      this.recordError(
        'INVALID_TOKEN',
        'Firebase အကောင့် အတည်ပြု Token ရယူ၍မရပါ။ ပြန်လည်ဝင်ရောက်ပေးပါ။',
        true
      );
      this.teardownCurrentSocket(SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED, 'Token fetch failed');
      this.setStatus('rejected');
      return;
    }

    if (generation !== this.activeConnectionGeneration) return;
    if (!idToken || idToken.trim().length < 32) {
      this.recordError(
        'INVALID_TOKEN',
        'Firebase အကောင့် အတည်ပြု Token မမှန်ကန်ပါ။',
        true
      );
      this.teardownCurrentSocket(SNOW_RUSH_WS_CLOSE_CODES.UNAUTHORIZED, 'Invalid token');
      this.setStatus('rejected');
      return;
    }

    this.sendMessage({
      type: 'auth',
      protocolVersion: SNOW_RUSH_PROTOCOL_VERSION,
      roomId: this.options.roomId,
      idToken: idToken.trim(),
    });
  }

  private handleInboundTextFrame(rawText: string): void {
    const msg = parseSnowRushServerMessage(rawText);
    if (!msg) return;

    switch (msg.type) {
      case 'welcome': {
        this.authenticatedUid = msg.uid;
        this.authenticatedRound = msg.gameRound;
        this.latestSnapshot = msg.snapshot;
        this.reconnectAttempt = 0;
        this.lastErrorCode = null;
        this.lastErrorMessage = null;

        // Keep monotonic input sequence ahead of server-acknowledged sequence on reconnect!
        const serverAckSeq = msg.snapshot.ackSeqByUid[msg.uid] ?? 0;
        if (this.nextInputSeq <= serverAckSeq) {
          this.nextInputSeq = serverAckSeq + 1;
        }

        if (msg.snapshot.racePhase === 'finished') {
          this.raceCompleted = true;
        }

        this.setStatus('connected');
        this.startPingLoop();
        this.options.onWelcome?.(msg);
        this.options.onSnapshot?.(msg.snapshot, msg.serverTimeMs, []);
        break;
      }

      case 'snapshot': {
        this.latestSnapshot = msg.snapshot;
        if (msg.snapshot.racePhase === 'finished') {
          this.raceCompleted = true;
        }
        this.options.onSnapshot?.(msg.snapshot, msg.serverTimeMs, msg.events ?? []);
        break;
      }

      case 'pong': {
        const sampleRtt = Math.max(0, this.nowMs() - msg.clientSentAtMs);
        this.rttMs =
          this.rttMs === null ? sampleRtt : Math.round(this.rttMs * 0.7 + sampleRtt * 0.3);
        this.options.onRttUpdate?.(this.rttMs);
        break;
      }

      case 'player_connection': {
        this.options.onPlayerConnection?.(msg.uid, msg.isConnected, msg.connectedCount);
        break;
      }

      case 'race_finished': {
        this.raceCompleted = true;
        this.latestSnapshot = msg.snapshot;
        this.options.onSnapshot?.(msg.snapshot, this.nowMs(), []);
        this.options.onRaceFinished?.(msg.finishState, msg.snapshot, msg.gameRound);
        break;
      }

      case 'error': {
        this.recordError(msg.code, msg.message, msg.fatal);
        if (msg.code === 'DUPLICATE_SESSION_REPLACED') {
          this.setStatus('duplicate_session');
        } else if (msg.fatal) {
          this.setStatus('rejected');
        }
        break;
      }
    }
  }

  private handleTransientFailure(generation: number, reasonMm: string): void {
    if (generation !== this.activeConnectionGeneration) return;
    if (this.intentionalDisconnect || this.raceCompleted) {
      this.setStatus('disconnected');
      return;
    }

    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.recordError(
        'CONNECTION_FAILED',
        `${reasonMm} ပြန်လည်ချိတ်ဆက်မှု အကြိမ်ရေ ပြည့်သွားပါပြီ။`,
        true
      );
      this.setStatus('error');
      return;
    }

    const delayIdx = Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1);
    const delayMs = this.reconnectDelaysMs[delayIdx] ?? 1500;
    this.reconnectAttempt += 1;
    this.setStatus('reconnecting');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalDisconnect || this.raceCompleted) return;
      this.openSocketInternal(true);
    }, delayMs);
  }

  private startPingLoop(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
    }
    this.sendMessage({ type: 'ping', clientSentAtMs: this.nowMs() });
    this.pingTimer = setInterval(() => {
      if (this.status !== 'connected') return;
      this.sendMessage({ type: 'ping', clientSentAtMs: this.nowMs() });
    }, SNOW_RUSH_CLIENT_PING_INTERVAL_MS);
  }

  private sendMessage(message: SnowRushClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WS_READY_STATE_OPEN) {
      return false;
    }
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private teardownCurrentSocket(code: number, reason: string): void {
    const ws = this.socket;
    this.socket = null;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close(code, reason);
    } catch {
      // Ignore already-closed socket errors
    }
  }

  private clearPingAndInputTimers(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.inputFlushTimer !== null) {
      clearTimeout(this.inputFlushTimer);
      this.inputFlushTimer = null;
    }
    this.pendingIntent = null;
  }

  private clearTimers(): void {
    this.clearPingAndInputTimers();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private recordError(
    code: SnowRushNetworkErrorCode | 'WS_UNCONFIGURED' | 'CONNECTION_FAILED',
    message: string,
    fatal: boolean
  ): void {
    this.lastErrorCode = code;
    this.lastErrorMessage = message;
    this.options.onError?.(code, message, fatal);
  }

  private setStatus(nextStatus: SnowRushConnectionStatus): void {
    if (this.status === nextStatus) return;
    this.status = nextStatus;
    this.options.onStatusChange?.(nextStatus);
  }
}
