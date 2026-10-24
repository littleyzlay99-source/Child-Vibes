import {
  doc,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  GameRoom,
  JoinRoomResult,
  PlayerPositionRecord,
  PlayerPresenceEntry,
  RoomPlayer,
  RoomStatus,
  UserProfile,
} from '../types';
import { GAME_CONFIG } from '../config/gameRules';

export type RoomJoinErrorCode =
  | 'INVALID_CODE'
  | 'NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_PLAYING'
  | 'GAME_FINISHED'
  | 'AUTH_REQUIRED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export class RoomJoinError extends Error {
  code: RoomJoinErrorCode;
  constructor(code: RoomJoinErrorCode, message: string) {
    super(message);
    this.name = 'RoomJoinError';
    this.code = code;
  }
}

// Coalesce concurrent join requests from the same client/player for the same room code
const inFlightJoins = new Map<string, Promise<JoinRoomResult>>();

/**
 * Normalize room capacity to a valid integer [2..4]
 */
export function normalizeMaxPlayers(maxPlayers: unknown): number {
  const parsed = Number(maxPlayers);
  if (!Number.isFinite(parsed) || parsed < 2) return 2;
  if (parsed > 4) return 4;
  return Math.floor(parsed);
}

/**
 * Compute authoritative lobby status ('waiting' vs 'full') from unique active player count
 */
export function computeLobbyStatus(uniquePlayerCount: number, maxPlayers: number): 'waiting' | 'full' {
  return uniquePlayerCount >= normalizeMaxPlayers(maxPlayers) ? 'full' : 'waiting';
}

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
 * Sanitize a RoomPlayer object so no `undefined` field ever enters Firestore,
 * while strictly preserving position and positionVersion.
 */
function sanitizePlayer(
  p: RoomPlayer,
  now: number,
  overrides?: Partial<RoomPlayer>
): RoomPlayer {
  const merged = { ...p, ...(overrides || {}) };
  const safePos =
    typeof merged.position === 'number' && !isNaN(merged.position)
      ? Math.max(1, Math.min(100, Math.round(merged.position)))
      : 1;
  const safeVer =
    typeof merged.positionVersion === 'number' &&
    !isNaN(merged.positionVersion) &&
    merged.positionVersion >= 1
      ? Math.floor(merged.positionVersion)
      : 1;

  const clean: RoomPlayer = {
    uid: merged.uid,
    playerId: merged.playerId || `PL-${merged.uid.substring(0, 6)}`,
    displayName: merged.displayName || 'ကစားသမား',
    photoURL: merged.photoURL || '',
    isReady: !!merged.isReady,
    color: merged.color || '#3B82F6',
    position: safePos,
    positionVersion: safeVer,
    lastMoveId: merged.lastMoveId ?? null,
    updatedAtMs: typeof merged.updatedAtMs === 'number' ? merged.updatedAtMs : now,
    activeTokenSkin: merged.activeTokenSkin || 'token_crown',
    isConnected: merged.isConnected !== false,
    lastSeen: typeof merged.lastSeen === 'number' ? merged.lastSeen : now,
  };

  if (merged.rank !== undefined && merged.rank !== null) {
    clean.rank = merged.rank;
  }
  if (merged.disconnectedAt !== undefined) {
    clean.disconnectedAt = merged.disconnectedAt;
  }

  return clean;
}

/**
 * Reconcile a player's state against the authoritative `playerPositions` map,
 * always keeping whichever record has the higher `positionVersion`.
 */
function resolveAuthoritativePlayer(
  p: RoomPlayer,
  playerPositions: Record<string, PlayerPositionRecord> | undefined,
  now: number
): RoomPlayer {
  const mapRec = playerPositions?.[p.uid];
  const pVer =
    typeof p.positionVersion === 'number' && p.positionVersion >= 1 ? p.positionVersion : 1;
  const mapVer = typeof mapRec?.positionVersion === 'number' ? mapRec.positionVersion : 0;

  if (mapRec && mapVer > pVer) {
    return sanitizePlayer(p, now, {
      position: mapRec.position,
      positionVersion: mapVer,
      lastMoveId: mapRec.lastMoveId ?? null,
      updatedAtMs: mapRec.updatedAtMs || now,
    });
  }

  return sanitizePlayer(p, now, {
    position: p.position || 1,
    positionVersion: pVer,
    lastMoveId: p.lastMoveId ?? mapRec?.lastMoveId ?? null,
    updatedAtMs: p.updatedAtMs ?? mapRec?.updatedAtMs ?? now,
  });
}

/**
 * Deduplicate and reconcile room players strictly by unique `uid`.
 * Prevents Host double-counting and duplicate player entries while preserving
 * the highest `positionVersion` and latest connection metadata.
 */
