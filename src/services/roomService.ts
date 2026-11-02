import {
  doc,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  extractFirebaseErrorCode,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  DEFAULT_GAME_ID,
  GameRegistryEntry,
  getGameById,
  RegisteredGameId,
} from '../games/registry';
import {
  BaseGameRoomOptions,
  CreateGameRoomOptions,
  GameRoom,
  JoinRoomResult,
  PlayerPresenceEntry,
  RoomStatus,
  SnakesAndLaddersRoomOptions,
  UserProfile,
} from '../types';
import { GAME_CONFIG } from '../config/gameRules';
import { markGameSessionExited, saveActiveGameSession } from './gameSessionService';
import {
  buildPlayerPositionsMap,
  computeLobbyStatus,
  deduplicateRoomPlayers,
  normalizeMaxPlayers,
  resolveAuthoritativePlayer,
  sanitizePlayer,
} from './roomStateHelpers';

export { computeLobbyStatus, deduplicateRoomPlayers, normalizeMaxPlayers };

export type RoomJoinErrorCode =
  | 'INVALID_CODE'
  | 'INVALID_GAME_TYPE'
  | 'GAME_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_PLAYING'
  | 'GAME_FINISHED'
  | 'AUTH_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'FAILED_PRECONDITION'
  | 'TRANSACTION_CONFLICT'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_PAYLOAD'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export class RoomJoinError extends Error {
  code: RoomJoinErrorCode;
  readonly firebaseCode?: string;
  constructor(code: RoomJoinErrorCode, message: string, firebaseCode?: string) {
    super(message);
    this.name = 'RoomJoinError';
    this.code = code;
    if (firebaseCode) {
      this.firebaseCode = firebaseCode;
    }
  }
}

// Coalesce concurrent join requests from the same client/player for the same room code
const inFlightJoins = new Map<string, Promise<JoinRoomResult>>();

// Generate a random 6-character room code (e.g. SG8K29)
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Generate a cryptographically unique move ID so every move is animated once
 * and deduplicated across snapshots and re-renders.
 */
