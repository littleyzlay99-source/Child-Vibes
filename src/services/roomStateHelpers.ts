import { PlayerPositionRecord, RoomPlayer } from '../types';

/**
 * Pure, stateless room & player state reconciliation helpers.
 * Kept free of Firebase / service imports to maintain a strict zero-cycle dependency graph.
 */

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
export function computeLobbyStatus(
  uniquePlayerCount: number,
  maxPlayers: number
): 'waiting' | 'full' {
  return uniquePlayerCount >= normalizeMaxPlayers(maxPlayers) ? 'full' : 'waiting';
}

/**
 * Sanitize a RoomPlayer object so no `undefined` field ever enters Firestore,
 * while strictly preserving position and positionVersion.
 */
export function sanitizePlayer(
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

  const safeUid = (typeof merged.uid === 'string' ? merged.uid.trim() : '').slice(0, 128);
  const rawPlayerId = typeof merged.playerId === 'string' ? merged.playerId.trim() : '';
  const safePlayerId = (rawPlayerId || `PL-${safeUid.substring(0, 6)}`).slice(0, 32);
  const rawDisplayName = typeof merged.displayName === 'string' ? merged.displayName.trim() : '';
  const safeDisplayName = (rawDisplayName || 'ကစားသမား').slice(0, 60);
  const safePhotoURL =
    typeof merged.photoURL === 'string' && merged.photoURL.length <= 1000
      ? merged.photoURL
      : '';
  const safeColor = (
    (typeof merged.color === 'string' ? merged.color.trim() : '') || '#3B82F6'
  ).slice(0, 24);
  const safeTokenSkin = (
    (typeof merged.activeTokenSkin === 'string' ? merged.activeTokenSkin.trim() : '') ||
    'token_crown'
  ).slice(0, 50);
  const safeLastMoveId =
    typeof merged.lastMoveId === 'string' ? merged.lastMoveId.slice(0, 80) : null;

  const clean: RoomPlayer = {
    uid: safeUid,
    playerId: safePlayerId,
    displayName: safeDisplayName,
    photoURL: safePhotoURL,
    isReady: !!merged.isReady,
    color: safeColor,
    position: safePos,
    positionVersion: safeVer,
    lastMoveId: safeLastMoveId,
    updatedAtMs: typeof merged.updatedAtMs === 'number' ? merged.updatedAtMs : now,
    activeTokenSkin: safeTokenSkin,
    isConnected: merged.isConnected !== false,
    lastSeen: typeof merged.lastSeen === 'number' ? merged.lastSeen : now,
  };

  if (
    typeof merged.rank === 'number' &&
    merged.rank >= 1 &&
    merged.rank <= 4
  ) {
    clean.rank = Math.floor(merged.rank);
  }
  if (merged.disconnectedAt !== undefined) {
    clean.disconnectedAt =
      typeof merged.disconnectedAt === 'number' && merged.disconnectedAt >= 0
        ? merged.disconnectedAt
        : null;
  }

  return clean;
}

/**
 * Reconcile a player's state against the authoritative `playerPositions` map,
 * always keeping whichever record has the higher `positionVersion`.
 */
export function resolveAuthoritativePlayer(
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
 * Synchronize the per-player authoritative `playerPositions` map from sanitized players.
 */
export function buildPlayerPositionsMap(
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
