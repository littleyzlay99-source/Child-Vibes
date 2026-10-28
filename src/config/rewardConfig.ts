import { RewardDefinition, RewardSourceType } from '../types';

/**
 * Centralized Level & XP Curve Configuration
 * - Level 1 to Level 100: 150 XP per level up (100 transitions: Lv 1 -> Lv 101 = 15,000 XP)
 * - Level 101 to Level 999: 300 XP per level up (898 transitions: Lv 101 -> Lv 999 = 269,400 XP)
 * - Maximum Level: 999 (Cumulative 284,400 XP; Total XP continues accumulating beyond Level 999)
 */
export const LEVEL_SYSTEM_CONFIG = {
  MIN_LEVEL: 1,
  MAX_LEVEL: 999,
  TIER_1_MAX_LEVEL: 100,
  TIER_1_XP_PER_LEVEL: 150,
  TIER_2_XP_PER_LEVEL: 300,
  // 100 transitions (Lv 1 -> Lv 101) * 150 XP = 15,000 XP
  TIER_1_TOTAL_XP_SPAN: 100 * 150,
  // 15,000 XP + 898 transitions (Lv 101 -> Lv 999) * 300 XP = 284,400 XP
  MAX_LEVEL_TOTAL_XP: 100 * 150 + (999 - 101) * 300,
} as const;

/**
 * Single Source of Truth for All Platform Rewards (XP & Points).
 * Modify values here to adjust rewards across the entire platform without touching UI/service logic.
 * Extensible for Daily Rewards, Achievement Rewards, Mission Rewards, Special Events, and Bonuses.
 */
export const REWARD_CONFIG = {
  // Match Outcome Rewards
  MATCH_WIN: {
    id: 'match_win',
    source: 'match_win' as RewardSourceType,
    xp: 100,
    points: 1000,
    descriptionMm: 'ဂိမ်းပွဲ အနိုင်ရရှိမှုဆု',
  },
  MATCH_LOSS: {
    id: 'match_loss',
    source: 'match_loss' as RewardSourceType,
    xp: 75,
    points: 500,
    descriptionMm: 'ဂိမ်းပွဲ ပါဝင်ယှဉ်ပြိုင်မှုဆု',
  },

  // Account & Daily Login Rewards
  WELCOME_BONUS: {
    id: 'welcome_bonus',
    source: 'bonus' as RewardSourceType,
    xp: 0,
    points: 500,
    descriptionMm: 'ပလက်ဖောင်းသို့ ပထမဆုံးဝင်ရောက်မှုအတွက် ကြိုဆိုဆုလက်ဆောင်',
  },
  DAILY_REWARD: {
    id: 'daily_reward',
    source: 'daily_reward' as RewardSourceType,
    xp: 80,
    points: 100,
    descriptionMm: 'နေ့စဉ် Login ဝင်ရောက်မှုအတွက် ဆုလက်ဆောင်',
  },

  // Achievement Rewards Registry
  ACHIEVEMENTS: {
    first_win: {
      id: 'first_win',
      source: 'achievement' as RewardSourceType,
      xp: 150,
      points: 100,
      descriptionMm: 'အောင်မြင်မှုဆု - ပထမဆုံး အောင်ပွဲ',
    },
    win_5: {
      id: 'win_5',
      source: 'achievement' as RewardSourceType,
      xp: 400,
      points: 300,
      descriptionMm: 'အောင်မြင်မှုဆု - ဂိမ်းကျွမ်းကျင်သူ (၅ ပွဲအနိုင်)',
    },
    games_10: {
      id: 'games_10',
      source: 'achievement' as RewardSourceType,
      xp: 300,
      points: 200,
      descriptionMm: 'အောင်မြင်မှုဆု - ဂိမ်းဝါသနာအိုး (၁၀ ပွဲကစားပြီး)',
    },
    reach_lvl_5: {
      id: 'reach_lvl_5',
      source: 'achievement' as RewardSourceType,
      xp: 500,
      points: 500,
      descriptionMm: 'အောင်မြင်မှုဆု - အဆင့် ၅ သို့ တက်လှမ်းခြင်း',
    },
  } as Record<string, RewardDefinition>,

  // Extensible Mission Rewards Registry (ready for Daily / Weekly Missions)
  MISSIONS: {} as Record<string, RewardDefinition>,

  // Extensible Special Event & Bonus Rewards Registry (ready for Seasonal / Holiday Events)
  SPECIAL_EVENTS: {} as Record<string, RewardDefinition>,
} as const;

/**
 * Resolve any reward definition from the centralized configuration by source and optional ID.
 */
export function resolveRewardDefinition(
  source: RewardSourceType,
  rewardId?: string
): RewardDefinition | null {
  switch (source) {
    case 'match_win':
      return REWARD_CONFIG.MATCH_WIN;
    case 'match_loss':
      return REWARD_CONFIG.MATCH_LOSS;
    case 'daily_reward':
      return REWARD_CONFIG.DAILY_REWARD;
    case 'achievement':
      return rewardId ? REWARD_CONFIG.ACHIEVEMENTS[rewardId] || null : null;
    case 'mission':
      return rewardId ? REWARD_CONFIG.MISSIONS[rewardId] || null : null;
    case 'special_event':
      return rewardId ? REWARD_CONFIG.SPECIAL_EVENTS[rewardId] || null : null;
    case 'bonus':
      if (!rewardId || rewardId === 'welcome_bonus') {
        return REWARD_CONFIG.WELCOME_BONUS;
      }
      return REWARD_CONFIG.SPECIAL_EVENTS[rewardId] || null;
    default:
      return null;
  }
}
