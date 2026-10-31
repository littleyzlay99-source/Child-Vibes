import { doc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { GAME_CONFIG } from '../config/gameRules';
import { auth, db } from '../lib/firebase';
import { generateRoomCode, RoomJoinError } from './roomService';
import {
  buildPlayerPositionsMap,
  computeLobbyStatus,
  deduplicateRoomPlayers,
  normalizeMaxPlayers,
  sanitizePlayer,
} from './roomStateHelpers';
import type { GameRoom, JoinRoomResult, PlayerPresenceEntry, RoomStatus, UserProfile } from '../types';
import { resolveSnowRushWorkerHealthUrl } from '../games/snow-rush/network/protocol';

/**
 * Snow Rush: Avalanche Escape — Step 4.9 Private Multiplayer Test Room Service
 *
 * Strict Safety Guarantees:
 * - Never modifies `registry.ts` (`snow_rush` remains `coming_soon` for all public users).
 * - Never modifies `firestore.rules` (100% compatible with existing `match /rooms/{roomId}` rules).
 * - Never auto-creates rooms or test data: runs ONLY on explicit authenticated tester button click.
 * - Never writes `winnerId`, `winnerName`, `status: 'finished'`, XP, Points, or `users/{uid}` session fields.
 * - Never calls `claimMatchReward()`.
 * - Strictly refuses to join, update, or leave any room whose `gameType !== 'snow_rush'`.
 * - Deletes the room cleanly from Firestore when the last private tester leaves.
 */

export interface SnowRushWorkerHealthCheckResult {
  readonly configured: boolean;
  readonly healthUrl: string | null;
  readonly ok: boolean;
  readonly statusCode: number | null;
  readonly latencyMs: number | null;
  readonly service: string | null;
  readonly protocolVersion: number | null;
  readonly snapshotBroadcastHz: number | null;
  readonly durableObjectBindingReady: boolean;
  readonly firebaseProjectConfigured: boolean;
  readonly firestoreNamedDbConfigured: boolean;
  readonly errorMessageMm: string | null;
}

export function clampPrivateSnowRushMaxPlayers(input: unknown): 2 | 3 | 4 {
  const n = typeof input === 'number' && Number.isFinite(input) ? Math.floor(input) : 4;
  if (n <= 2) return 2;
  if (n === 3) return 3;
  return 4;
}

export function buildPrivateSnowRushRoomPayload(params: {
  readonly hostUser: UserProfile;
  readonly effectiveHostUid: string;
  readonly roomCode: string;
  readonly maxPlayers: 2 | 3 | 4;
  readonly now?: number;
}): GameRoom {
  const { hostUser, effectiveHostUid, roomCode, maxPlayers, now = Date.now() } = params;
  const roomId = `room_${roomCode}`;
  const isoTimestamp = new Date(now).toISOString();

  const initialPlayer = sanitizePlayer(
    {
      uid: effectiveHostUid,
      playerId: hostUser.playerId,
      displayName: hostUser.displayName,
      photoURL: hostUser.photoURL,
      isReady: true,
      color: GAME_CONFIG.PLAYER_COLORS[0].hex,
      position: 1,
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
    gameType: 'snow_rush',
    hostId: effectiveHostUid,
    hostName: hostUser.displayName,
    status: 'waiting',
    maxPlayers,
    playerCount: 1,
    players: [initialPlayer],
    currentTurnIndex: 0,
    lastDiceRoll: 1,
    lastMoveSummary: `${hostUser.displayName} မှ Snow Rush Private Test အခန်းဖန်တီးထားပါသည်။`,
    winnerId: null,
    winnerName: null,
    matchParticipantIds: [],
    exactFinish: false,
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
 * Pure transition helper for leaving a Private Snow Rush Room.
 * Guarantees `status` NEVER becomes `'finished'` and `winnerId` is ALWAYS `null`.
 */
export function computePrivateSnowRushLeaveTransition(params: {
  readonly room: GameRoom;
  readonly leavingUserId: string;
  readonly now: number;
}):
  | { readonly action: 'noop' }
  | { readonly action: 'delete' }
  | {
      readonly action: 'update';
      readonly nextStatus: Extract<RoomStatus, 'waiting' | 'full' | 'playing'>;
      readonly remainingPlayers: GameRoom['players'];
      readonly newHostId: string;
      readonly newHostName: string;
      readonly nextStateVersion: number;
    } {
  const { room, leavingUserId, now } = params;
  if (room.gameType !== 'snow_rush') {
    return { action: 'noop' };
  }

  const maxPlayers = normalizeMaxPlayers(room.maxPlayers);
  const uniquePlayers = deduplicateRoomPlayers(room.players, room.playerPositions, now);
  const leavingIndex = uniquePlayers.findIndex((p) => p.uid === leavingUserId);
  if (leavingIndex < 0) {
    return { action: 'noop' };
  }

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

  let nextStatus: Extract<RoomStatus, 'waiting' | 'full' | 'playing'>;
  if (room.status === 'playing') {
    // If 2+ racers remain, keep the active race open; if only 1 remains, return cleanly to 'waiting' (NEVER 'finished')
    nextStatus = remainingPlayers.length >= 2 ? 'playing' : 'waiting';
  } else {
    nextStatus = computeLobbyStatus(remainingPlayers.length, maxPlayers);
  }

  return {
    action: 'update',
    nextStatus,
    remainingPlayers,
    newHostId,
    newHostName,
    nextStateVersion: (room.stateVersion || 1) + 1,
  };
}

/**
 * Live HTTP health & readiness check against the Companion Cloudflare Worker (`GET /health`).
 */
export async function checkSnowRushWorkerHealth(
  explicitBaseUrl?: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<SnowRushWorkerHealthCheckResult> {
  const healthUrl = resolveSnowRushWorkerHealthUrl(explicitBaseUrl);
  if (!healthUrl) {
    return {
      configured: false,
      healthUrl: null,
      ok: false,
      statusCode: null,
      latencyMs: null,
      service: null,
      protocolVersion: null,
      snapshotBroadcastHz: null,
      durableObjectBindingReady: false,
      firebaseProjectConfigured: false,
      firestoreNamedDbConfigured: false,
      errorMessageMm: 'VITE_SNOW_RUSH_WS_URL မသတ်မှတ်ရသေးပါ။',
    };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutHandle = controller ? setTimeout(() => controller.abort(), 6000) : null;
  const startedAt = Date.now();

  try {
    const res = await fetchImpl(healthUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    const latencyMs = Math.max(0, Date.now() - startedAt);
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const ok = res.ok && body.ok === true && body.service === 'child-vibes-snow-rush-server';
    return {
      configured: true,
      healthUrl,
      ok,
      statusCode: res.status,
      latencyMs,
      service: typeof body.service === 'string' ? body.service : null,
      protocolVersion: typeof body.protocolVersion === 'number' ? body.protocolVersion : null,
      snapshotBroadcastHz:
        typeof body.snapshotBroadcastHz === 'number' ? body.snapshotBroadcastHz : null,
      durableObjectBindingReady: body.durableObjectBindingReady !== false,
      firebaseProjectConfigured: body.firebaseProjectConfigured !== false,
      firestoreNamedDbConfigured: body.firestoreNamedDbConfigured !== false,
      errorMessageMm: ok
        ? null
        : `Worker /health စစ်ဆေးမှု မအောင်မြင်ပါ (HTTP ${res.status})။`,
    };
  } catch {
    return {
      configured: true,
      healthUrl,
      ok: false,
      statusCode: null,
      latencyMs: Math.max(0, Date.now() - startedAt),
      service: null,
      protocolVersion: null,
      snapshotBroadcastHz: null,
      durableObjectBindingReady: false,
      firebaseProjectConfigured: false,
      firestoreNamedDbConfigured: false,
      errorMessageMm:
        'Multiplayer Worker သို့ ချိတ်ဆက်၍ မရနိုင်ပါ (URL သို့မဟုတ် ALLOWED_ORIGINS စစ်ဆေးပါ)။',
    };
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function createPrivateSnowRushRoom(
  hostUser: UserProfile,
  maxPlayersInput?: number
): Promise<JoinRoomResult> {
  const effectiveHostUid = auth.currentUser?.uid || hostUser?.id;
  if (!effectiveHostUid) {
    throw new RoomJoinError('AUTH_REQUIRED', 'ကျေးဇူးပြု၍ အကောင့်အရင်ဝင်ရောက်ပေးပါ။');
  }

  const maxPlayers = clampPrivateSnowRushMaxPlayers(maxPlayersInput);
  const roomCode = generateRoomCode();
  const now = Date.now();
  const newRoom = buildPrivateSnowRushRoomPayload({
    hostUser,
    effectiveHostUid,
    roomCode,
    maxPlayers,
    now,
  });
  const roomRef = doc(db, 'rooms', newRoom.id);

  await setDoc(roomRef, {
    ...newRoom,
    timestamp: serverTimestamp(),
    serverUpdatedAt: serverTimestamp(),
  });

  return {
    roomId: newRoom.id,
    room: newRoom,
    alreadyJoined: false,
  };
}

export async function joinPrivateSnowRushRoomByCode(
  roomCodeInput: string,
  user: UserProfile
): Promise<JoinRoomResult> {
  const cleanedCode = roomCodeInput.replace(/^#/, '').trim().toUpperCase();
  if (!cleanedCode || !/^[A-Z0-9_-]{4,12}$/.test(cleanedCode)) {
    throw new RoomJoinError(
      'INVALID_CODE',
      'ကျေးဇူးပြု၍ မှန်ကန်သော Private Room Code ထည့်သွင်းပါ။'
    );
  }

  const effectiveUid = auth.currentUser?.uid || user.id;
  if (!effectiveUid) {
    throw new RoomJoinError('AUTH_REQUIRED', 'ကျေးဇူးပြု၍ အကောင့်အရင်ဝင်ရောက်ပေးပါ။');
  }

  const roomId = `room_${cleanedCode}`;
  const roomRef = doc(db, 'rooms', roomId);

  return runTransaction(db, async (transaction) => {
    const txNow = Date.now();
    const roomSnap = await transaction.get(roomRef);
    if (!roomSnap.exists()) {
      throw new RoomJoinError(
        'NOT_FOUND',
        'Private Room Code မှားယွင်းနေပါသည် သို့မဟုတ် အခန်း မရှိတော့ပါ။'
      );
    }

    const roomData = roomSnap.data() as GameRoom;
    if (roomData.gameType !== 'snow_rush') {
      throw new RoomJoinError(
        'INVALID_GAME_TYPE',
        'ဤအခန်းသည် Snow Rush Private Test အခန်း မဟုတ်ပါ။'
      );
    }

    const maxPlayers = normalizeMaxPlayers(roomData.maxPlayers);
    const uniquePlayers = deduplicateRoomPlayers(
      roomData.players,
      roomData.playerPositions,
      txNow
    );

    const existingIndex = uniquePlayers.findIndex((p) => p.uid === effectiveUid);
    if (existingIndex >= 0) {
      if (roomData.status === 'finished') {
        throw new RoomJoinError('GAME_FINISHED', 'ဤစမ်းသပ်ပွဲသည် ပြီးဆုံးသွားပါပြီ။');
      }
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

    if (roomData.status === 'finished') {
      throw new RoomJoinError('GAME_FINISHED', 'ဤစမ်းသပ်ပွဲသည် ပြီးဆုံးသွားပါပြီ။');
    }
    if (roomData.status === 'playing') {
      throw new RoomJoinError(
        'GAME_PLAYING',
        'ပြိုင်ပွဲ စတင်နေပြီဖြစ်သောကြောင့် ဝင်ရောက်၍ မရနိုင်ပါ။'
      );
    }
    if (uniquePlayers.length >= maxPlayers) {
      throw new RoomJoinError(
        'ROOM_FULL',
        `အခန်းလူပြည့်နေပါသည် (အများဆုံး ${maxPlayers} ဦး)။`
      );
    }

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
    const nextStatus = computeLobbyStatus(updatedPlayers.length, maxPlayers);
    const nextStateVersion = (roomData.stateVersion || 1) + 1;
    const updatedPositions = buildPlayerPositionsMap(updatedPlayers, txNow);
    const nextPresenceEntry: PlayerPresenceEntry = {
      isConnected: true,
      lastSeen: txNow,
      disconnectedAt: null,
    };

    transaction.update(roomRef, {
      players: updatedPlayers,
      playerCount: updatedPlayers.length,
      maxPlayers,
      status: nextStatus,
      winnerId: null,
      winnerName: null,
      playerPositions: updatedPositions,
      [`presence.${effectiveUid}`]: nextPresenceEntry,
      stateVersion: nextStateVersion,
      lastMoveSummary: `${user.displayName} Private Test အခန်းသို့ ဝင်ရောက်လာခဲ့သည်။`,
      updatedAt: new Date(txNow).toISOString(),
      serverUpdatedAt: serverTimestamp(),
    });

    return {
      roomId,
      room: {
        ...roomData,
        maxPlayers,
        playerCount: updatedPlayers.length,
        status: nextStatus,
        winnerId: null,
        winnerName: null,
        players: updatedPlayers,
        playerPositions: updatedPositions,
        presence: {
          ...(roomData.presence || {}),
          [effectiveUid]: nextPresenceEntry,
        },
        stateVersion: nextStateVersion,
        updatedAt: new Date(txNow).toISOString(),
      },
      alreadyJoined: false,
    };
  });
}

export async function togglePrivateSnowRushReady(
  roomId: string,
  userId: string,
  isReady: boolean
): Promise<void> {
  const roomRef = doc(db, 'rooms', roomId);
  await runTransaction(db, async (transaction) => {
    const txNow = Date.now();
    const roomSnap = await transaction.get(roomRef);
    if (!roomSnap.exists()) return;
    const room = roomSnap.data() as GameRoom;
    if (room.gameType !== 'snow_rush') return;

    const maxPlayers = normalizeMaxPlayers(room.maxPlayers);
    const uniquePlayers = deduplicateRoomPlayers(room.players, room.playerPositions, txNow);
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
      winnerId: null,
      winnerName: null,
      playerPositions: buildPlayerPositionsMap(updatedPlayers, txNow),
      stateVersion: (room.stateVersion || 1) + 1,
      updatedAt: new Date(txNow).toISOString(),
      serverUpdatedAt: serverTimestamp(),
    });
  });
}

export async function startPrivateSnowRushRace(
  roomId: string,
  callerUid: string
): Promise<void> {
  const roomRef = doc(db, 'rooms', roomId);
  await runTransaction(db, async (transaction) => {
    const txNow = Date.now();
    const roomSnap = await transaction.get(roomRef);
    if (!roomSnap.exists()) return;
    const room = roomSnap.data() as GameRoom;
    if (room.gameType !== 'snow_rush') return;
    if (room.hostId !== callerUid) return;
    if (room.status !== 'waiting' && room.status !== 'full') return;

    const uniquePlayers = deduplicateRoomPlayers(room.players, room.playerPositions, txNow);
    if (uniquePlayers.length < 2 || uniquePlayers.length > 4) return;

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
      winnerId: null,
      winnerName: null,
      matchParticipantIds: resetStartPlayers.map((p) => p.uid),
      gameRound: (room.gameRound || 1) + 1,
      stateVersion: (room.stateVersion || 1) + 1,
      lastMoveSummary: 'Snow Rush Private Multiplayer စတင်ပါပြီ!',
      updatedAt: new Date(txNow).toISOString(),
      serverUpdatedAt: serverTimestamp(),
    });
  });
}

export async function leavePrivateSnowRushRoom(
  roomId: string,
  userId: string
): Promise<void> {
  const roomRef = doc(db, 'rooms', roomId);
  await runTransaction(db, async (transaction) => {
    const txNow = Date.now();
    const roomSnap = await transaction.get(roomRef);
    if (!roomSnap.exists()) return;
    const room = roomSnap.data() as GameRoom;

    const transition = computePrivateSnowRushLeaveTransition({
      room,
      leavingUserId: userId,
      now: txNow,
    });

    if (transition.action === 'noop') return;
    if (transition.action === 'delete') {
      transaction.delete(roomRef);
      return;
    }

    transaction.update(roomRef, {
      players: transition.remainingPlayers,
      playerCount: transition.remainingPlayers.length,
      status: transition.nextStatus,
      playerPositions: buildPlayerPositionsMap(transition.remainingPlayers, txNow),
      hostId: transition.newHostId,
      hostName: transition.newHostName,
      winnerId: null,
      winnerName: null,
      matchParticipantIds:
        transition.nextStatus === 'playing'
          ? transition.remainingPlayers.map((p) => p.uid)
          : [],
      stateVersion: transition.nextStateVersion,
      lastMoveSummary: 'ကစားသမားတစ်ဦး Private Test အခန်းမှ ထွက်ခွာသွားပါသည်။',
      updatedAt: new Date(txNow).toISOString(),
      serverUpdatedAt: serverTimestamp(),
    });
  });
}