export function deduplicateRoomPlayers(
  players: RoomPlayer[] | undefined | null,
  playerPositions?: Record<string, PlayerPositionRecord>,
  now: number = Date.now()
): RoomPlayer[] {
  if (!Array.isArray(players) || players.length === 0) return [];
  const byUid = new Map<string, RoomPlayer>();

  for (const rawPlayer of players) {
    if (!rawPlayer || typeof rawPlayer.uid !== 'string' || !rawPlayer.uid.trim()) {
      continue;
    }
    const uid = rawPlayer.uid.trim();
    const resolved = resolveAuthoritativePlayer({ ...rawPlayer, uid }, playerPositions, now);
    const existing = byUid.get(uid);

    if (!existing) {
      byUid.set(uid, resolved);
    } else {
      const existingVer = existing.positionVersion || 1;
      const incomingVer = resolved.positionVersion || 1;
      const winner = incomingVer >= existingVer ? resolved : existing;
      const loser = incomingVer >= existingVer ? existing : resolved;
      byUid.set(
        uid,
        sanitizePlayer(winner, now, {
          isReady: winner.isReady || loser.isReady,
          isConnected: winner.isConnected !== false || loser.isConnected !== false,
          lastSeen: Math.max(winner.lastSeen || 0, loser.lastSeen || 0),
        })
      );
    }
  }

  return Array.from(byUid.values());
}

/**
 * Classify errors from room join/create into distinct user-facing Burmese messages
 * (separating Network Error, Room Full Error, Invalid Code, Game Playing, etc.)
 */
function classifyJoinError(error: unknown, roomPath: string): RoomJoinError {
  if (error instanceof RoomJoinError) {
    return error;
  }

  const errCode = (error as any)?.code as string | undefined;
  const errMsg = error instanceof Error ? error.message : String(error);
  const lowerMsg = errMsg.toLowerCase();

  const isOfflineOrNetwork =
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    errCode === 'unavailable' ||
    errCode === 'deadline-exceeded' ||
    errCode === 'network-request-failed' ||
    lowerMsg.includes('offline') ||
    lowerMsg.includes('network') ||
    lowerMsg.includes('failed to fetch');

  if (isOfflineOrNetwork) {
    return new RoomJoinError(
      'NETWORK_ERROR',
      'အင်တာနက်ချိတ်ဆက်မှု မတည်ငြိမ်ပါ။ လိုင်းပြန်စစ်ဆေးပြီး ထပ်မံကြိုးစားပေးပါ။'
    );
  }

  // Log diagnostic info for unexpected Firestore/permission issues without throwing raw JSON to UI
  try {
    console.error('Room join diagnostic error:', {
      path: roomPath,
      code: errCode,
      message: errMsg,
      uid: auth.currentUser?.uid,
    });
  } catch {
    // Ignore logging errors
  }

  return new RoomJoinError(
    'UNKNOWN_ERROR',
    'အခန်းသို့ ဝင်ရောက်ရာတွင် အဆင်မပြေဖြစ်သွားပါသည်။ ခဏစောင့်ပြီး ပြန်လည်ကြိုးစားပေးပါ။'
  );
}

/**
 * Synchronize the per-player authoritative `playerPositions` map from sanitized players.
 */
function buildPlayerPositionsMap(
  players: RoomPlayer[],
  now: number
): Record<string, PlayerPositionRecord> {
  const map: Record<string, PlayerPositionRecord> = {};
  for (const p of players) {
    map[p.uid] = {
      position: p.position || 1,
      positionVersion: p.positionVersion || 1,
      lastMoveId: p.lastMoveId ?? null,
      updatedAtMs: p.updatedAtMs || now,
    };
  }
  return map;
}

/**
 * Create a new Game Room
 */
