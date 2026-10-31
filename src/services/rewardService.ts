import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { REWARD_CONFIG } from '../config/rewardConfig';
import { ACHIEVEMENTS_LIST, SHOP_CATALOG } from '../config/gameRules';
import {
  calculateRewardGrantOutcome,
  calculateShopSpendOutcome,
  deriveLevelProgress,
  normalizeUserProfile,
  sortLevelLeaderboard,
  sortPointLeaderboard,
} from './progressionService';
import { GameRoom, MatchRewardResult, UserProfile } from '../types';

const MATCH_CLAIM_STORAGE_PREFIX = 'child_vibes_match_claim_v1_';
const LEADERBOARD_CACHE_TTL_MS = 15_000; // 15s cache to protect Firebase Spark Free Tier reads

// Coalesce concurrent reward claim requests from the same client/tab
const inFlightMatchClaims = new Map<string, Promise<MatchRewardResult>>();

interface LeaderboardCacheEntry {
  fetchedAt: number;
  data: UserProfile[];
}

const leaderboardCache: {
  level: LeaderboardCacheEntry | null;
  points: LeaderboardCacheEntry | null;
} = {
  level: null,
  points: null,
};

export function invalidateLeaderboardCache(): void {
  leaderboardCache.level = null;
  leaderboardCache.points = null;
}

/**
 * Build a deterministic, URL/ID-safe reward claim receipt ID for a specific match round and player.
 * Format: `${roomId}_r${gameRound}_${uid}`
 */
export function buildMatchClaimId(roomId: string, gameRound: unknown, uid: string): string {
  const safeRound = Math.max(1, Math.floor(Number(gameRound) || 1));
  return `${roomId}_r${safeRound}_${uid}`;
}

