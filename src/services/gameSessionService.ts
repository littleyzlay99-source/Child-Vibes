import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getGameById, UNKNOWN_GAME_FALLBACK_TITLE } from '../games/registry';
import { ActiveGameSession, GameRoom } from '../types';
import { deduplicateRoomPlayers, normalizeMaxPlayers } from './roomStateHelpers';
import { claimMatchReward } from './rewardService';

const LEGACY_SESSION_KEY = 'child_vibes_active_room_id';
const SESSION_KEY_PREFIX = 'child_vibes_active_session_v2_';
const EXITED_ROOMS_KEY_PREFIX = 'child_vibes_exited_rooms_v2_';
const MAX_SESSION_STALE_MS = 6 * 60 * 60 * 1000; // 6 hours safety bound for abandoned rooms

/**
 * Resolve mini-game display title inside Dedicated Game Mode from the Central Game Registry.
 * Strictly returns the registered game's shortTitle or 'မီနီဂိမ်း' for empty/unknown IDs
 * so Dedicated Game Mode never mislabels an unsupported or empty room as Snakes & Ladders.
 */
export function getMiniGameTitle(gameType?: string | null): string {
  return getGameById(gameType)?.shortTitle || UNKNOWN_GAME_FALLBACK_TITLE;
}

function getSafeStorage(kind: 'local' | 'session'): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function getSessionStorageKey(uid: string): string {
  return `${SESSION_KEY_PREFIX}${uid}`;
}

function getExitedRoomsStorageKey(uid: string): string {
  return `${EXITED_ROOMS_KEY_PREFIX}${uid}`;
}