export function generateUniqueMoveId(now: number = Date.now()): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint32Array(2);
    crypto.getRandomValues(arr);
    return `mv_${now}_${arr[0].toString(36)}${arr[1].toString(36)}`;
  }
  return `mv_${now}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Classify errors from room join/create into distinct user-facing Burmese messages,
 * separating permission-denied, unauthenticated, failed-precondition, aborted,
 * resource-exhausted, invalid-argument, network errors, and unknown errors.
 * Never logs authentication tokens, passwords, emails, UIDs, or personal data.
 */
export function classifyRoomOperationError(
  error: unknown,
  roomPath: string,
  operation: 'create' | 'join' = 'join'
): RoomJoinError {
  if (error instanceof RoomJoinError) {
    return error;
  }

  const normalizedFirebaseCode = extractFirebaseErrorCode(error);
  const errMsg = error instanceof Error ? error.message : String(error);
  const lowerMsg = errMsg.toLowerCase();
  const hasAuthenticatedUser = Boolean(auth.currentUser?.uid?.trim());

  const logSafeRoomDiagnostic = (category: RoomJoinErrorCode) => {
    console.warn('Room operation notice:', {
      operation,
      path: roomPath,
      firebaseCode: normalizedFirebaseCode,
      category,
      isAuthenticated: hasAuthenticatedUser,
    });
  };

  const isOfflineOrNetwork =
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    normalizedFirebaseCode === 'unavailable' ||
    normalizedFirebaseCode === 'deadline-exceeded' ||
    normalizedFirebaseCode === 'network-request-failed' ||
    normalizedFirebaseCode === 'auth/network-request-failed' ||
    lowerMsg.includes('offline') ||
    lowerMsg.includes('network') ||
    lowerMsg.includes('failed to fetch');

  if (isOfflineOrNetwork) {
    return new RoomJoinError(
      'NETWORK_ERROR',
      'အင်တာနက်ချိတ်ဆက်မှု မတည်ငြိမ်ပါ။ လိုင်းပြန်စစ်ဆေးပြီး ထပ်မံကြိုးစားပေးပါ။',
      normalizedFirebaseCode
    );
  }

  if (
    normalizedFirebaseCode === 'unauthenticated' ||
    normalizedFirebaseCode === 'auth/user-token-expired' ||
    normalizedFirebaseCode === 'auth/invalid-user-token'
  ) {
    logSafeRoomDiagnostic('AUTH_REQUIRED');
    return new RoomJoinError(
      'AUTH_REQUIRED',
      'အကောင့်ဝင်ရောက်ထားခြင်း သက်တမ်းကုန်နေပါသည်။ ကျေးဇူးပြု၍ အကောင့်ပြန်လည်ဝင်ရောက်ပေးပါ။',
      normalizedFirebaseCode
    );
  }

  if (
    normalizedFirebaseCode === 'permission-denied' ||
    lowerMsg.includes('missing or insufficient permissions')
  ) {
    logSafeRoomDiagnostic('PERMISSION_DENIED');
    return new RoomJoinError(
      'PERMISSION_DENIED',
      operation === 'create'
        ? 'အခန်းဖန်တီးရန် ခွင့်ပြုချက် စစ်ဆေးရာတွင် အဆင်မပြေဖြစ်သွားပါသည်။ အကောင့်ပြန်စစ်ဆေးပြီး ထပ်မံကြိုးစားပေးပါ။'
        : 'အခန်းခွင့်ပြုချက် စစ်ဆေးရာတွင် အဆင်မပြေဖြစ်သွားပါသည်။ အကောင့်ပြန်စစ်ဆေးပြီး ထပ်မံကြိုးစားပေးပါ။',
      normalizedFirebaseCode === 'unknown' ? 'permission-denied' : normalizedFirebaseCode
    );
  }

  if (normalizedFirebaseCode === 'failed-precondition') {
    logSafeRoomDiagnostic('FAILED_PRECONDITION');
    return new RoomJoinError(
      'FAILED_PRECONDITION',
      'အခန်းအခြေအနေ သတ်မှတ်ချက် ပြောင်းလဲသွားသောကြောင့် လုပ်ဆောင်၍ မရပါ။ ထပ်မံကြိုးစားပေးပါ။',
      normalizedFirebaseCode
    );
  }

  if (normalizedFirebaseCode === 'aborted') {
    logSafeRoomDiagnostic('TRANSACTION_CONFLICT');
    return new RoomJoinError(
      'TRANSACTION_CONFLICT',
      'တစ်ပြိုင်နက်တည်း ဝင်ရောက်မှုများနေသောကြောင့် ခဏစောင့်ပြီး ထပ်မံကြိုးစားပေးပါ။',
      normalizedFirebaseCode
    );
  }

  if (normalizedFirebaseCode === 'resource-exhausted') {
    logSafeRoomDiagnostic('QUOTA_EXCEEDED');
    return new RoomJoinError(
      'QUOTA_EXCEEDED',
      'လက်ရှိတွင် ဆာဗာအသုံးပြုမှု များပြားနေပါသည်။ ခဏစောင့်ပြီး ထပ်မံကြိုးစားပေးပါ။',
      normalizedFirebaseCode
    );
  }

  if (normalizedFirebaseCode === 'invalid-argument') {
    logSafeRoomDiagnostic('INVALID_PAYLOAD');
    return new RoomJoinError(
      'INVALID_PAYLOAD',
      operation === 'create'
        ? 'အခန်းအချက်အလက် ပုံစံမမှန်ကန်သောကြောင့် အခန်းဖန်တီး၍ မရပါ။'
        : 'အခန်းအချက်အလက် ပုံစံမမှန်ကန်သောကြောင့် ဝင်ရောက်၍ မရပါ။',
      normalizedFirebaseCode
    );
  }

  logSafeRoomDiagnostic('UNKNOWN_ERROR');

  return new RoomJoinError(
    'UNKNOWN_ERROR',
    operation === 'create'
      ? 'အခန်းအသစ် ဖန်တီးရာတွင် အဆင်မပြေဖြစ်သွားပါသည်။ ခဏစောင့်ပြီး ပြန်လည်ကြိုးစားပေးပါ။'
      : 'အခန်းသို့ ဝင်ရောက်ရာတွင် အဆင်မပြေဖြစ်သွားပါသည်။ ခဏစောင့်ပြီး ပြန်လည်ကြိုးစားပေးပါ။',
    normalizedFirebaseCode
  );
}

const classifyJoinError = classifyRoomOperationError;

export interface ResolvedCreateRoomConfig {
  gameType: RegisteredGameId;
  registryEntry: GameRegistryEntry;
  maxPlayers: number;
  exactFinish: boolean;
}

/**
 * Clamp room maxPlayers within both platform/Firestore multiplayer bounds [2..4]
 * and the specific game's registered [minPlayers..maxPlayers] bounds.
 */
function clampRoomMaxPlayersForGame(
  maxPlayersInput: unknown,
  gameEntry: GameRegistryEntry
): number {
  const minAllowed = Math.max(2, Math.min(4, Math.floor(gameEntry.minPlayers)));
  const maxAllowed = Math.max(minAllowed, Math.min(4, Math.floor(gameEntry.maxPlayers)));

  if (maxPlayersInput === undefined) {
    return maxAllowed;
  }

  const normalized = normalizeMaxPlayers(maxPlayersInput);
  return Math.max(minAllowed, Math.min(maxAllowed, normalized));
}

/**
 * Resolve legacy positional arguments vs multi-game (gameType, gameOptions) arguments,
 * and strictly validate gameType against the Central Game Registry ('available' games only).
 */
export function resolveCreateGameRoomInput(
  gameTypeOrMaxPlayers?: unknown,
  gameOptionsOrExactFinish?: unknown
): ResolvedCreateRoomConfig {
  const isLegacyPositionalCall =
    (typeof gameTypeOrMaxPlayers === 'number' &&
      (gameOptionsOrExactFinish === undefined ||
        typeof gameOptionsOrExactFinish === 'boolean')) ||
    (gameTypeOrMaxPlayers === undefined && typeof gameOptionsOrExactFinish === 'boolean');

  let rawGameType: string;
  let rawOptions: Partial<SnakesAndLaddersRoomOptions> = {};

  if (isLegacyPositionalCall) {
    rawGameType = DEFAULT_GAME_ID;
    rawOptions = {
      maxPlayers:
        typeof gameTypeOrMaxPlayers === 'number' ? gameTypeOrMaxPlayers : undefined,
      exactFinish: Boolean(gameOptionsOrExactFinish ?? false),
    };
  } else {
    if (gameTypeOrMaxPlayers === undefined) {
      rawGameType = DEFAULT_GAME_ID;
    } else if (typeof gameTypeOrMaxPlayers === 'string') {
      const trimmed = gameTypeOrMaxPlayers.trim();
      if (!trimmed) {
        throw new RoomJoinError(
          'INVALID_GAME_TYPE',
          'ဂိမ်းအမျိုးအစား (gameType) သည် အလွတ်ဖြစ်နေ၍ မရပါ။'
        );
      }
      rawGameType = trimmed;
    } else {
      throw new RoomJoinError(
        'INVALID_GAME_TYPE',
        'ရွေးချယ်ထားသော ဂိမ်းအမျိုးအစား မမှန်ကန်ပါ။'
      );
    }

    if (gameOptionsOrExactFinish !== undefined) {
      if (
        gameOptionsOrExactFinish === null ||
        typeof gameOptionsOrExactFinish !== 'object' ||
        Array.isArray(gameOptionsOrExactFinish)
      ) {
        throw new RoomJoinError(
          'INVALID_GAME_TYPE',
          'ဂိမ်းအခန်း သတ်မှတ်ချက် (gameOptions) ပုံစံ မမှန်ကန်ပါ။'
        );
      }
      rawOptions = gameOptionsOrExactFinish as Partial<SnakesAndLaddersRoomOptions>;
    }
  }

  const registryEntry = getGameById(rawGameType);
  if (!registryEntry) {
    throw new RoomJoinError(
      'INVALID_GAME_TYPE',
      'ရွေးချယ်ထားသော ဂိမ်းအမျိုးအစားသည် စာရင်းသွင်းထားခြင်း မရှိပါ။'
    );
  }

  if (registryEntry.status !== 'available') {
    throw new RoomJoinError(
      'GAME_UNAVAILABLE',
      `${registryEntry.shortTitle} ဂိမ်းကို လက်ရှိတွင် အခန်းဖွင့် ကစား၍ မရနိုင်သေးပါ (မကြာမီလာမည်)။`
    );
  }

  const maxPlayers = clampRoomMaxPlayersForGame(rawOptions.maxPlayers, registryEntry);
  const exactFinish =
    registryEntry.id === 'snakes_and_ladders'
      ? Boolean(rawOptions.exactFinish ?? false)
      : false;

  return {
    gameType: registryEntry.id,
    registryEntry,
    maxPlayers,
    exactFinish,
  };
}

/**
 * Construct the initial authoritative GameRoom document payload.
 * Preserves 100% identical field structure and defaults for Snakes & Ladders.
 */
export function buildInitialGameRoom(params: {
  hostUser: UserProfile;
  effectiveHostUid: string;
  roomCode: string;
  resolved: ResolvedCreateRoomConfig;
  now?: number;
}): GameRoom {
  const { hostUser, effectiveHostUid, roomCode, resolved, now = Date.now() } = params;
  const roomId = `room_${roomCode}`;
  const isoTimestamp = new Date(now).toISOString();

  const initialPlayer = sanitizePlayer(
    {
      uid: effectiveHostUid,
      playerId: hostUser.playerId,
      displayName: hostUser.displayName,
      photoURL: hostUser.photoURL,
      isReady: true, // Host is ready by default
      color: GAME_CONFIG.PLAYER_COLORS[0].hex,
      position: 1, // Start position is tile 1
      positionVersion: 1,
      lastMoveId: null,
      updatedAtMs: now,
      activeTokenSkin: hostUser.activeTokenSkin || 'token_crown',
      isConnected: true,
      lastSeen: now,
      disconnectedAt: null,
    },
    now
  );

  const initialPresence: Record<string, PlayerPresenceEntry> = {
    [effectiveHostUid]: {
      isConnected: true,
      lastSeen: now,
      disconnectedAt: null,
    },
  };

  return {
    id: roomId,
    roomCode,
    gameType: resolved.gameType,
    hostId: effectiveHostUid,
    hostName: initialPlayer.displayName,
    status: 'waiting',
    maxPlayers: resolved.maxPlayers,
    playerCount: 1,
    players: [initialPlayer],
    currentTurnIndex: 0,
    lastDiceRoll: 1,
    lastMoveSummary: `${initialPlayer.displayName} မှ အခန်းဖန်တီးထားပါသည်။`.slice(0, 500),
    winnerId: null,
    winnerName: null,
    matchParticipantIds: [],
    exactFinish: resolved.exactFinish,
    stateVersion: 1,
    gameRound: 1,
    lastMoveId: null,
    playerPositions: buildPlayerPositionsMap([initialPlayer], now),
    presence: initialPresence,
    turnStartTimestamp: 0,
    turnDeadline: 0,
    reconnectionDeadline: null,
    disconnectedPlayerId: null,
    disconnectedPlayerName: null,
    lastMoveTimestamp: now,
    lastMovePath: [],
    lastMovingPlayerUid: null,
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  };
}

/**
 * Create a new Game Room (Multi-Game Ready + Legacy Backward Compatible)
 * - New signature: createGameRoom(hostUser, gameType?, gameOptions?)
 * - Legacy signature: createGameRoom(hostUser, maxPlayersInput?, exactFinish?)
 */
export async function createGameRoom<K extends RegisteredGameId = 'snakes_and_ladders'>(
  hostUser: UserProfile,
  gameType?: K,
  gameOptions?: CreateGameRoomOptions<K>
): Promise<JoinRoomResult>;
export async function createGameRoom(
  hostUser: UserProfile,
  maxPlayersInput?: number,
  exactFinish?: boolean
): Promise<JoinRoomResult>;
export async function createGameRoom(
  hostUser: UserProfile,
  gameTypeOrMaxPlayers?: RegisteredGameId | string | number,
  gameOptionsOrExactFinish?: SnakesAndLaddersRoomOptions | BaseGameRoomOptions | boolean
): Promise<JoinRoomResult> {
  const effectiveHostUid = auth.currentUser?.uid?.trim();
  if (!effectiveHostUid || !hostUser) {
    throw new RoomJoinError('AUTH_REQUIRED', 'ကျေးဇူးပြု၍ အကောင့်အရင်ဝင်ရောက်ပေးပါ။');
  }

  const resolved = resolveCreateGameRoomInput(
    gameTypeOrMaxPlayers,
    gameOptionsOrExactFinish
  );

  const roomCode = generateRoomCode();
  const now = Date.now();
  const newRoom = buildInitialGameRoom({
    hostUser,
    effectiveHostUid,
    roomCode,
    resolved,
    now,
  });
  const roomId = newRoom.id;
  const roomRef = doc(db, 'rooms', roomId);

  try {
    await setDoc(roomRef, {
      ...newRoom,
      timestamp: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    });
    await saveActiveGameSession(effectiveHostUid, roomId, roomCode, newRoom.gameType, true);
    return {
      roomId,
      room: newRoom,
      alreadyJoined: false,
    };
  } catch (error) {
    throw classifyJoinError(error, `rooms/${roomId}`, 'create');
  }
}

/**
 * Join an existing Game Room by 6-letter Room Code.
 * - Coalesces concurrent requests from the same client/user (idempotent on double-click)
 * - Uses an atomic Firestore transaction reading latest server state
 * - Deduplicates players by unique UID (never double-counting Host or reconnecting players)
 * - Allows already-joined players to re-enter without false Room Full errors
 * - Validates capacity strictly against unique active players before adding new members
 */
export async function joinGameRoomByCode(
  roomCodeInput: string,
  user: UserProfile
): Promise<JoinRoomResult> {
  const cleanedCode = roomCodeInput.replace(/^#/, '').trim().toUpperCase();
  if (!cleanedCode || !/^[A-Z0-9_-]{4,12}$/.test(cleanedCode)) {
    throw new RoomJoinError(
      'INVALID_CODE',
      'ကျေးဇူးပြု၍ မှန်ကန်သော အခန်းကုဒ် (Room Code) ထည့်သွင်းပါ။'
    );
  }

  const effectiveUid = auth.currentUser?.uid?.trim();
  if (!effectiveUid || !user) {
    throw new RoomJoinError('AUTH_REQUIRED', 'ကျေးဇူးပြု၍ အကောင့်အရင်ဝင်ရောက်ပေးပါ။');
  }

  const roomId = `room_${cleanedCode}`;
  const inFlightKey = `${roomId}:${effectiveUid}`;

  // Coalesce duplicate rapid clicks into the exact same single transaction promise
  const existingPromise = inFlightJoins.get(inFlightKey);
  if (existingPromise) {
    return existingPromise;
  }

  const joinPromise = (async (): Promise<JoinRoomResult> => {
    const roomRef = doc(db, 'rooms', roomId);

    try {
      return await runTransaction(db, async (transaction) => {
        const txNow = Date.now();
        const roomSnap = await transaction.get(roomRef);

        // 1. Verify room exists on server
        if (!roomSnap.exists()) {
          throw new RoomJoinError(
            'NOT_FOUND',
            'အခန်းကုဒ် မှားယွင်းနေပါသည် သို့မဟုတ် အခန်း မရှိတော့ပါ။'
          );
        }

        const roomData = roomSnap.data() as GameRoom;
        const maxPlayers = normalizeMaxPlayers(roomData.maxPlayers);

        // 2. Compute unique active players by UID (prevents duplicate IDs & Host double-count)
        const rawPlayersLength = Array.isArray(roomData.players) ? roomData.players.length : 0;
        const uniquePlayers = deduplicateRoomPlayers(
          roomData.players,
          roomData.playerPositions,
          txNow
        );
        const hadDuplicateEntries = rawPlayersLength !== uniquePlayers.length;

        // 3. Check if Player is ALREADY a member of this room FIRST (Idempotent Re-entry / Reconnect)
        const existingIndex = uniquePlayers.findIndex((p) => p.uid === effectiveUid);
        if (existingIndex >= 0) {
          if (roomData.status === 'finished') {
            throw new RoomJoinError('GAME_FINISHED', 'ဤဂိမ်းပွဲသည် ပြီးဆုံးသွားပါပြီ။');
          }

          const existingPlayer = uniquePlayers[existingIndex];
          const expectedStatus: RoomStatus =
            roomData.status === 'playing'
              ? 'playing'
              : computeLobbyStatus(uniquePlayers.length, maxPlayers);

          const wasDisconnected =
            existingPlayer.isConnected === false || roomData.disconnectedPlayerId === effectiveUid;
          const needsMetadataSync =
            hadDuplicateEntries ||
            roomData.playerCount !== uniquePlayers.length ||
            roomData.status !== expectedStatus;

          // Zero-write fast path if player is already active & room metadata is already clean
          if (!wasDisconnected && !needsMetadataSync) {
            return {
              roomId,
              room: {
                ...roomData,
                maxPlayers,
                playerCount: uniquePlayers.length,
                players: uniquePlayers,
              },
              alreadyJoined: true,
            };
          }

          const updatedPlayers = uniquePlayers.map((p, idx) =>
            idx === existingIndex
              ? sanitizePlayer(p, txNow, {
                  isConnected: true,
                  lastSeen: txNow,
                  disconnectedAt: null,
                })
              : p
          );
          const nextStateVersion = (roomData.stateVersion || 1) + 1;
          const updatedPositions = buildPlayerPositionsMap(updatedPlayers, txNow);
          const nextPresenceEntry: PlayerPresenceEntry = {
            isConnected: true,
            lastSeen: txNow,
            disconnectedAt: null,
          };

          const updates: Record<string, any> = {
            players: updatedPlayers,
            playerCount: updatedPlayers.length,
            maxPlayers,
            status: expectedStatus,
            playerPositions: updatedPositions,
            [`presence.${effectiveUid}`]: nextPresenceEntry,
            stateVersion: nextStateVersion,
            updatedAt: new Date(txNow).toISOString(),
            serverUpdatedAt: serverTimestamp(),
          };

          let nextSummary = roomData.lastMoveSummary;
          let nextDiscId = roomData.disconnectedPlayerId;
          let nextDiscName = roomData.disconnectedPlayerName;
          let nextReconDeadline = roomData.reconnectionDeadline;

          if (roomData.disconnectedPlayerId === effectiveUid) {
            nextDiscId = null;
            nextDiscName = null;
            nextReconDeadline = null;
            nextSummary = `ကစားသမား ${existingPlayer.displayName} ပြန်လည်ချိတ်ဆက်မိပါပြီ။`.slice(
              0,
              500
            );
            updates.disconnectedPlayerId = null;
            updates.disconnectedPlayerName = null;
            updates.reconnectionDeadline = null;
            updates.lastMoveSummary = nextSummary;
          }

          transaction.update(roomRef, updates);

          const committedRoom: GameRoom = {
            ...roomData,
            maxPlayers,
            playerCount: updatedPlayers.length,
            status: expectedStatus,
            players: updatedPlayers,
            playerPositions: updatedPositions,
            presence: {
              ...(roomData.presence || {}),
              [effectiveUid]: nextPresenceEntry,
            },
            disconnectedPlayerId: nextDiscId,
            disconnectedPlayerName: nextDiscName,
            reconnectionDeadline: nextReconDeadline,
            lastMoveSummary: nextSummary,
            stateVersion: nextStateVersion,
            updatedAt: new Date(txNow).toISOString(),
          };

          return {
            roomId,
            room: committedRoom,
            alreadyJoined: true,
          };
        }

        // 4. Validate room status for NEW players
        if (roomData.status === 'finished') {
          throw new RoomJoinError('GAME_FINISHED', 'ဤဂိမ်းပွဲသည် ပြီးဆုံးသွားပါပြီ။');
        }

        if (roomData.status === 'playing') {
          throw new RoomJoinError(
            'GAME_PLAYING',
            'ဂိမ်းစတင်နေပြီဖြစ်သောကြောင့် အခန်းသစ်သို့ ဝင်ရောက်၍ မရနိုင်ပါ။'
          );
        }

        // 5. Validate capacity strictly against unique active players in the room
        // (Never rely on stale client list or mismatched playerCount field)
        if (uniquePlayers.length >= maxPlayers) {
          throw new RoomJoinError(
            'ROOM_FULL',
            `အခန်းလူပြည့်နေပါသည် (အများဆုံး ${maxPlayers} ဦး ပြည့်နေပါပြီ)။`
          );
        }

        // 6. Assign unique token color & atomically add new player
        const usedColors = uniquePlayers.map((p) => p.color);
        const availableColor =
          GAME_CONFIG.PLAYER_COLORS.find((c) => !usedColors.includes(c.hex))?.hex ||
          GAME_CONFIG.PLAYER_COLORS[uniquePlayers.length % GAME_CONFIG.PLAYER_COLORS.length].hex;

        const newPlayer = sanitizePlayer(
          {
            uid: effectiveUid,
            playerId: user.playerId,
            displayName: user.displayName,
            photoURL: user.photoURL,
            isReady: false,
            color: availableColor,
            position: 1,
            positionVersion: 1,
            lastMoveId: null,
            updatedAtMs: txNow,
            activeTokenSkin: user.activeTokenSkin || 'token_crown',
            isConnected: true,
            lastSeen: txNow,
            disconnectedAt: null,
          },
          txNow
        );

        const preservedExistingPlayers =
          !hadDuplicateEntries && Array.isArray(roomData.players)
            ? roomData.players.map((p) => sanitizePlayer(p, txNow))
            : uniquePlayers;
        const updatedPlayers = [...preservedExistingPlayers, newPlayer];
        const newPlayerCount = updatedPlayers.length;
        const nextStatus = computeLobbyStatus(newPlayerCount, maxPlayers);
        const nextStateVersion = (roomData.stateVersion || 1) + 1;
        const updatedPositions = buildPlayerPositionsMap(updatedPlayers, txNow);
        const nextSummary = `${newPlayer.displayName} အခန်းသို့ ဝင်ရောက်လာခဲ့သည်။`.slice(0, 500);
        const nextPresenceEntry: PlayerPresenceEntry = {
          isConnected: true,
          lastSeen: txNow,
          disconnectedAt: null,
        };

        transaction.update(roomRef, {
          players: updatedPlayers,
          playerCount: newPlayerCount,
          maxPlayers,
          status: nextStatus,
          winnerId: null,
          winnerName: null,
          playerPositions: updatedPositions,
          [`presence.${effectiveUid}`]: nextPresenceEntry,
          stateVersion: nextStateVersion,
          lastMoveSummary: nextSummary,
          updatedAt: new Date(txNow).toISOString(),
          serverUpdatedAt: serverTimestamp(),
        });

        const committedRoom: GameRoom = {
          ...roomData,
          maxPlayers,
          playerCount: newPlayerCount,
          status: nextStatus,
          players: updatedPlayers,
          playerPositions: updatedPositions,
          presence: {
            ...(roomData.presence || {}),
            [effectiveUid]: nextPresenceEntry,
          },
          stateVersion: nextStateVersion,
          lastMoveSummary: nextSummary,
          updatedAt: new Date(txNow).toISOString(),
        };

        return {
          roomId,
          room: committedRoom,
          alreadyJoined: false,
        };
      });
    } catch (error) {
      throw classifyJoinError(error, `rooms/${roomId}`);
    }
  })();

  inFlightJoins.set(inFlightKey, joinPromise);
  try {
    const result = await joinPromise;
    await saveActiveGameSession(
      effectiveUid,
      result.roomId,
      result.room.roomCode,
      result.room.gameType || 'snakes_and_ladders',
      true
    );
    return result;
  } finally {
    inFlightJoins.delete(inFlightKey);
  }
}

/**
 * Reconnect a returning player to their active room.
 * Only rewrites `players` inside a transaction if the player was actually marked disconnected;
 * otherwise updates isolated `presence` only so `players` positions are never touched unnecessarily.
 */
export async function reconnectPlayerToRoom(roomId: string, userId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  try {
    await runTransaction(db, async (transaction) => {
      const txNow = Date.now();
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) return;
      const room = roomSnap.data() as GameRoom;

      const uniquePlayers = deduplicateRoomPlayers(room.players, room.playerPositions, txNow);
      const targetPlayer = uniquePlayers.find((p) => p.uid === userId);
      if (!targetPlayer) return;

      const wasDisconnected =
        targetPlayer.isConnected === false || room.disconnectedPlayerId === userId;
      const hadDuplicates = (room.players?.length || 0) !== uniquePlayers.length;

      if (!wasDisconnected && !hadDuplicates) {
        // Player is already marked connected; update isolated presence only
        transaction.update(roomRef, {
          [`presence.${userId}`]: {
            isConnected: true,
            lastSeen: txNow,
            disconnectedAt: null,
          },
        });
        return;
      }

      const updatedPlayers = uniquePlayers.map((p) =>
        p.uid === userId
          ? sanitizePlayer(p, txNow, {
              isConnected: true,
              lastSeen: txNow,
              disconnectedAt: null,
            })
          : p
      );

      const updates: Record<string, any> = {
        players: updatedPlayers,
        playerCount: updatedPlayers.length,
        playerPositions: buildPlayerPositionsMap(updatedPlayers, txNow),
        [`presence.${userId}`]: {
          isConnected: true,
          lastSeen: txNow,
          disconnectedAt: null,
        },
        stateVersion: (room.stateVersion || 1) + 1,
        updatedAt: new Date(txNow).toISOString(),
        serverUpdatedAt: serverTimestamp(),
      };

      if (room.disconnectedPlayerId === userId) {
        updates.disconnectedPlayerId = null;
        updates.disconnectedPlayerName = null;
        updates.reconnectionDeadline = null;
        updates.lastMoveSummary = `ကစားသမား ${targetPlayer.displayName || ''} ပြန်လည်ချိတ်ဆက်မိပါပြီ။`;
      }

      transaction.update(roomRef, updates);
    });
  } catch (error) {
    console.warn('Reconnect update notice:', { firebaseCode: extractFirebaseErrorCode(error) });
  }
}

/**
 * Send isolated heartbeat to indicate player is connected and active.
 * CRITICAL: Updates ONLY `presence.{userId}` via dot-notation.
 * NEVER reads or writes `players` or `playerPositions`, making it impossible
 * for background-tab or delayed heartbeats to ever overwrite player positions!
 */
export async function updatePlayerPresence(roomId: string, userId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  const now = Date.now();
  try {
    await updateDoc(roomRef, {
      [`presence.${userId}`]: {
        isConnected: true,
        lastSeen: now,
        disconnectedAt: null,
      },
    });
  } catch {
    // Non-blocking heartbeat error (e.g. room closed)
  }
}

/**
 * Mark a player as disconnected and start 60s reconnection grace period
 */
export async function markPlayerDisconnected(roomId: string, userId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  try {
    await runTransaction(db, async (transaction) => {
      const txNow = Date.now();
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) return;
      const room = roomSnap.data() as GameRoom;

      const authoritativePlayers = room.players.map((p) =>
        resolveAuthoritativePlayer(p, room.playerPositions, txNow)
      );

      let discPlayerName = '';
      const updatedPlayers = authoritativePlayers.map((p) => {
        if (p.uid === userId) {
          discPlayerName = p.displayName;
          return sanitizePlayer(p, txNow, {
            isConnected: false,
            disconnectedAt: txNow,
          });
        }
        return p;
      });

      if (!discPlayerName) return;

      transaction.update(roomRef, {
        players: updatedPlayers,
        playerPositions: buildPlayerPositionsMap(updatedPlayers, txNow),
        [`presence.${userId}`]: {
          isConnected: false,
          lastSeen: txNow,
          disconnectedAt: txNow,
        },
        disconnectedPlayerId: userId,
        disconnectedPlayerName: discPlayerName,
        reconnectionDeadline: txNow + 60000, // 60 seconds grace period
        stateVersion: (room.stateVersion || 1) + 1,
        lastMoveSummary: `ကစားသမား ${discPlayerName} ၏ အင်တာနက်လိုင်း ပြတ်တောက်နေပါသည်။ ပြန်လည်ချိတ်ဆက်ရန် ၆၀ စက္ကန့် စောင့်ဆိုင်းပေးပါ...`,
        updatedAt: new Date(txNow).toISOString(),
        serverUpdatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    console.warn('Mark disconnected notice:', { firebaseCode: extractFirebaseErrorCode(error) });
  }
}

/**
 * Handle 60s Reconnection Timeout if player fails to rejoin
 * Does NOT modify player positions.
 */
export async function handleReconnectionTimeout(roomId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  try {
    await runTransaction(db, async (transaction) => {
      const txNow = Date.now();
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) return;
      const room = roomSnap.data() as GameRoom;

      if (!room.reconnectionDeadline || txNow < room.reconnectionDeadline) return;

      const timedOutPlayerId = room.disconnectedPlayerId;
      const timedOutName = room.disconnectedPlayerName || 'ကစားသမား';

      let nextTurn = room.currentTurnIndex;
      if (room.players[room.currentTurnIndex]?.uid === timedOutPlayerId) {
        nextTurn = (room.currentTurnIndex + 1) % room.players.length;
      }

      transaction.update(roomRef, {
        disconnectedPlayerId: null,
        disconnectedPlayerName: null,
        reconnectionDeadline: null,
        currentTurnIndex: nextTurn,
        turnStartTimestamp: txNow,
        turnDeadline: txNow + 30000,
        stateVersion: (room.stateVersion || 1) + 1,
        lastMoveSummary: `${timedOutName} သည် သတ်မှတ်ချိန်အတွင်း ပြန်မဝင်နိုင်သဖြင့် အလှည့်ကျော်လွှားပါသည်`,
        updatedAt: new Date(txNow).toISOString(),
        serverUpdatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    console.warn('Reconnection timeout notice:', { firebaseCode: extractFirebaseErrorCode(error) });
  }
}

/**
 * Handle 30-Second Turn Timeout Skip
 * Does NOT modify `players` or `playerPositions` or `lastMoveId`.
 */
export async function handleTurnTimeout(roomId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  try {
    await runTransaction(db, async (transaction) => {
      const txNow = Date.now();
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) return;
      const room = roomSnap.data() as GameRoom;

      if (room.status !== 'playing' || !room.turnDeadline || txNow < room.turnDeadline) {
        return;
      }

      if (room.reconnectionDeadline && txNow < room.reconnectionDeadline) {
        return;
      }

      const timedOutPlayer = room.players[room.currentTurnIndex];
      const nextTurn = (room.currentTurnIndex + 1) % room.players.length;

      transaction.update(roomRef, {
        currentTurnIndex: nextTurn,
        turnStartTimestamp: txNow,
        turnDeadline: txNow + 30000,
        stateVersion: (room.stateVersion || 1) + 1,
        lastMoveSummary: `⏰ ${timedOutPlayer?.displayName || 'ကစားသမား'} ၏ စက္ကန့် ၃၀ အချိန်ပြည့်သွားသဖြင့် နောက်ကစားသမားထံ အလှည့်ပေးလိုက်ပါသည်`,
        updatedAt: new Date(txNow).toISOString(),
        serverUpdatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    console.warn('Turn timeout skip notice:', { firebaseCode: extractFirebaseErrorCode(error) });
  }
}

/**
 * Toggle Ready state of current player (Atomic Transaction)
 */
export async function togglePlayerReady(roomId: string, userId: string, isReady: boolean) {
  const roomRef = doc(db, 'rooms', roomId);
  try {
    await runTransaction(db, async (transaction) => {
      const txNow = Date.now();
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) return;
      const room = roomSnap.data() as GameRoom;
      if (room.status === 'finished') return;
      const maxPlayers = normalizeMaxPlayers(room.maxPlayers);

      const uniquePlayers = deduplicateRoomPlayers(room.players, room.playerPositions, txNow);
      if (!uniquePlayers.some((p) => p.uid === userId)) return;

      const updatedPlayers = uniquePlayers.map((p) =>
        p.uid === userId ? sanitizePlayer(p, txNow, { isReady }) : p
      );

      const nextStatus: RoomStatus =
        room.status === 'playing'
          ? 'playing'
          : computeLobbyStatus(updatedPlayers.length, maxPlayers);

      transaction.update(roomRef, {
        players: updatedPlayers,
        playerCount: updatedPlayers.length,
        status: nextStatus,
        playerPositions: buildPlayerPositionsMap(updatedPlayers, txNow),
        stateVersion: (room.stateVersion || 1) + 1,
        updatedAt: new Date(txNow).toISOString(),
        serverUpdatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
  }
}

/**
 * Start Game (Host only) - initializes 30-second turn timer atomically
 */
export async function startGame(roomId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  try {
    await runTransaction(db, async (transaction) => {
      const txNow = Date.now();
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) return;
      const room = roomSnap.data() as GameRoom;

      const callerUid = auth.currentUser?.uid;
      if (callerUid && room.hostId !== callerUid) return;
      if (room.status !== 'waiting' && room.status !== 'full') return;

      const maxPlayers = normalizeMaxPlayers(room.maxPlayers);
      const uniquePlayers = deduplicateRoomPlayers(room.players, room.playerPositions, txNow);
      if (uniquePlayers.length < 2 || uniquePlayers.length > maxPlayers) return;
      if (!uniquePlayers.every((p) => (p.uid === room.hostId ? true : p.isReady))) return;

      const resetStartPlayers = uniquePlayers.map((p) =>
        sanitizePlayer(p, txNow, {
          position: 1,
          positionVersion: 1,
          lastMoveId: null,
          updatedAtMs: txNow,
        })
      );

      transaction.update(roomRef, {
        status: 'playing',
        players: resetStartPlayers,
        playerCount: resetStartPlayers.length,
        playerPositions: buildPlayerPositionsMap(resetStartPlayers, txNow),
        currentTurnIndex: 0,
        turnStartTimestamp: room.gameType === 'snow_rush' ? 0 : txNow,
        turnDeadline: room.gameType === 'snow_rush' ? 0 : txNow + 30000, // 30 seconds for turn-based games
        reconnectionDeadline: null,
        disconnectedPlayerId: null,
        disconnectedPlayerName: null,
        lastMoveId: null,
        lastMovePath: [],
        lastMovingPlayerUid: null,
        winnerId: null,
        winnerName: null,
        matchParticipantIds: resetStartPlayers.map((p) => p.uid),
        gameRound: (room.gameRound || 1) + 1,
        stateVersion: (room.stateVersion || 1) + 1,
        lastMoveSummary:
          room.gameType === 'snow_rush'
            ? 'Snow Rush ပြိုင်ပွဲ စတင်ပါပြီ!'
            : 'ဂိမ်းစတင်ပါပြီ! ပထမဆုံး ကစားသမား အံစာတုံး စတင်ခေါက်ပါ!',
        updatedAt: new Date(txNow).toISOString(),
        serverUpdatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
  }
}

/**
 * Leave Room (Atomic Transaction preserving all remaining players' exact positions
 * and freeing room capacity from 'full' back to 'waiting' when in lobby)
 */
/**
 * Pure deterministic room-leave transition calculator shared by `leaveGameRoom` and tests.
 * - For `snow_rush` (Phase 1): NEVER sets `status = 'finished'` and NEVER sets `winnerId` / `winnerName`.
 *   When 0 players remain, deletes the room; when 1 player remains during `playing`, returns to `'waiting'`.
 * - For `snakes_and_ladders` (and turn-based games): preserves 100% identical forfeit-win and lobby behavior.
 */
export function computeGameRoomLeaveOutcome(params: {
  readonly room: GameRoom;
  readonly leavingUserId: string;
  readonly now: number;
}):
  | { readonly action: 'noop' }
  | { readonly action: 'delete' }
  | {
      readonly action: 'update';
      readonly updates: Omit<Record<string, any>, 'serverUpdatedAt'>;
    } {
  const { room, leavingUserId, now } = params;
  const maxPlayers = normalizeMaxPlayers(room.maxPlayers);

  const uniquePlayers = deduplicateRoomPlayers(room.players, room.playerPositions, now);
  const leavingIndex = uniquePlayers.findIndex((p) => p.uid === leavingUserId);
  if (leavingIndex < 0) {
    return { action: 'noop' };
  }

  const leavingPlayer = uniquePlayers[leavingIndex];
  const remainingPlayers = uniquePlayers.filter((p) => p.uid !== leavingUserId);

  if (remainingPlayers.length === 0) {
    return { action: 'delete' };
  }

  let newHostId = room.hostId;
  let newHostName = room.hostName;

  if (room.hostId === leavingUserId || !remainingPlayers.some((p) => p.uid === room.hostId)) {
    newHostId = remainingPlayers[0].uid;
    newHostName = remainingPlayers[0].displayName;
    remainingPlayers[0] = sanitizePlayer(remainingPlayers[0], now, { isReady: true });
  }

  // Phase 1 Snow Rush Leave Isolation: NEVER write `status = 'finished'` or `winnerId`
  if (room.gameType === 'snow_rush') {
    const nextStatus: RoomStatus =
      room.status === 'playing'
        ? remainingPlayers.length >= 2
          ? 'playing'
          : 'waiting'
        : computeLobbyStatus(remainingPlayers.length, maxPlayers);

    const snowUpdates: Record<string, any> = {
      players: remainingPlayers,
      playerCount: remainingPlayers.length,
      status: nextStatus,
      playerPositions: buildPlayerPositionsMap(remainingPlayers, now),
      hostId: newHostId,
      hostName: newHostName,
      currentTurnIndex: 0,
      turnStartTimestamp: 0,
      turnDeadline: 0,
      winnerId: null,
      winnerName: null,
      matchParticipantIds:
        nextStatus === 'playing' ? remainingPlayers.map((p) => p.uid) : [],
      stateVersion: (room.stateVersion || 1) + 1,
      lastMoveSummary: `${leavingPlayer.displayName} ပြိုင်ပွဲအခန်းမှ ထွက်ခွာသွားပါသည်။`,
      updatedAt: new Date(now).toISOString(),
    };

    if (room.disconnectedPlayerId === leavingUserId) {
      snowUpdates.disconnectedPlayerId = null;
      snowUpdates.disconnectedPlayerName = null;
      snowUpdates.reconnectionDeadline = null;
    }

    return { action: 'update', updates: snowUpdates };
  }

  // Existing Snakes & Ladders Leave / Forfeit-Win Logic (100% Preserved)
  let nextTurn = room.currentTurnIndex;
  let nextTurnStart = room.turnStartTimestamp || now;
  let nextTurnDeadline = room.turnDeadline || 0;
  let nextStatus: RoomStatus = room.status;
  let nextWinnerId = room.winnerId;
  let nextWinnerName = room.winnerName;
  let nextMatchParticipants: string[] = Array.isArray(room.matchParticipantIds)
    ? room.matchParticipantIds
    : [];
  let nextSummary = `${leavingPlayer.displayName} အခန်းမှ ထွက်ခွာသွားပါသည်။`;

  if (room.status === 'playing') {
    if (remainingPlayers.length === 1) {
      // Sole remaining player wins by opponent exit so their match finishes cleanly
      const soleWinner = sanitizePlayer(remainingPlayers[0], now, { rank: 1 });
      remainingPlayers[0] = soleWinner;
      nextStatus = 'finished';
      nextWinnerId = soleWinner.uid;
      nextWinnerName = soleWinner.displayName;
      nextMatchParticipants = [soleWinner.uid];
      nextTurn = 0;
      nextTurnStart = now;
      nextTurnDeadline = 0;
      nextSummary = `🏆 ${leavingPlayer.displayName} ဂိမ်းမှ ထွက်ခွာသွားသဖြင့် ${soleWinner.displayName} အနိုင်ရရှိသွားပါသည်!`;
    } else {
      // 2+ players remain in active match: preserve exact turn order & positions
      nextStatus = 'playing';
      nextMatchParticipants = remainingPlayers.map((p) => p.uid);
      if (leavingIndex < room.currentTurnIndex) {
        nextTurn = Math.max(0, room.currentTurnIndex - 1);
      } else if (leavingIndex === room.currentTurnIndex) {
        nextTurn = room.currentTurnIndex % remainingPlayers.length;
        nextTurnStart = now;
        nextTurnDeadline = now + 30000;
      } else {
        nextTurn = Math.min(room.currentTurnIndex, remainingPlayers.length - 1);
      }
      if (!nextTurnDeadline || nextTurnDeadline <= now) {
        nextTurnStart = now;
        nextTurnDeadline = now + 30000;
      }
    }
  } else if (room.status === 'waiting' || room.status === 'full') {
    nextStatus = computeLobbyStatus(remainingPlayers.length, maxPlayers);
    nextTurn = 0;
    nextTurnStart = 0;
    nextTurnDeadline = 0;
    nextMatchParticipants = [];
  } else {
    // 'finished' - preserve existing matchParticipantIds so remaining participants can claim rewards
    nextStatus = 'finished';
    if (nextMatchParticipants.length === 0) {
      nextMatchParticipants = uniquePlayers.map((p) => p.uid);
    }
    if (nextTurn >= remainingPlayers.length) {
      nextTurn = 0;
    }
  }

  const updates: Record<string, any> = {
    players: remainingPlayers,
    playerCount: remainingPlayers.length,
    status: nextStatus,
    playerPositions: buildPlayerPositionsMap(remainingPlayers, now),
    hostId: newHostId,
    hostName: newHostName,
    currentTurnIndex: nextTurn,
    turnStartTimestamp: nextTurnStart,
    turnDeadline: nextTurnDeadline,
    winnerId: nextWinnerId,
    winnerName: nextWinnerName,
    matchParticipantIds: nextMatchParticipants,
    stateVersion: (room.stateVersion || 1) + 1,
    lastMoveSummary: nextSummary,
    updatedAt: new Date(now).toISOString(),
  };

  if (room.disconnectedPlayerId === leavingUserId) {
    updates.disconnectedPlayerId = null;
    updates.disconnectedPlayerName = null;
    updates.reconnectionDeadline = null;
  }

  return { action: 'update', updates };
}

export async function leaveGameRoom(roomId: string, userId: string) {
  // Immediately mark room session as exited so browser refresh never re-enters this room
  await markGameSessionExited(userId, roomId, false);

  const roomRef = doc(db, 'rooms', roomId);
  try {
    await runTransaction(db, async (transaction) => {
      const txNow = Date.now();
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) return;
      const room = roomSnap.data() as GameRoom;

      const outcome = computeGameRoomLeaveOutcome({
        room,
        leavingUserId: userId,
        now: txNow,
      });

      if (outcome.action === 'noop') return;
      if (outcome.action === 'delete') {
        transaction.delete(roomRef);
        return;
      }

      transaction.update(roomRef, {
        ...outcome.updates,
        serverUpdatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
  } finally {
    // Clear activeRoomId on user profile in Firestore (non-blocking)
    await markGameSessionExited(userId, roomId, true);
  }
}

/**
 * Cryptographically fair random dice roll (1 to 6)
 */
export function generateSecureDiceRoll(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    const limit = 4294967292; // 0xFFFFFFFC
    if (buffer[0] < limit) {
      return (buffer[0] % 6) + 1;
    }
  }
  return Math.floor(Math.random() * 6) + 1;
}

/**
 * Make Turn: Atomic Firebase Transaction with authoritative dice roll,
 * per-player `positionVersion` increment, unique `lastMoveId`, step-by-step movement path,
 * snake/ladder logic, 30s timer, and victory detection.
 */
export async function executeDiceRollAndMove(
  roomId: string,
  rollingPlayerUid: string,
  clientRolledValue?: number
): Promise<{
  newPos: number;
  diceRoll: number;
  eventSummary: string;
  won: boolean;
  movePath: number[];
  moveId: string;
  positionVersion: number;
  stateVersion: number;
  nextTurnIndex: number;
  turnStartTimestamp: number;
  turnDeadline: number;
}> {
  const roomRef = doc(db, 'rooms', roomId);

  try {
    return await runTransaction(db, async (transaction) => {
      const txNow = Date.now();
      const moveId = generateUniqueMoveId(txNow);

      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) {
        throw new Error('အခန်း မတွေ့ပါ');
      }

      const room = roomSnap.data() as GameRoom;

      if (room.status !== 'playing') {
        throw new Error('ဂိမ်းသည် ဆော့ကစားဆဲ အခြေအနေ မဟုတ်ပါ');
      }

      if (room.winnerId) {
        throw new Error('ဂိမ်းပြီးဆုံးသွားပါပြီ');
      }

      const authoritativePlayers = room.players.map((p) =>
        resolveAuthoritativePlayer(p, room.playerPositions, txNow)
      );

      const playerIndex = authoritativePlayers.findIndex((p) => p.uid === rollingPlayerUid);
      if (playerIndex < 0) {
        throw new Error('ဤအခန်းတွင် သင်မပါဝင်ပါ');
      }

      if (playerIndex !== room.currentTurnIndex) {
        throw new Error('သင့်အလှည့် မဟုတ်သေးပါ (တစ်လှည့်စီသာ ကစားရပါမည်)');
      }

      const currentPlayer = authoritativePlayers[playerIndex];
      const startPos = currentPlayer.position || 1;
      const nextPositionVersion = (currentPlayer.positionVersion || 1) + 1;
      const nextStateVersion = (room.stateVersion || 1) + 1;

      // Authoritative Secure Dice Roll (1 to 6)
      const diceRoll =
        clientRolledValue && clientRolledValue >= 1 && clientRolledValue <= 6
          ? clientRolledValue
          : generateSecureDiceRoll();

      let targetPos = startPos + diceRoll;
      let eventSummary = `${currentPlayer.displayName} မှ အံစာတုံး [${diceRoll}] ကျပါသည်`;
      let won = false;

      // Construct step-by-step tile path: e.g. [1, 2, 3, 4, 5, 6]
      const movePath: number[] = [startPos];
      if (startPos + diceRoll <= 100) {
        for (let s = startPos + 1; s <= startPos + diceRoll; s++) {
          movePath.push(s);
        }
      } else {
        for (let s = startPos + 1; s <= 100; s++) {
          movePath.push(s);
        }
        if (room.exactFinish) {
          const overflow = startPos + diceRoll - 100;
          targetPos = 100 - overflow;
          for (let b = 1; b <= overflow; b++) {
            movePath.push(100 - b);
          }
          eventSummary += `။ ၁၀၀ ကျော်သွား၍ အကွက် ${targetPos} သို့ ပြန်ဆင်းပါသည်`;
        } else {
          targetPos = 100;
        }
      }

      // Check Ladders
      if (GAME_CONFIG.LADDERS[targetPos]) {
        const climbedTo = GAME_CONFIG.LADDERS[targetPos];
        eventSummary += `။ လှေကားတွေ့ရှိသဖြင့် အကွက် ${targetPos} မှ ${climbedTo} သို့ တက်လှမ်းပါသည်! 🎉`;
        movePath.push(climbedTo);
        targetPos = climbedTo;
      }
      // Check Snakes
      else if (GAME_CONFIG.SNAKES[targetPos]) {
        const bittenTo = GAME_CONFIG.SNAKES[targetPos];
        eventSummary += `။ မြွေကိုက်ခံရသဖြင့် အကွက် ${targetPos} မှ ${bittenTo} သို့ လျှောကျသွားပါသည်! 🐍`;
        movePath.push(bittenTo);
        targetPos = bittenTo;
      }

      if (targetPos >= 100) {
        targetPos = 100;
        won = true;
        eventSummary = `🏆 ${currentPlayer.displayName} သည် နံပါတ် ၁၀၀ သို့ ပထမဆုံးရောက်ရှိပြီး အနိုင်ရရှိသွားပါပြီ!`;
      }

      // Turn System: If rolled 6, player gets another turn (unless won)
      let nextTurnIndex = room.currentTurnIndex;
      if (!won) {
        if (diceRoll === 6) {
          eventSummary += ' (အံစာတုံး ၆ ကျသဖြင့် နောက်တစ်ကြိမ် ထပ်ခေါက်ခွင့်ရပါသည်!)';
        } else {
          nextTurnIndex = (room.currentTurnIndex + 1) % authoritativePlayers.length;
        }
      }

      // ONLY update the moving player's position & positionVersion;
      // preserve all other players' exact positions and versions untouched!
      const updatedPlayers = authoritativePlayers.map((p, idx) => {
        if (idx !== playerIndex) {
          return p;
        }
        return sanitizePlayer(p, txNow, {
          position: targetPos,
          positionVersion: nextPositionVersion,
          lastMoveId: moveId,
          updatedAtMs: txNow,
          rank: won ? 1 : p.rank,
          isConnected: true,
          lastSeen: txNow,
        });
      });

      const updatedPlayerPositions = buildPlayerPositionsMap(updatedPlayers, txNow);

      transaction.update(roomRef, {
        players: updatedPlayers,
        playerPositions: updatedPlayerPositions,
        [`presence.${currentPlayer.uid}`]: {
          isConnected: true,
          lastSeen: txNow,
          disconnectedAt: null,
        },
        lastDiceRoll: diceRoll,
        lastMoveSummary: eventSummary,
        lastMoveId: moveId,
        lastMoveTimestamp: txNow,
        lastMovePath: movePath,
        lastMovingPlayerUid: currentPlayer.uid,
        currentTurnIndex: nextTurnIndex,
        turnStartTimestamp: txNow,
        turnDeadline: won ? 0 : txNow + 30000, // 30 seconds for next turn
        stateVersion: nextStateVersion,
        status: won ? 'finished' : 'playing',
        winnerId: won ? currentPlayer.uid : null,
        winnerName: won ? currentPlayer.displayName : null,
        matchParticipantIds: updatedPlayers.map((p) => p.uid),
        updatedAt: new Date(txNow).toISOString(),
        serverUpdatedAt: serverTimestamp(),
      });

      return {
        newPos: targetPos,
        diceRoll,
        eventSummary,
        won,
        movePath,
        moveId,
        positionVersion: nextPositionVersion,
        stateVersion: nextStateVersion,
        nextTurnIndex,
        turnStartTimestamp: txNow,
        turnDeadline: won ? 0 : txNow + 30000,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
    throw error;
  }
}

/**
 * Reset game to play again in same room (Atomic Transaction, increments `gameRound`)
 */
export async function resetRoomToPlayAgain(roomId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  try {
    await runTransaction(db, async (transaction) => {
      const txNow = Date.now();
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) return;
      const room = roomSnap.data() as GameRoom;
      const maxPlayers = normalizeMaxPlayers(room.maxPlayers);
      const uniquePlayers = deduplicateRoomPlayers(room.players, room.playerPositions, txNow);

      const resetPlayers = uniquePlayers.map((p) => {
        const base = sanitizePlayer(p, txNow, {
          position: 1,
          positionVersion: 1,
          lastMoveId: null,
          updatedAtMs: txNow,
          isReady: p.uid === room.hostId, // Host is ready
          isConnected: true,
          lastSeen: txNow,
          disconnectedAt: null,
        });
        delete base.rank;
        return base;
      });

      const nextStatus = computeLobbyStatus(resetPlayers.length, maxPlayers);

      transaction.update(roomRef, {
        players: resetPlayers,
        playerCount: resetPlayers.length,
        playerPositions: buildPlayerPositionsMap(resetPlayers, txNow),
        status: nextStatus,
        currentTurnIndex: 0,
        lastDiceRoll: 1,
        gameRound: (room.gameRound || 1) + 1,
        stateVersion: (room.stateVersion || 1) + 1,
        lastMoveId: null,
        lastMovePath: [],
        lastMovingPlayerUid: null,
        turnStartTimestamp: 0,
        turnDeadline: 0,
        reconnectionDeadline: null,
        disconnectedPlayerId: null,
        disconnectedPlayerName: null,
        lastMoveSummary: 'ဂိမ်းအသစ် ပြန်လည်စတင်ရန် အဆင်သင့်ဖြစ်ပါပြီ!',
        winnerId: null,
        winnerName: null,
        matchParticipantIds: [],
        lastMoveTimestamp: txNow,
        updatedAt: new Date(txNow).toISOString(),
        serverUpdatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
  }
}