export async function createGameRoom(
  hostUser: UserProfile,
  maxPlayersInput: number = 4,
  exactFinish: boolean = false
): Promise<JoinRoomResult> {
  const effectiveHostUid = auth.currentUser?.uid || hostUser.id;
  if (!effectiveHostUid) {
    throw new RoomJoinError('AUTH_REQUIRED', 'ကျေးဇူးပြု၍ အကောင့်အရင်ဝင်ရောက်ပေးပါ။');
  }

  const maxPlayers = normalizeMaxPlayers(maxPlayersInput);
  const roomCode = generateRoomCode();
  const roomId = `room_${roomCode}`;
  const roomRef = doc(db, 'rooms', roomId);
  const now = Date.now();

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

  const newRoom: GameRoom = {
    id: roomId,
    roomCode,
    gameType: 'snakes_and_ladders',
    hostId: effectiveHostUid,
    hostName: hostUser.displayName,
    status: 'waiting',
    maxPlayers,
    playerCount: 1,
    players: [initialPlayer],
    currentTurnIndex: 0,
    lastDiceRoll: 1,
    lastMoveSummary: `${hostUser.displayName} မှ အခန်းဖန်တီးထားပါသည်။`,
    winnerId: null,
    winnerName: null,
    exactFinish,
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
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };

  try {
    await setDoc(roomRef, {
      ...newRoom,
      timestamp: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    });
    return {
      roomId,
      room: newRoom,
      alreadyJoined: false,
    };
  } catch (error) {
    throw classifyJoinError(error, `rooms/${roomId}`);
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

  const effectiveUid = auth.currentUser?.uid || user.id;
  if (!effectiveUid) {
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
            nextSummary = `ကစားသမား ${user.displayName} ပြန်လည်ချိတ်ဆက်မိပါပြီ။`;
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

        const updatedPlayers = [...uniquePlayers, newPlayer];
        const newPlayerCount = updatedPlayers.length;
        const nextStatus = computeLobbyStatus(newPlayerCount, maxPlayers);
        const nextStateVersion = (roomData.stateVersion || 1) + 1;
        const updatedPositions = buildPlayerPositionsMap(updatedPlayers, txNow);
        const nextSummary = `${user.displayName} အခန်းသို့ ဝင်ရောက်လာခဲ့သည်။`;
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
    return await joinPromise;
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
    console.warn('Reconnect update notice:', error);
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
    console.warn('Mark disconnected error:', error);
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
    console.warn('Reconnection timeout error:', error);
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
    console.warn('Turn timeout skip notice:', error);
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
      const maxPlayers = normalizeMaxPlayers(room.maxPlayers);

      const uniquePlayers = deduplicateRoomPlayers(room.players, room.playerPositions, txNow);

      const updatedPlayers = uniquePlayers.map((p) =>
        p.uid === userId ? sanitizePlayer(p, txNow, { isReady }) : p
      );

      const nextStatus: RoomStatus =
        room.status === 'playing' || room.status === 'finished'
          ? room.status
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

      if (room.status !== 'waiting' && room.status !== 'full') return;

      const uniquePlayers = deduplicateRoomPlayers(room.players, room.playerPositions, txNow);
      if (uniquePlayers.length < 2) return;

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
        turnStartTimestamp: txNow,
        turnDeadline: txNow + 30000, // 30 seconds for first turn
        reconnectionDeadline: null,
        disconnectedPlayerId: null,
        disconnectedPlayerName: null,
        lastMoveId: null,
        lastMovePath: [],
        lastMovingPlayerUid: null,
        gameRound: (room.gameRound || 1) + 1,
        stateVersion: (room.stateVersion || 1) + 1,
        lastMoveSummary: 'ဂိမ်းစတင်ပါပြီ! ပထမဆုံး ကစားသမား အံစာတုံး စတင်ခေါက်ပါ!',
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
export async function leaveGameRoom(roomId: string, userId: string) {
  const roomRef = doc(db, 'rooms', roomId);
  try {
    await runTransaction(db, async (transaction) => {
      const txNow = Date.now();
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) return;
      const room = roomSnap.data() as GameRoom;
      const maxPlayers = normalizeMaxPlayers(room.maxPlayers);

      const uniquePlayers = deduplicateRoomPlayers(room.players, room.playerPositions, txNow);
      const remainingPlayers = uniquePlayers.filter((p) => p.uid !== userId);

      if (remainingPlayers.length === 0) {
        transaction.delete(roomRef);
        return;
      }

      let newHostId = room.hostId;
      let newHostName = room.hostName;

      if (room.hostId === userId || !remainingPlayers.some((p) => p.uid === room.hostId)) {
        newHostId = remainingPlayers[0].uid;
        newHostName = remainingPlayers[0].displayName;
        remainingPlayers[0] = sanitizePlayer(remainingPlayers[0], txNow, { isReady: true });
      }

      let nextTurn = room.currentTurnIndex;
      if (nextTurn >= remainingPlayers.length) {
        nextTurn = 0;
      }

      // If in pre-game lobby ('waiting' or 'full'), dynamically recalculate capacity status
      const nextStatus: RoomStatus =
        room.status === 'playing' || room.status === 'finished'
          ? room.status
          : computeLobbyStatus(remainingPlayers.length, maxPlayers);

      transaction.update(roomRef, {
        players: remainingPlayers,
        playerCount: remainingPlayers.length,
        status: nextStatus,
        playerPositions: buildPlayerPositionsMap(remainingPlayers, txNow),
        hostId: newHostId,
        hostName: newHostName,
        currentTurnIndex: nextTurn,
        turnStartTimestamp: txNow,
        turnDeadline: txNow + 30000,
        stateVersion: (room.stateVersion || 1) + 1,
        lastMoveSummary: `ကစားသမားတစ်ဦး အခန်းမှ ထွက်ခွာသွားပါသည်။`,
        updatedAt: new Date(txNow).toISOString(),
        serverUpdatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
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
        lastMoveTimestamp: txNow,
        updatedAt: new Date(txNow).toISOString(),
        serverUpdatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
  }
}