function readExitedRoomIds(uid: string): string[] {
  const storage = getSafeStorage('local');
  if (!storage || !uid) return [];
  try {
    const raw = storage.getItem(getExitedRoomsStorageKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeExitedRoomIds(uid: string, roomIds: string[]): void {
  const storage = getSafeStorage('local');
  if (!storage || !uid) return;
  try {
    storage.setItem(getExitedRoomsStorageKey(uid), JSON.stringify(roomIds.slice(-15)));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Returns true if the player intentionally exited this room and has not re-joined it since.
 */
export function isRoomExplicitlyExited(uid: string, roomId: string): boolean {
  if (!uid || !roomId) return false;
  return readExitedRoomIds(uid).includes(roomId);
}

/**
 * Read locally persisted active session for the given user UID.
 */
export function getLocalActiveGameSession(uid: string): ActiveGameSession | null {
  if (!uid) return null;
  const local = getSafeStorage('local');
  const session = getSafeStorage('session');

  try {
    const rawLocal = local?.getItem(getSessionStorageKey(uid));
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal) as ActiveGameSession;
      if (parsed?.roomId && parsed.uid === uid && !isRoomExplicitlyExited(uid, parsed.roomId)) {
        return parsed;
      }
    }

    const rawSession = session?.getItem(getSessionStorageKey(uid));
    if (rawSession) {
      const parsed = JSON.parse(rawSession) as ActiveGameSession;
      if (parsed?.roomId && parsed.uid === uid && !isRoomExplicitlyExited(uid, parsed.roomId)) {
        return parsed;
      }
    }

    // Legacy sessionStorage migration fallback
    const legacyRoomId = session?.getItem(LEGACY_SESSION_KEY);
    if (legacyRoomId && !isRoomExplicitlyExited(uid, legacyRoomId)) {
      return {
        uid,
        roomId: legacyRoomId,
        roomCode: legacyRoomId.replace(/^room_/, ''),
        gameType: 'snakes_and_ladders',
        savedAt: Date.now(),
      };
    }
  } catch {
    // Ignore malformed JSON
  }

  return null;
}

/**
 * Resolve the best candidate active room ID from local storage or Firestore user profile,
 * strictly excluding rooms the player already exited.
 */
export function getCandidateSessionRoomId(
  uid: string,
  profileActiveRoomId?: string | null
): string | null {
  if (!uid) return null;

  const localSession = getLocalActiveGameSession(uid);
  if (localSession?.roomId) {
    return localSession.roomId;
  }

  if (
    profileActiveRoomId &&
    typeof profileActiveRoomId === 'string' &&
    !isRoomExplicitlyExited(uid, profileActiveRoomId)
  ) {
    return profileActiveRoomId;
  }

  return null;
}

/**
 * Persist active game session locally (localStorage + sessionStorage) and optionally sync
 * to `users/{uid}` in Firestore so browser restarts or tab closes can recover the room.
 */
export async function saveActiveGameSession(
  uid: string,
  roomId: string,
  roomCode?: string,
  gameType: string = 'snakes_and_ladders',
  syncFirestore: boolean = true
): Promise<void> {
  if (!uid || !roomId) return;

  const normalizedCode = (roomCode || roomId.replace(/^room_/, '')).toUpperCase();
  const payload: ActiveGameSession = {
    uid,
    roomId,
    roomCode: normalizedCode,
    gameType: gameType || 'snakes_and_ladders',
    savedAt: Date.now(),
  };

  // Remove from exited ledger since the player is actively entering/re-entering this room
  const exited = readExitedRoomIds(uid).filter((id) => id !== roomId);
  writeExitedRoomIds(uid, exited);

  const local = getSafeStorage('local');
  const session = getSafeStorage('session');
  try {
    const serialized = JSON.stringify(payload);
    local?.setItem(getSessionStorageKey(uid), serialized);
    session?.setItem(getSessionStorageKey(uid), serialized);
    session?.setItem(LEGACY_SESSION_KEY, roomId);
  } catch {
    // Ignore storage errors
  }

  if (syncFirestore) {
    try {
      await updateDoc(doc(db, 'users', uid), {
        activeRoomId: roomId,
        activeRoomCode: normalizedCode,
        activeGameType: payload.gameType,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Non-blocking: user doc may not exist in isolated test environments or while offline
    }
  }
}

/**
 * Mark a room session as intentionally exited by the player.
 * Synchronously clears local storage & records explicit exit so refresh NEVER re-enters the old room,
 * then clears `activeRoomId` on `users/{uid}` in Firestore.
 */
export async function markGameSessionExited(
  uid: string,
  roomId?: string | null,
  syncFirestore: boolean = true
): Promise<void> {
  if (!uid) return;

  if (roomId) {
    const exited = readExitedRoomIds(uid).filter((id) => id !== roomId);
    exited.push(roomId);
    writeExitedRoomIds(uid, exited);
  }

  clearLocalSessionOnly(uid);

  if (syncFirestore) {
    try {
      await updateDoc(doc(db, 'users', uid), {
        activeRoomId: null,
        activeRoomCode: null,
        activeGameType: null,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Non-blocking cleanup
    }
  }
}

/**
 * Clear local session storage without adding to explicit-exit list (used for stale/finished cleanup).
 */
export function clearLocalSessionOnly(uid: string): void {
  const local = getSafeStorage('local');
  const session = getSafeStorage('session');
  try {
    if (uid) {
      local?.removeItem(getSessionStorageKey(uid));
      session?.removeItem(getSessionStorageKey(uid));
    }
    session?.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // Ignore storage errors
  }
}

export type SessionRecoveryOutcome =
  | { status: 'recovered'; roomId: string; room: GameRoom }
  | { status: 'offline_keep'; roomId: string; room: null }
  | { status: 'invalid'; roomId: null; room: null };

/**
 * Verify a candidate room session against Firestore using a single document read (Spark Free Plan frugal).
 * - Preserves session if device is temporarily offline (never kicks player on connection drop)
 * - Restores active 'waiting', 'full', or 'playing' rooms where `uid` is still a member,
 *   keeping exact confirmed `playerPositions`, `currentTurnIndex`, and `turnDeadline`
 * - Cleans up stale/deleted/finished/exited rooms so old rooms are never re-entered
 */
export async function verifyAndRecoverGameSession(
  uid: string,
  candidateRoomId: string
): Promise<SessionRecoveryOutcome> {
  if (!uid || !candidateRoomId || isRoomExplicitlyExited(uid, candidateRoomId)) {
    clearLocalSessionOnly(uid);
    return { status: 'invalid', roomId: null, room: null };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { status: 'offline_keep', roomId: candidateRoomId, room: null };
  }

  try {
    const roomSnap = await getDoc(doc(db, 'rooms', candidateRoomId));
    if (!roomSnap.exists()) {
      await markGameSessionExited(uid, candidateRoomId, true);
      return { status: 'invalid', roomId: null, room: null };
    }

    const rawRoom = roomSnap.data() as GameRoom;
    const uniquePlayers = deduplicateRoomPlayers(rawRoom.players, rawRoom.playerPositions);
    const isMember = uniquePlayers.some((p) => p.uid === uid);

    // Must still be a room member and match must still be active ('waiting', 'full', or 'playing')
    if (!isMember || rawRoom.status === 'finished') {
      if (isMember && rawRoom.status === 'finished' && rawRoom.winnerId) {
        try {
          await claimMatchReward(
            rawRoom.id || candidateRoomId,
            rawRoom.gameRound,
            uid
          );
        } catch {
          // Non-blocking: already claimed or handled cleanly
        }
      }
      await markGameSessionExited(uid, candidateRoomId, true);
      return { status: 'invalid', roomId: null, room: null };
    }

    // Guard against forgotten multi-day abandoned rooms
    const updatedMs = rawRoom.updatedAt ? new Date(rawRoom.updatedAt).getTime() : Date.now();
    if (Number.isFinite(updatedMs) && Date.now() - updatedMs > MAX_SESSION_STALE_MS) {
      await markGameSessionExited(uid, candidateRoomId, true);
      return { status: 'invalid', roomId: null, room: null };
    }

    const maxPlayers = normalizeMaxPlayers(rawRoom.maxPlayers);
    const reconciledRoom: GameRoom = {
      ...rawRoom,
      id: rawRoom.id || candidateRoomId,
      maxPlayers,
      playerCount: uniquePlayers.length,
      players: uniquePlayers,
    };

    // Refresh local storage timestamp without triggering an extra Firestore write
    await saveActiveGameSession(
      uid,
      candidateRoomId,
      reconciledRoom.roomCode,
      reconciledRoom.gameType || 'snakes_and_ladders',
      false
    );

    return {
      status: 'recovered',
      roomId: candidateRoomId,
      room: reconciledRoom,
    };
  } catch (error: any) {
    const code = error?.code as string | undefined;
    const msg = String(error?.message || '').toLowerCase();
    const isTransientNetworkError =
      code === 'unavailable' ||
      code === 'deadline-exceeded' ||
      msg.includes('offline') ||
      msg.includes('network');

    if (isTransientNetworkError) {
      return { status: 'offline_keep', roomId: candidateRoomId, room: null };
    }

    clearLocalSessionOnly(uid);
    return { status: 'invalid', roomId: null, room: null };
  }
}