function readCachedMatchRewardResult(claimId: string): MatchRewardResult | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(`${MATCH_CLAIM_STORAGE_PREFIX}${claimId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MatchRewardResult;
    if (parsed && typeof parsed.pointsEarned === 'number' && typeof parsed.xpEarned === 'number') {
      return { ...parsed, alreadyClaimed: true };
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

function writeCachedMatchRewardResult(claimId: string, result: MatchRewardResult): void {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(
      `${MATCH_CLAIM_STORAGE_PREFIX}${claimId}`,
      JSON.stringify(result)
    );
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Claim Match Completion Reward Atomically & Idempotently.
 *
 * Security & Reliability Guarantees:
 * 1. Verifies authoritative `/rooms/{roomId}` on server (`status === 'finished'`, valid `winnerId`, participant membership).
 * 2. Determines Win (`+100 XP`, `+1,000 Points`) vs Non-Win (`+75 XP`, `+500 Points`) strictly from `REWARD_CONFIG` & server `winnerId`.
 * 3. Writes immutable `/reward_claims/{claimId}` in the same transaction as `/users/{uid}` so rewards can NEVER be granted twice on refresh, reconnect, or duplicate calls.
 * 4. Updates `totalXp`, `level` (up to 999), `xp`, `currentPoints` (`points`), and `totalPointsEarned` together.
 */
export async function claimMatchReward(
  roomId: string,
  gameRound: number | undefined,
  uid: string
): Promise<MatchRewardResult> {
  const safeRound = Math.max(1, Math.floor(Number(gameRound) || 1));
  const claimId = buildMatchClaimId(roomId, safeRound, uid);

  // Fast-path session cache if already verified in this browser session
  const cached = readCachedMatchRewardResult(claimId);
  if (cached) {
    return cached;
  }

  const existingInFlight = inFlightMatchClaims.get(claimId);
  if (existingInFlight) {
    return existingInFlight;
  }

  const claimPromise = (async (): Promise<MatchRewardResult> => {
    const roomRef = doc(db, 'rooms', roomId);
    const claimRef = doc(db, 'reward_claims', claimId);
    const userRef = doc(db, 'users', uid);
    const txRef = doc(db, 'transactions', `tx_${claimId}`);

    try {
      const outcome = await runTransaction(db, async (transaction) => {
        const txNow = Date.now();
        const isoNow = new Date(txNow).toISOString();

        const [roomSnap, claimSnap, userSnap] = await Promise.all([
          transaction.get(roomRef),
          transaction.get(claimRef),
          transaction.get(userRef),
        ]);

        if (!userSnap.exists()) {
          throw new Error('ကစားသမား ပရိုဖိုင် မတွေ့ရှိပါ။');
        }

        const normalizedUser = normalizeUserProfile(userSnap.data() as UserProfile, uid);

        // IDEMPOTENCY GUARD: If already claimed on server (e.g. after refresh/reconnect across tabs),
        // perform ZERO writes and return the exact recorded reward + current level progression!
        if (claimSnap.exists()) {
          const claimData = claimSnap.data() as {
            xpGranted?: number;
            pointsGranted?: number;
          };
          const currentProg = deriveLevelProgress(normalizedUser.totalXp ?? 0);
          return {
            pointsEarned: Number(claimData.pointsGranted ?? 0),
            xpEarned: Number(claimData.xpGranted ?? 0),
            previousLevel: currentProg.level,
            newLevel: currentProg.level,
            leveledUp: false,
            levelsGained: 0,
            totalXp: currentProg.totalXp,
            currentLevelXp: currentProg.currentLevelXp,
            xpForNextLevel: currentProg.xpForNextLevel,
            xpRemainingForNextLevel: currentProg.xpRemainingForNextLevel,
            progressPercent: currentProg.progressPercent,
            isMaxLevel: currentProg.isMaxLevel,
            currentPoints: normalizedUser.currentPoints ?? normalizedUser.points,
            totalPointsEarned: normalizedUser.totalPointsEarned ?? normalizedUser.points,
            alreadyClaimed: true,
          } satisfies MatchRewardResult;
        }

        if (!roomSnap.exists()) {
          throw new Error('ဂိမ်းအခန်း အချက်အလက် မတွေ့ရှိပါ။');
        }

        const serverRoom = roomSnap.data() as GameRoom;
        const serverRound = Math.max(1, Math.floor(Number(serverRoom.gameRound) || 1));

        if (serverRoom.gameType !== 'snakes_and_ladders') {
          throw new Error('ဤဂိမ်းအမျိုးအစားတွင် ပွဲပြီး XP / Points ဆုကြေးစနစ် မပါဝင်သေးပါ။');
        }

        if (serverRoom.status !== 'finished' || !serverRoom.winnerId) {
          throw new Error('ဂိမ်းပွဲ မပြီးဆုံးသေးပါ။');
        }

        if (serverRound !== safeRound) {
          throw new Error('ဂိမ်းပွဲ အချီနံပါတ် မကိုက်ညီပါ။');
        }

        const isParticipant =
          (Array.isArray(serverRoom.matchParticipantIds) &&
            serverRoom.matchParticipantIds.includes(uid)) ||
          (Array.isArray(serverRoom.players) &&
            serverRoom.players.some((p) => p.uid === uid)) ||
          Boolean(serverRoom.playerPositions && serverRoom.playerPositions[uid]) ||
          serverRoom.winnerId === uid;

        if (!isParticipant) {
          throw new Error('ဤဂိမ်းပွဲတွင် သင်ပါဝင်ခဲ့ခြင်း မရှိပါ။');
        }

        const isWinner = serverRoom.winnerId === uid;
        const rewardDef = isWinner ? REWARD_CONFIG.MATCH_WIN : REWARD_CONFIG.MATCH_LOSS;

        const calc = calculateRewardGrantOutcome(
          {
            totalXp: normalizedUser.totalXp ?? 0,
            currentPoints: normalizedUser.currentPoints ?? normalizedUser.points,
            totalPointsEarned: normalizedUser.totalPointsEarned ?? normalizedUser.points,
          },
          {
            xp: rewardDef.xp,
            points: rewardDef.points,
          }
        );

        // 1. Create immutable server-validated reward claim receipt
        transaction.set(claimRef, {
          id: claimId,
          userId: uid,
          roomId,
          gameRound: safeRound,
          outcome: isWinner ? 'win' : 'loss',
          xpGranted: rewardDef.xp,
          pointsGranted: rewardDef.points,
          createdAt: isoNow,
          serverCreatedAt: serverTimestamp(),
        });

        // 2. Update player profile progression & separated point balances
        transaction.update(userRef, {
          totalXp: calc.progress.totalXp,
          level: calc.progress.level,
          xp: calc.progress.currentLevelXp,
          points: calc.currentPoints,
          currentPoints: calc.currentPoints,
          totalPointsEarned: calc.totalPointsEarned,
          totalGames: normalizedUser.totalGames + 1,
          totalWins: normalizedUser.totalWins + (isWinner ? 1 : 0),
          lastClaimId: claimId,
          updatedAt: isoNow,
        });

        // 3. Record point & XP ledger entry
        transaction.set(txRef, {
          id: `tx_${claimId}`,
          userId: uid,
          type: isWinner ? 'win_reward' : 'play_reward',
          amount: rewardDef.points,
          xpAmount: rewardDef.xp,
          description: isWinner
            ? `${rewardDef.descriptionMm} (+${rewardDef.xp} XP)`
            : `${rewardDef.descriptionMm} (+${rewardDef.xp} XP)`,
          createdAt: isoNow,
        });

        return {
          pointsEarned: calc.pointsEarned,
          xpEarned: calc.xpEarned,
          previousLevel: calc.previousLevel,
          newLevel: calc.newLevel,
          leveledUp: calc.leveledUp,
          levelsGained: calc.levelsGained,
          totalXp: calc.progress.totalXp,
          currentLevelXp: calc.progress.currentLevelXp,
          xpForNextLevel: calc.progress.xpForNextLevel,
          xpRemainingForNextLevel: calc.progress.xpRemainingForNextLevel,
          progressPercent: calc.progress.progressPercent,
          isMaxLevel: calc.progress.isMaxLevel,
          currentPoints: calc.currentPoints,
          totalPointsEarned: calc.totalPointsEarned,
          alreadyClaimed: false,
        } satisfies MatchRewardResult;
      });

      writeCachedMatchRewardResult(claimId, outcome);
      invalidateLeaderboardCache();
      return outcome;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `reward_claims/${claimId}`);
      throw error;
    }
  })();

  inFlightMatchClaims.set(claimId, claimPromise);
  try {
    return await claimPromise;
  } finally {
    inFlightMatchClaims.delete(claimId);
  }
}

/**
 * Claim Daily Login Reward Atomically & Idempotently (Once per UTC day bucket).
 */
export async function claimDailyLoginRewardTransaction(
  uid: string
): Promise<{ success: boolean; points: number; xp: number; message: string }> {
  const dayBucket = Math.floor(Date.now() / 86_400_000);
  const dailyClaimId = `${uid}_d${dayBucket}`;
  const dailyRef = doc(db, 'daily_claims', dailyClaimId);
  const userRef = doc(db, 'users', uid);
  const txRef = doc(db, 'transactions', `tx_${dailyClaimId}`);
  const rewardDef = REWARD_CONFIG.DAILY_REWARD;

  try {
    const result = await runTransaction(db, async (transaction) => {
      const txNow = Date.now();
      const isoNow = new Date(txNow).toISOString();

      const [dailySnap, userSnap] = await Promise.all([
        transaction.get(dailyRef),
        transaction.get(userRef),
      ]);

      if (!userSnap.exists()) {
        return {
          success: false,
          points: 0,
          xp: 0,
          message: 'ကျေးဇူးပြု၍ အကောင့်ဝင်ရောက်ပေးပါ။',
        };
      }

      if (dailySnap.exists()) {
        return {
          success: false,
          points: 0,
          xp: 0,
          message:
            'ယနေ့အတွက် နေ့စဉ်ဆုလက်ဆောင် ထုတ်ယူပြီးဖြစ်ပါသည်။ မနက်ဖြန်တွင် ပြန်လာခဲ့ပါ။',
        };
      }

      const normalizedUser = normalizeUserProfile(userSnap.data() as UserProfile, uid);
      const calc = calculateRewardGrantOutcome(
        {
          totalXp: normalizedUser.totalXp ?? 0,
          currentPoints: normalizedUser.currentPoints ?? normalizedUser.points,
          totalPointsEarned: normalizedUser.totalPointsEarned ?? normalizedUser.points,
        },
        {
          xp: rewardDef.xp,
          points: rewardDef.points,
        }
      );

      transaction.set(dailyRef, {
        id: dailyClaimId,
        userId: uid,
        dayBucket,
        xpGranted: rewardDef.xp,
        pointsGranted: rewardDef.points,
        createdAt: isoNow,
        serverCreatedAt: serverTimestamp(),
      });

      transaction.update(userRef, {
        totalXp: calc.progress.totalXp,
        level: calc.progress.level,
        xp: calc.progress.currentLevelXp,
        points: calc.currentPoints,
        currentPoints: calc.currentPoints,
        totalPointsEarned: calc.totalPointsEarned,
        lastDailyClaimId: dailyClaimId,
        updatedAt: isoNow,
      });

      transaction.set(txRef, {
        id: `tx_${dailyClaimId}`,
        userId: uid,
        type: 'daily_reward',
        amount: rewardDef.points,
        xpAmount: rewardDef.xp,
        description: `${rewardDef.descriptionMm} (+${rewardDef.xp} XP)`,
        createdAt: isoNow,
      });

      return {
        success: true,
        points: rewardDef.points,
        xp: rewardDef.xp,
        message: `ယနေ့အတွက် နေ့စဉ်ဆုလက်ဆောင် +${rewardDef.points} ဒင်္ဂါး နှင့် +${rewardDef.xp} XP ရရှိပါသည်!`,
      };
    });

    if (result.success) {
      invalidateLeaderboardCache();
    }
    return result;
  } catch (error) {
    console.error('Daily reward error:', error);
    return {
      success: false,
      points: 0,
      xp: 0,
      message: 'ယနေ့အတွက် နေ့စဉ်ဆုလက်ဆောင် ထုတ်ယူပြီးဖြစ်ပါသည် သို့မဟုတ် ခေတ္တပြန်ကြိုးစားပါ။',
    };
  }
}

/**
 * Claim Unlocked Achievement Reward Atomically & Idempotently (Extensible XP + Points Reward Flow).
 */
export async function claimAchievementRewardTransaction(
  uid: string,
  achievementId: string
): Promise<{ success: boolean; points: number; xp: number; message: string }> {
  const achDef = REWARD_CONFIG.ACHIEVEMENTS[achievementId];
  const achMeta = ACHIEVEMENTS_LIST.find((a) => a.id === achievementId);

  if (!achDef || !achMeta) {
    return { success: false, points: 0, xp: 0, message: 'အောင်မြင်မှုဆု အချက်အလက် မမှန်ကန်ပါ။' };
  }

  const achClaimId = `${uid}_ach_${achievementId}`;
  const achRef = doc(db, 'achievement_claims', achClaimId);
  const userRef = doc(db, 'users', uid);
  const txRef = doc(db, 'transactions', `tx_${achClaimId}`);

  try {
    const result = await runTransaction(db, async (transaction) => {
      const txNow = Date.now();
      const isoNow = new Date(txNow).toISOString();

      const [achSnap, userSnap] = await Promise.all([
        transaction.get(achRef),
        transaction.get(userRef),
      ]);

      if (!userSnap.exists()) {
        return { success: false, points: 0, xp: 0, message: 'ပရိုဖိုင် မတွေ့ရှိပါ။' };
      }

      const normalizedUser = normalizeUserProfile(userSnap.data() as UserProfile, uid);
      const alreadyClaimed =
        achSnap.exists() || (normalizedUser.claimedAchievements || []).includes(achievementId);

      if (alreadyClaimed) {
        return {
          success: false,
          points: 0,
          xp: 0,
          message: 'ဤအောင်မြင်မှုဆုကို ထုတ်ယူပြီးဖြစ်ပါသည်။',
        };
      }

      // Verify unlock condition on server state
      let isUnlocked = false;
      if (achievementId === 'first_win') isUnlocked = normalizedUser.totalWins >= 1;
      else if (achievementId === 'win_5') isUnlocked = normalizedUser.totalWins >= 5;
      else if (achievementId === 'games_10') isUnlocked = normalizedUser.totalGames >= 10;
      else if (achievementId === 'reach_lvl_5') isUnlocked = normalizedUser.level >= 5;

      if (!isUnlocked) {
        return {
          success: false,
          points: 0,
          xp: 0,
          message: 'ဤအောင်မြင်မှု သတ်မှတ်ချက် မပြည့်မီသေးပါ။',
        };
      }

      const calc = calculateRewardGrantOutcome(
        {
          totalXp: normalizedUser.totalXp ?? 0,
          currentPoints: normalizedUser.currentPoints ?? normalizedUser.points,
          totalPointsEarned: normalizedUser.totalPointsEarned ?? normalizedUser.points,
        },
        {
          xp: achDef.xp,
          points: achDef.points,
        }
      );

      const nextClaimed = [...(normalizedUser.claimedAchievements || []), achievementId];

      transaction.set(achRef, {
        id: achClaimId,
        userId: uid,
        achievementId,
        xpGranted: achDef.xp,
        pointsGranted: achDef.points,
        createdAt: isoNow,
        serverCreatedAt: serverTimestamp(),
      });

      transaction.update(userRef, {
        totalXp: calc.progress.totalXp,
        level: calc.progress.level,
        xp: calc.progress.currentLevelXp,
        points: calc.currentPoints,
        currentPoints: calc.currentPoints,
        totalPointsEarned: calc.totalPointsEarned,
        claimedAchievements: nextClaimed,
        lastAchievementClaimId: achClaimId,
        updatedAt: isoNow,
      });

      transaction.set(txRef, {
        id: `tx_${achClaimId}`,
        userId: uid,
        type: 'achievement_reward',
        amount: achDef.points,
        xpAmount: achDef.xp,
        description: `${achDef.descriptionMm} (+${achDef.xp} XP)`,
        createdAt: isoNow,
      });

      return {
        success: true,
        points: achDef.points,
        xp: achDef.xp,
        message: `"${achMeta.title}" ဆုကြေး +${achDef.points} ဒင်္ဂါး နှင့် +${achDef.xp} XP ရရှိပါသည်!`,
      };
    });

    if (result.success) {
      invalidateLeaderboardCache();
    }
    return result;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `achievement_claims/${achClaimId}`);
    return { success: false, points: 0, xp: 0, message: 'ဆုထုတ်ယူမှု မအောင်မြင်ပါ။' };
  }
}

/**
 * Purchase a Shop Item Atomically.
 * Deducts ONLY from spendable `currentPoints` (`points`).
 * `totalPointsEarned` (Point Leaderboard metric), `totalXp`, and `level` NEVER decrease!
 */
export async function purchaseShopItemTransaction(
  uid: string,
  itemId: string
): Promise<{ success: boolean; message: string }> {
  const catalogItem = SHOP_CATALOG.find((i) => i.id === itemId);
  if (!catalogItem) {
    return { success: false, message: 'ဤပစ္စည်းကို ဆိုင်တွင် မတွေ့ရှိပါ။' };
  }

  const userRef = doc(db, 'users', uid);

  try {
    return await runTransaction(db, async (transaction) => {
      const txNow = Date.now();
      const isoNow = new Date(txNow).toISOString();
      const userSnap = await transaction.get(userRef);

      if (!userSnap.exists()) {
        return { success: false, message: 'ကျေးဇူးပြု၍ အကောင့်ဝင်ရောက်ပေးပါ။' };
      }

      const normalizedUser = normalizeUserProfile(userSnap.data() as UserProfile, uid);
      if (normalizedUser.inventory.includes(catalogItem.id)) {
        return { success: false, message: 'ဤပစ္စည်းကို ပိုင်ဆိုင်ပြီးဖြစ်ပါသည်။' };
      }

      const spendOutcome = calculateShopSpendOutcome(
        {
          currentPoints: normalizedUser.currentPoints ?? normalizedUser.points,
          totalPointsEarned: normalizedUser.totalPointsEarned ?? normalizedUser.points,
        },
        catalogItem.price
      );

      if (!spendOutcome.canAfford) {
        return {
          success: false,
          message: 'လက်ကျန် ရွှေဒင်္ဂါး မလုံလောက်ပါ။ ဂိမ်းကစားပြီး အမှတ်ရှာနိုင်ပါသည်။',
        };
      }

      const updatedInventory = [...normalizedUser.inventory, catalogItem.id];
      const shopTxId = `tx_shop_${uid}_${catalogItem.id}_${txNow}`;
      const txRef = doc(db, 'transactions', shopTxId);

      // Update ONLY spendable balance & inventory; totalPointsEarned, totalXp & level stay untouched!
      transaction.update(userRef, {
        points: spendOutcome.currentPoints,
        currentPoints: spendOutcome.currentPoints,
        totalPointsEarned: spendOutcome.totalPointsEarned,
        totalXp: normalizedUser.totalXp ?? 0,
        level: normalizedUser.level,
        xp: normalizedUser.xp,
        inventory: updatedInventory,
        updatedAt: isoNow,
      });

      transaction.set(txRef, {
        id: shopTxId,
        userId: uid,
        type: 'shop_purchase',
        amount: -catalogItem.price,
        description: `ဆိုင်မှ "${catalogItem.name}" ကို ဝယ်ယူခဲ့သည်`,
        createdAt: isoNow,
      });

      return {
        success: true,
        message: `"${catalogItem.name}" ကို အောင်မြင်စွာ ဝယ်ယူပြီးပါပြီ!`,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    return { success: false, message: 'ဝယ်ယူမှု မအောင်မြင်ပါ။ ပြန်လည်ကြိုးစားကြည့်ပါ။' };
  }
}

/**
 * Fetch Level Leaderboard (Spark Free Plan Frugal: Single-field index + 15s cache).
 * Ranked strictly by:
 * 1. Highest `level` first
 * 2. Highest `totalXp` first (tie-breaker)
 */
export async function fetchLevelLeaderboard(
  maxEntries: number = 50,
  forceRefresh: boolean = false
): Promise<UserProfile[]> {
  const now = Date.now();
  if (
    !forceRefresh &&
    leaderboardCache.level &&
    now - leaderboardCache.level.fetchedAt < LEADERBOARD_CACHE_TTL_MS
  ) {
    return leaderboardCache.level.data.slice(0, maxEntries);
  }

  try {
    const usersCol = collection(db, 'users');
    const q = query(usersCol, orderBy('level', 'desc'), limit(Math.max(maxEntries, 50)));
    const snap = await getDocs(q);

    const byId = new Map<string, UserProfile>();
    snap.forEach((docSnap) => {
      const normalized = normalizeUserProfile(docSnap.data() as UserProfile, docSnap.id);
      byId.set(normalized.id, normalized);
    });

    const sorted = sortLevelLeaderboard(Array.from(byId.values()));
    leaderboardCache.level = {
      fetchedAt: now,
      data: sorted,
    };
    return sorted.slice(0, maxEntries);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
    return [];
  }
}

/**
 * Fetch Point Leaderboard (Spark Free Plan Frugal: Single-field indexes + 15s cache).
 * Ranked strictly by highest `totalPointsEarned` (unaffected by Shop purchases).
 * Also merges top legacy `points` docs so pre-upgrade accounts appear seamlessly without reset.
 */
export async function fetchPointLeaderboard(
  maxEntries: number = 50,
  forceRefresh: boolean = false
): Promise<UserProfile[]> {
  const now = Date.now();
  if (
    !forceRefresh &&
    leaderboardCache.points &&
    now - leaderboardCache.points.fetchedAt < LEADERBOARD_CACHE_TTL_MS
  ) {
    return leaderboardCache.points.data.slice(0, maxEntries);
  }

  try {
    const usersCol = collection(db, 'users');
    const fetchLimit = Math.max(maxEntries, 50);

    const [earnedSnap, legacyPointsSnap] = await Promise.all([
      getDocs(query(usersCol, orderBy('totalPointsEarned', 'desc'), limit(fetchLimit))),
      getDocs(query(usersCol, orderBy('points', 'desc'), limit(fetchLimit))),
    ]);

    const byId = new Map<string, UserProfile>();
    earnedSnap.forEach((docSnap) => {
      const normalized = normalizeUserProfile(docSnap.data() as UserProfile, docSnap.id);
      byId.set(normalized.id, normalized);
    });
    legacyPointsSnap.forEach((docSnap) => {
      if (!byId.has(docSnap.id)) {
        const normalized = normalizeUserProfile(docSnap.data() as UserProfile, docSnap.id);
        byId.set(normalized.id, normalized);
      }
    });

    const sorted = sortPointLeaderboard(Array.from(byId.values()));
    leaderboardCache.points = {
      fetchedAt: now,
      data: sorted,
    };
    return sorted.slice(0, maxEntries);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
    return [];
  }
}
