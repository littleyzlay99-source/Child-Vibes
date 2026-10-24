import {
  doc,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  GameRoom,
  PlayerPositionRecord,
  PlayerPresenceEntry,
  RoomPlayer,
  UserProfile,
} from '../types';
import { GAME_CONFIG } from '../config/gameRules';

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
  maxPlayers: number = 4,
  exactFinish: boolean = false
): Promise<string> {
  const roomCode = generateRoomCode();
  const roomId = `room_${roomCode}`;
  const roomRef = doc(db, 'rooms', roomId);
  const now = Date.now();

  const initialPlayer = sanitizePlayer(
    {
      uid: hostUser.id,
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
    [hostUser.id]: {
      isConnected: true,
      lastSeen: now,
      disconnectedAt: null,
    },
  };

  const newRoom: GameRoom = {
    id: roomId,
    roomCode,
    gameType: 'snakes_and_ladders',
    hostId: hostUser.id,
    hostName: hostUser.displayName,
    status: 'waiting',
    maxPlayers,
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
    return roomId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `rooms/${roomId}`);
    throw error;
  }
}

/**
 * Join an existing Game Room by 6-letter Room Code (Atomic Transaction)
 */
export async function joinGameRoomByCode(
  roomCodeInput: string,
  user: UserProfile
): Promise<string> {
  const cleanedCode = roomCodeInput.trim().toUpperCase();
  const roomId = `room_${cleanedCode}`;
  const roomRef = doc(db, 'rooms', roomId);

  try {
    await runTransaction(db, async (transaction) => {
      const txNow = Date.now();
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) {
        throw new Error('အခန်းကုဒ် မှားယွင်းနေပါသည် သို့မဟုတ် အခန်း မရှိတော့ပါ။');
      }

      const roomData = roomSnap.data() as GameRoom;
      if (roomData.status === 'finished') {
        throw new Error('ဤဂိမ်းပွဲသည် ပြီးဆုံးသွားပါပြီ။');
      }

      const authoritativePlayers = roomData.players.map((p) =>
        resolveAuthoritativePlayer(p, roomData.playerPositions, txNow)
      );

      // Check if player already in room (Reconnecting or returning player)
      const existingIndex = authoritativePlayers.findIndex((p) => p.uid === user.id);
      if (existingIndex >= 0) {
        const updatedPlayers = authoritativePlayers.map((p, idx) =>
          idx === existingIndex
            ? sanitizePlayer(p, txNow, {
                isConnected: true,
                lastSeen: txNow,
                disconnectedAt: null,
              })
            : p
        );

        const updates: Record<string, any> = {
          players: updatedPlayers,
          playerPositions: buildPlayerPositionsMap(updatedPlayers, txNow),
          [`presence.${user.id}`]: {
            isConnected: true,
            lastSeen: txNow,
            disconnectedAt: null,
          },
          stateVersion: (roomData.stateVersion || 1) + 1,
          updatedAt: new Date(txNow).toISOString(),
          serverUpdatedAt: serverTimestamp(),
        };

        if (roomData.disconnectedPlayerId === user.id) {
          updates.disconnectedPlayerId = null;
          updates.disconnectedPlayerName = null;
          updates.reconnectionDeadline = null;
          updates.lastMoveSummary = `ကစားသမား ${user.displayName} ပြန်လည်ချိတ်ဆက်မိပါပြီ။`;
        }

        transaction.update(roomRef, updates);
        return;
      }

      if (roomData.status !== 'waiting') {
        throw new Error('ဂိမ်းစတင်ပြီးဖြစ်သောကြောင့် အသစ်ဝင်ရောက်၍ မရတော့ပါ။');
      }

      if (authoritativePlayers.length >= roomData.maxPlayers) {
        throw new Error('အခန်းတွင် လူပြည့်နေပါပြီ (အများဆုံး ' + roomData.maxPlayers + ' ဦး)။');
      }

      // Pick unique color for new player
      const usedColors = authoritativePlayers.map((p) => p.color);
      const availableColor =
        GAME_CONFIG.PLAYER_COLORS.find((c) => !usedColors.includes(c.hex))?.hex ||
        GAME_CONFIG.PLAYER_COLORS[authoritativePlayers.length % GAME_CONFIG.PLAYER_COLORS.length]
          .hex;

      const newPlayer = sanitizePlayer(
        {
          uid: user.id,
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

      const updatedPlayers = [...authoritativePlayers, newPlayer];

      transaction.update(roomRef, {
        players: updatedPlayers,
        playerPositions: buildPlayerPositionsMap(updatedPlayers, txNow),
        [`presence.${user.id}`]: {
          isConnected: true,
          lastSeen: txNow,
          disconnectedAt: null,
        },
        stateVersion: (roomData.stateVersion || 1) + 1,
        lastMoveSummary: `${user.displayName} အခန်းသို့ ဝင်ရောက်လာခဲ့သည်။`,
        updatedAt: new Date(txNow).toISOString(),
        serverUpdatedAt: serverTimestamp(),
      });
    });

    return roomId;
  } catch (error) {
    if (error instanceof Error && (error.message.includes('အခန်း') || error.message.includes('ဂိမ်း'))) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
    throw error;
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

      const targetPlayer = room.players.find((p) => p.uid === userId);
      if (!targetPlayer) return;

      const wasDisconnected =
        targetPlayer.isConnected === false || room.disconnectedPlayerId === userId;

      if (!wasDisconnected) {
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

      const authoritativePlayers = room.players.map((p) =>
        resolveAuthoritativePlayer(p, room.playerPositions, txNow)
      );

      const updatedPlayers = authoritativePlayers.map((p) =>
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

      const authoritativePlayers = room.players.map((p) =>
        resolveAuthoritativePlayer(p, room.playerPositions, txNow)
      );

      const updatedPlayers = authoritativePlayers.map((p) =>
        p.uid === userId ? sanitizePlayer(p, txNow, { isReady }) : p
      );

      transaction.update(roomRef, {
        players: updatedPlayers,
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

      const resetStartPlayers = room.players.map((p) =>
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
 * Leave Room (Atomic Transaction preserving all remaining players' exact positions)
 */
export async function leaveGameRoom(roomId: string, userId: string) {
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

      const remainingPlayers = authoritativePlayers.filter((p) => p.uid !== userId);

      if (remainingPlayers.length === 0) {
        transaction.delete(roomRef);
        return;
      }

      let newHostId = room.hostId;
      let newHostName = room.hostName;

      if (room.hostId === userId) {
        newHostId = remainingPlayers[0].uid;
        newHostName = remainingPlayers[0].displayName;
        remainingPlayers[0] = sanitizePlayer(remainingPlayers[0], txNow, { isReady: true });
      }

      let nextTurn = room.currentTurnIndex;
      if (nextTurn >= remainingPlayers.length) {
        nextTurn = 0;
      }

      transaction.update(roomRef, {
        players: remainingPlayers,
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

      const resetPlayers = room.players.map((p) => {
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

      transaction.update(roomRef, {
        players: resetPlayers,
        playerPositions: buildPlayerPositionsMap(resetPlayers, txNow),
        status: 'waiting',
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
