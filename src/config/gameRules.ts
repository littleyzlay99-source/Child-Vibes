import { ShopItem, Achievement } from '../types';

/**
 * Game Configuration System
 * အမှတ်ပေးစနစ် (Point System) နှင့် Level Requirement များကို
 * နောက်ပိုင်းတွင် လွယ်ကူစွာ ပြင်ဆင်နိုင်ရန် စုစည်းထားသော Configuration ဖြစ်ပါသည်။
 */
export const GAME_CONFIG = {
  // Point Rewards (အမှတ်ဆုကြေးများ)
  INITIAL_WELCOME_POINTS: 500, // ပထမဆုံးအကောင့်ဖွင့်သူအတွက် ကြိုဆိုဆု
  INITIAL_WELCOME_XP: 100,

  WIN_REWARD_POINTS: 150,      // Game အနိုင်ရသူ ရရှိမည့် အမှတ်
  WIN_REWARD_XP: 250,          // Game အနိုင်ရသူ ရရှိမည့် XP

  PARTICIPATION_POINTS: 30,    // အနိုင်မရသော်လည်း ပါဝင်ကစားသူ ရရှိမည့် အမှတ်
  PARTICIPATION_XP: 50,        // ပါဝင်ကစားသူ ရရှိမည့် XP

  DAILY_REWARD_POINTS: 100,    // နေ့စဉ် Login ဆုကြေး အမှတ်
  DAILY_REWARD_XP: 80,

  // Level Progression Formula: XP needed for next level = BASE_XP * (level ^ LEVEL_EXPONENT)
  BASE_XP_PER_LEVEL: 300,
  LEVEL_EXPONENT: 1.25,

  // Helper function to calculate required XP for a given level
  getXpForLevel(level: number): number {
    return Math.floor(this.BASE_XP_PER_LEVEL * Math.pow(level, this.LEVEL_EXPONENT));
  },

  // Token Colors for players in room
  PLAYER_COLORS: [
    { name: 'နီလာရောင် (Red)', hex: '#EF4444', ring: 'ring-rose-500', bg: 'bg-rose-500' },
    { name: 'မြရောင် (Green)', hex: '#10B981', ring: 'ring-emerald-500', bg: 'bg-emerald-500' },
    { name: 'ပန်းနုရောင် (Blue)', hex: '#3B82F6', ring: 'ring-blue-500', bg: 'bg-blue-500' },
    { name: 'ရွှေရောင် (Amber)', hex: '#F59E0B', ring: 'ring-amber-500', bg: 'bg-amber-500' },
  ],

  // Snakes & Ladders Board mapping
  // Ladders: bottom tile -> top tile
  LADDERS: {
    4: 14,
    9: 31,
    20: 38,
    28: 84,
    40: 59,
    51: 67,
    63: 81,
    71: 91,
  } as Record<number, number>,

  // Snakes: head tile -> tail tile
  SNAKES: {
    17: 7,
    54: 34,
    62: 19,
    64: 60,
    87: 24,
    92: 73,
    95: 56,
    98: 78,
  } as Record<number, number>,
};

/**
 * Shop Catalog (ဆိုင်ရှိ ပစ္စည်းများ)
 */
