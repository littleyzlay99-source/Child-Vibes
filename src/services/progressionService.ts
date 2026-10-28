import { LEVEL_SYSTEM_CONFIG } from '../config/rewardConfig';
import { LevelProgressInfo, UserProfile } from '../types';

/**
 * Sanitize numeric values to non-negative safe integers.
 */
export function sanitizeNonNegativeInt(val: unknown, fallback: number = 0): number {
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

/**
 * Clamp player level strictly into [1 .. 999].
 */
export function clampLevel(level: unknown): number {
  const num = Number(level);
  if (!Number.isFinite(num) || num < LEVEL_SYSTEM_CONFIG.MIN_LEVEL) {
    return LEVEL_SYSTEM_CONFIG.MIN_LEVEL;
  }
  if (num > LEVEL_SYSTEM_CONFIG.MAX_LEVEL) {
    return LEVEL_SYSTEM_CONFIG.MAX_LEVEL;
  }
  return Math.floor(num);
}

/**
 * Return the XP required to advance from `currentLevel` to `currentLevel + 1`.
 * - Level 1 to Level 100: 150 XP per level
 * - Level 101 to Level 998: 300 XP per level
 * - Level 999 (MAX LEVEL): 0 XP (cannot level up past 999)
 */
export function getXpRequiredForNextLevel(currentLevel: number): number {
  const lvl = clampLevel(currentLevel);
  if (lvl >= LEVEL_SYSTEM_CONFIG.MAX_LEVEL) {
    return 0;
  }
  if (lvl <= LEVEL_SYSTEM_CONFIG.TIER_1_MAX_LEVEL) {
    return LEVEL_SYSTEM_CONFIG.TIER_1_XP_PER_LEVEL; // 150 XP
  }
  return LEVEL_SYSTEM_CONFIG.TIER_2_XP_PER_LEVEL; // 300 XP
}

/**
 * Return the exact cumulative XP required to reach the start of `targetLevel` (1 .. 999).
 * - Level 1 start: 0 XP
 * - Level 2 start: 150 XP
 * - Level 100 start: 14,850 XP
 * - Level 101 start: 15,000 XP
 * - Level 999 start: 284,400 XP
 */
export function getCumulativeXpForLevelStart(targetLevel: number): number {
  const lvl = clampLevel(targetLevel);
  if (lvl <= 1) return 0;

  if (lvl <= LEVEL_SYSTEM_CONFIG.TIER_1_MAX_LEVEL + 1) {
    return (lvl - 1) * LEVEL_SYSTEM_CONFIG.TIER_1_XP_PER_LEVEL;
  }

  return (
    LEVEL_SYSTEM_CONFIG.TIER_1_TOTAL_XP_SPAN +
    (lvl - (LEVEL_SYSTEM_CONFIG.TIER_1_MAX_LEVEL + 1)) * LEVEL_SYSTEM_CONFIG.TIER_2_XP_PER_LEVEL
  );
}

/**
 * Deterministically compute Level, carry-over XP, remaining XP to next level,
 * progress percentage, and MAX LEVEL status from cumulative `totalXp`.
 *
 * Supports:
 * - Carry-over of surplus XP into the next level
 * - Jumping multiple levels at once when granted large XP rewards
 * - Hard cap at Level 999 (MAX LEVEL) while continuing to record `totalXp`
 */
export function deriveLevelProgress(totalXpInput: unknown): LevelProgressInfo {
  const totalXp = sanitizeNonNegativeInt(totalXpInput, 0);

  if (totalXp >= LEVEL_SYSTEM_CONFIG.MAX_LEVEL_TOTAL_XP) {
    return {
      level: LEVEL_SYSTEM_CONFIG.MAX_LEVEL,
      totalXp,
      currentLevelXp: totalXp - LEVEL_SYSTEM_CONFIG.MAX_LEVEL_TOTAL_XP,
      xpForNextLevel: 0,
      xpRemainingForNextLevel: 0,
      progressPercent: 100,
      isMaxLevel: true,
    };
  }

  let level: number;
  let currentLevelXp: number;
  let xpForNextLevel: number;

  if (totalXp < LEVEL_SYSTEM_CONFIG.TIER_1_TOTAL_XP_SPAN) {
    // Levels 1 .. 100 (150 XP per level)
    const completedTier1Levels = Math.floor(totalXp / LEVEL_SYSTEM_CONFIG.TIER_1_XP_PER_LEVEL);
    level = 1 + completedTier1Levels; // 1 .. 100
    currentLevelXp = totalXp % LEVEL_SYSTEM_CONFIG.TIER_1_XP_PER_LEVEL;
    xpForNextLevel = LEVEL_SYSTEM_CONFIG.TIER_1_XP_PER_LEVEL;
  } else {
    // Levels 101 .. 998 (300 XP per level)
    const tier2Xp = totalXp - LEVEL_SYSTEM_CONFIG.TIER_1_TOTAL_XP_SPAN;
    const completedTier2Levels = Math.floor(tier2Xp / LEVEL_SYSTEM_CONFIG.TIER_2_XP_PER_LEVEL);
    level = LEVEL_SYSTEM_CONFIG.TIER_1_MAX_LEVEL + 1 + completedTier2Levels; // 101 .. 998
    currentLevelXp = tier2Xp % LEVEL_SYSTEM_CONFIG.TIER_2_XP_PER_LEVEL;
    xpForNextLevel = LEVEL_SYSTEM_CONFIG.TIER_2_XP_PER_LEVEL;
  }

  const xpRemainingForNextLevel = Math.max(0, xpForNextLevel - currentLevelXp);
  const progressPercent = Math.min(100, Math.floor((currentLevelXp / xpForNextLevel) * 100));

  return {
    level,
    totalXp,
    currentLevelXp,
    xpForNextLevel,
    xpRemainingForNextLevel,
    progressPercent,
    isMaxLevel: false,
  };
}

/**
 * Convert legacy `(level, xp)` fields from pre-upgrade accounts into cumulative `totalXp`
 * so existing players never lose their earned levels or in-level XP progress.
 */
export function computeLegacyTotalXp(legacyLevel: unknown, legacyXp: unknown): number {
  const safeLevel = clampLevel(legacyLevel);
  const safeXp = sanitizeNonNegativeInt(legacyXp, 0);
  return getCumulativeXpForLevelStart(safeLevel) + safeXp;
}

/**
 * Normalize any raw Firestore `UserProfile` document (legacy or upgraded) so that:
 * - `totalXp`, `level`, and `xp` are strictly consistent with the Level 1-999 progression curve
 * - `currentPoints` and `points` reflect the spendable balance
 * - `totalPointsEarned` reflects lifetime earned points (never less than initial legacy points)
 */
export function normalizeUserProfile(
  raw: Partial<UserProfile> & Record<string, any>,
  fallbackUid: string = ''
): UserProfile {
  const hasExplicitTotalXp = typeof raw.totalXp === 'number' && Number.isFinite(raw.totalXp) && raw.totalXp >= 0;
  const resolvedTotalXp = hasExplicitTotalXp
    ? sanitizeNonNegativeInt(raw.totalXp, 0)
    : computeLegacyTotalXp(raw.level, raw.xp);

  const progress = deriveLevelProgress(resolvedTotalXp);

  const resolvedCurrentPoints =
    typeof raw.currentPoints === 'number' && Number.isFinite(raw.currentPoints) && raw.currentPoints >= 0
      ? sanitizeNonNegativeInt(raw.currentPoints, 0)
      : sanitizeNonNegativeInt(raw.points, 0);

  const resolvedTotalPointsEarned =
    typeof raw.totalPointsEarned === 'number' &&
    Number.isFinite(raw.totalPointsEarned) &&
    raw.totalPointsEarned >= 0
      ? sanitizeNonNegativeInt(raw.totalPointsEarned, resolvedCurrentPoints)
      : resolvedCurrentPoints;

  const uid = raw.id || fallbackUid;

  return {
    id: uid,
    playerId: raw.playerId || `SG-${uid.slice(0, 6).toUpperCase()}`,
    displayName: raw.displayName || 'ကစားသမား',
    email: raw.email || '',
    photoURL: raw.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${uid || 'player'}`,
    level: progress.level,
    xp: progress.currentLevelXp,
    totalXp: progress.totalXp,
    points: resolvedCurrentPoints,
    currentPoints: resolvedCurrentPoints,
    totalPointsEarned: resolvedTotalPointsEarned,
    totalWins: sanitizeNonNegativeInt(raw.totalWins, 0),
    totalGames: sanitizeNonNegativeInt(raw.totalGames, 0),
    activeFrame: raw.activeFrame || 'frame_gold',
    activeBoardSkin: raw.activeBoardSkin || 'board_classic',
    activeDiceSkin: raw.activeDiceSkin || 'dice_classic',
    activeTokenSkin: raw.activeTokenSkin || 'token_crown',
    inventory: Array.isArray(raw.inventory) ? raw.inventory : ['frame_gold', 'board_classic', 'dice_classic', 'token_crown'],
    claimedAchievements: Array.isArray(raw.claimedAchievements) ? raw.claimedAchievements : [],
    lastClaimId: raw.lastClaimId ?? null,
    lastDailyClaimId: raw.lastDailyClaimId ?? null,
    lastAchievementClaimId: raw.lastAchievementClaimId ?? null,
    activeRoomId: raw.activeRoomId ?? null,
    activeRoomCode: raw.activeRoomCode ?? null,
    activeGameType: raw.activeGameType ?? null,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

/**
 * Pure calculation for applying any XP + Point reward grant to a player's state.
 * Updates BOTH `currentPoints` (spendable) AND `totalPointsEarned` (lifetime leaderboard metric).
 */
export function calculateRewardGrantOutcome(
  currentState: {
    totalXp: number;
    currentPoints: number;
    totalPointsEarned: number;
  },
  grant: {
    xp: number;
    points: number;
  }
) {
  const safeXpGrant = sanitizeNonNegativeInt(grant.xp, 0);
  const safePointsGrant = sanitizeNonNegativeInt(grant.points, 0);

  const beforeProgress = deriveLevelProgress(currentState.totalXp);
  const nextTotalXp = beforeProgress.totalXp + safeXpGrant;
  const afterProgress = deriveLevelProgress(nextTotalXp);

  const nextCurrentPoints = sanitizeNonNegativeInt(currentState.currentPoints, 0) + safePointsGrant;
  const nextTotalPointsEarned =
    sanitizeNonNegativeInt(currentState.totalPointsEarned, 0) + safePointsGrant;

  const levelsGained = Math.max(0, afterProgress.level - beforeProgress.level);

  return {
    xpEarned: safeXpGrant,
    pointsEarned: safePointsGrant,
    previousLevel: beforeProgress.level,
    newLevel: afterProgress.level,
    leveledUp: levelsGained > 0,
    levelsGained,
    progress: afterProgress,
    currentPoints: nextCurrentPoints,
    totalPointsEarned: nextTotalPointsEarned,
  };
}

/**
 * Pure calculation for spending points in the Shop.
 * Strictly deducts ONLY from `currentPoints` while keeping `totalPointsEarned` 100% unchanged!
 */
export function calculateShopSpendOutcome(
  currentState: {
    currentPoints: number;
    totalPointsEarned: number;
  },
  itemPrice: number
): {
  canAfford: boolean;
  currentPoints: number;
  totalPointsEarned: number;
} {
  const safePrice = sanitizeNonNegativeInt(itemPrice, 0);
  const currentBalance = sanitizeNonNegativeInt(currentState.currentPoints, 0);
  const lifetimeEarned = sanitizeNonNegativeInt(currentState.totalPointsEarned, currentBalance);

  if (currentBalance < safePrice) {
    return {
      canAfford: false,
      currentPoints: currentBalance,
      totalPointsEarned: lifetimeEarned,
    };
  }

  return {
    canAfford: true,
    currentPoints: currentBalance - safePrice,
    totalPointsEarned: lifetimeEarned, // NEVER decreases when spending in Shop!
  };
}

/**
 * Sort players strictly for the Level Leaderboard:
 * 1. Highest `level` first
 * 2. Tie-breaker: Highest `totalXp` first
 * 3. Secondary tie-breaker: Highest `totalWins`, then `playerId`
 */
export function sortLevelLeaderboard(players: UserProfile[]): UserProfile[] {
  return [...players]
    .map((p) => normalizeUserProfile(p, p.id))
    .sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      const bTotalXp = b.totalXp ?? 0;
      const aTotalXp = a.totalXp ?? 0;
      if (bTotalXp !== aTotalXp) return bTotalXp - aTotalXp;
      if ((b.totalWins || 0) !== (a.totalWins || 0)) return (b.totalWins || 0) - (a.totalWins || 0);
      return (a.playerId || '').localeCompare(b.playerId || '');
    });
}

/**
 * Sort players strictly for the Point Leaderboard:
 * 1. Highest `totalPointsEarned` first (unaffected by Shop purchases)
 * 2. Tie-breaker: Highest `totalWins`, then `totalXp`, then `playerId`
 */
export function sortPointLeaderboard(players: UserProfile[]): UserProfile[] {
  return [...players]
    .map((p) => normalizeUserProfile(p, p.id))
    .sort((a, b) => {
      const bTotalPts = b.totalPointsEarned ?? b.points ?? 0;
      const aTotalPts = a.totalPointsEarned ?? a.points ?? 0;
      if (bTotalPts !== aTotalPts) return bTotalPts - aTotalPts;
      if ((b.totalWins || 0) !== (a.totalWins || 0)) return (b.totalWins || 0) - (a.totalWins || 0);
      if ((b.totalXp ?? 0) !== (a.totalXp ?? 0)) return (b.totalXp ?? 0) - (a.totalXp ?? 0);
      return (a.playerId || '').localeCompare(b.playerId || '');
    });
}