export const SHOP_CATALOG: ShopItem[] = [
  // Profile Frames
  {
    id: 'frame_gold',
    name: 'ရွှေရောင် ရတနာဘောင်',
    category: 'frame',
    description: 'တောက်ပသော ရွှေရောင် အနားကွပ် ပရိုဖိုင်ဘောင်',
    price: 300,
    previewBorder: 'border-4 border-amber-400 ring-2 ring-yellow-300 shadow-[0_0_15px_rgba(251,191,36,0.6)]',
    gradient: 'from-amber-400 to-yellow-600',
  },
  {
    id: 'frame_neon',
    name: 'နီယွန်ဆိုက်ဘာဘောင်',
    category: 'frame',
    description: 'လျှပ်စစ်ပြာရောင် နီယွန်အလင်းတန်းဘောင်',
    price: 450,
    previewBorder: 'border-4 border-cyan-400 ring-2 ring-blue-400 shadow-[0_0_15px_rgba(34,211,238,0.7)]',
    gradient: 'from-cyan-400 to-blue-600',
  },
  {
    id: 'frame_ruby',
    name: 'ပတ္တမြားတော်ဝင်ဘောင်',
    category: 'frame',
    description: 'နီမြန်းကြည်လင်သော တော်ဝင်ပတ္တမြားဘောင်',
    price: 600,
    previewBorder: 'border-4 border-rose-500 ring-2 ring-pink-400 shadow-[0_0_15px_rgba(244,63,94,0.7)]',
    gradient: 'from-rose-500 to-red-700',
  },
  {
    id: 'frame_emerald',
    name: 'မြစိမ်းနန်းတွင်းဘောင်',
    category: 'frame',
    description: 'အေးချမ်းတင့်တယ်သော မြစိမ်းရတနာဘောင်',
    price: 500,
    previewBorder: 'border-4 border-emerald-400 ring-2 ring-teal-300 shadow-[0_0_15px_rgba(16,185,129,0.7)]',
    gradient: 'from-emerald-400 to-teal-700',
  },

  // Game Board Themes
  {
    id: 'board_classic',
    name: 'ရိုးရာ စာရွက်ပုံစံဘုတ်',
    category: 'board',
    description: 'ငယ်ဘဝက စာရွက်ပေါ်တွင် ကစားခဲ့သည့် ခံစားချက်ကိုပေးသော စတိုင်',
    price: 0, // default free
    previewClass: 'bg-amber-50 border-amber-300',
  },
  {
    id: 'board_neon',
    name: 'နီယွန်ညဥ့်နက်ဘုတ်',
    category: 'board',
    description: 'ခေတ်မီဆန်းပြားသော နီယွန်ဆိုက်ဘာ ဂိမ်းဘုတ်စတိုင်',
    price: 400,
    previewClass: 'bg-slate-900 border-indigo-500',
  },
  {
    id: 'board_royal',
    name: 'ရွှေရောင်တော်ဝင်နန်းတော်ဘုတ်',
    category: 'board',
    description: 'ရွှေရောင်နှင့် နက်ပြာရောင် အထူးတော်ဝင်ဂိမ်းဘုတ်',
    price: 700,
    previewClass: 'bg-gradient-to-br from-indigo-950 via-slate-900 to-amber-950 border-amber-400',
  },

  // Dice Skins
  {
    id: 'dice_classic',
    name: 'ရိုးရိုး အံစာတုံး',
    category: 'dice',
    description: 'ရိုးရှင်းသပ်ရပ်သော အဖြူရောင် အံစာတုံး',
    price: 0,
    previewClass: 'bg-white text-slate-900',
  },
  {
    id: 'dice_gold',
    name: 'ရွှေအံစာတုံး',
    category: 'dice',
    description: 'ကံကောင်းခြင်းဆောင်ကြဉ်းပေးမည့် ရွှေရောင်အံစာတုံး',
    price: 350,
    previewClass: 'bg-gradient-to-tr from-yellow-500 to-amber-300 text-amber-950 font-black shadow-lg shadow-amber-500/40',
  },
  {
    id: 'dice_ruby',
    name: 'မီးတောက် ပတ္တမြားအံစာတုံး',
    category: 'dice',
    description: 'စွမ်းအားပြည့်ဝသော မီးတောက်နီလာ အံစာတုံး',
    price: 500,
    previewClass: 'bg-gradient-to-tr from-rose-600 to-red-400 text-white font-black shadow-lg shadow-rose-600/50',
  },

  // Player Token Skins
  {
    id: 'token_crown',
    name: 'တော်ဝင်သရဖူအရုပ်',
    category: 'token',
    description: 'ခေါင်းဆောင်ကောင်းများအတွက် တော်ဝင်သရဖူ Game Token',
    price: 400,
    iconName: 'Crown',
  },
  {
    id: 'token_star',
    name: 'ကြယ်ပွင့်စစ်သည်အရုပ်',
    category: 'token',
    description: 'တောက်ပသောအလင်းဆောင်သော ကြယ်ပွင့် Game Token',
    price: 300,
    iconName: 'Star',
  },
  {
    id: 'token_gem',
    name: 'နတ်ဘုံစိန်ပွင့်အရုပ်',
    category: 'token',
    description: 'အဖိုးတန်ရတနာ စိန်ပွင့်ပုံစံ Game Token',
    price: 600,
    iconName: 'Gem',
  },
];

/**
 * Achievements List (အောင်မြင်မှုများ)
 */
export const ACHIEVEMENTS_LIST: Achievement[] = [
  {
    id: 'first_win',
    title: 'ပထမဆုံး အောင်ပွဲ',
    description: 'မည်သည့် မီနီဂိမ်းတွင်မဆို ပထမဆုံးအကြိမ် အနိုင်ရရှိခြင်း',
    icon: 'Trophy',
    targetCount: 1,
    rewardPoints: 100,
    rewardXp: 150,
  },
  {
    id: 'win_5',
    title: 'ဂိမ်းကျွမ်းကျင်သူ',
    description: 'စုစုပေါင်း ပွဲ ၅ ပွဲ အနိုင်ရရှိခြင်း',
    icon: 'Award',
    targetCount: 5,
    rewardPoints: 300,
    rewardXp: 400,
  },
  {
    id: 'games_10',
    title: 'ဂိမ်းဝါသနာအိုး',
    description: 'စုစုပေါင်း ဂိမ်း ၁၀ ပွဲ ပါဝင်ကစားပြီးခြင်း',
    icon: 'Gamepad2',
    targetCount: 10,
    rewardPoints: 200,
    rewardXp: 300,
  },
  {
    id: 'reach_lvl_5',
    title: 'အဆင့် ၅ သို့ တက်လှမ်းခြင်း',
    description: 'ကစားသမား Level 5 သို့ ရောက်ရှိခြင်း',
    icon: 'Flame',
    targetCount: 5,
    rewardPoints: 500,
    rewardXp: 500,
  },
];
