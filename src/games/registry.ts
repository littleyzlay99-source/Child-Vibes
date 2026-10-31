/**
 * Central Game Registry — Single Source of Truth for Mini-Game Metadata
 * Step 3.1: Metadata & Lookup Helpers Only (No Gameplay Components, Room Creation, or Game Engines)
 */

export type RegisteredGameId =
  | 'snakes_and_ladders'
  | 'ludo_king'
  | 'burmese_chess'
  | 'word_puzzle'
  | 'space_arcade'
  | 'kart_racing'
  | 'bubble_shooter'
  | 'snow_rush';

export type GameStatus = 'available' | 'coming_soon';

export type GameCategory =
  | 'board'
  | 'puzzle'
  | 'brain'
  | 'arcade'
  | 'racing'
  | 'casual';

export type GameDifficulty = 'easy' | 'medium' | 'hard';

export interface GameRegistryEntry {
  id: RegisteredGameId;
  title: string;
  shortTitle: string;
  description: string;
  category: GameCategory;
  minPlayers: number;
  maxPlayers: number;
  status: GameStatus;
  icon: string;
  difficulty: GameDifficulty;
  sortOrder: number;
}

export const DEFAULT_GAME_ID: RegisteredGameId = 'snakes_and_ladders';
export const UNKNOWN_GAME_FALLBACK_TITLE = 'မီနီဂိမ်း';

const GAME_REGISTRY_ENTRIES: readonly GameRegistryEntry[] = [
  {
    id: 'snakes_and_ladders',
    title: 'မြွေနှင့်လှေကား (Snakes & Ladders)',
    shortTitle: 'မြွေနှင့်လှေကား',
    description:
      'ငယ်ဘဝအမှတ်တရ မြွေနှင့်လှေကားဂိမ်းကို သူငယ်ချင်းများနှင့်အတူ အွန်လိုင်းမှ အံစာတုံးခေါက်ပြီး ယှဉ်ပြိုင်ကစားပါ။',
    category: 'board',
    minPlayers: 2,
    maxPlayers: 4,
    status: 'available',
    icon: '🐍',
    difficulty: 'easy',
    sortOrder: 1,
  },
  {
    id: 'ludo_king',
    title: 'ရွှေလုဒို (Shwe Ludo)',
    shortTitle: 'ရွှေလုဒို',
    description: 'ကစားသမား ၄ ဦး ယှဉ်ပြိုင်နိုင်မည့် ရိုးရာ လုဒိုဘုတ်ဂိမ်း မကြာမီလာမည်။',
    category: 'board',
    minPlayers: 2,
    maxPlayers: 4,
    status: 'coming_soon',
    icon: '🎲',
    difficulty: 'medium',
    sortOrder: 2,
  },
  {
    id: 'burmese_chess',
    title: 'မြန်မာ့စစ်တုရင် (Myanmar Chess)',
    shortTitle: 'မြန်မာ့စစ်တုရင်',
    description: 'ရှေးရိုးစဉ်လာ ဗျူဟာမြောက် မြန်မာ့စစ်တုရင် ယှဉ်ပြိုင်ပွဲ။',
    category: 'brain',
    minPlayers: 2,
    maxPlayers: 2,
    status: 'coming_soon',
    icon: '♟️',
    difficulty: 'hard',
    sortOrder: 3,
  },
  {
    id: 'word_puzzle',
    title: 'မြန်မာစကားထာ ပဟေဠိ (Word Puzzle)',
    shortTitle: 'မြန်မာစကားထာ ပဟေဠိ',
    description: 'စကားလုံးဆက် ဉာဏ်စမ်း ပဟေဠိများနှင့် အမှတ်ရှာဖွေမှု။',
    category: 'puzzle',
    minPlayers: 1,
    maxPlayers: 4,
    status: 'coming_soon',
    icon: '🧩',
    difficulty: 'medium',
    sortOrder: 4,
  },
  {
    id: 'space_arcade',
    title: 'အာကာသစစ်သည် (Space Arcade)',
    shortTitle: 'အာကာသစစ်သည်',
    description: 'လျင်မြန်သော တုံ့ပြန်မှုနှင့် ဂိုးသွင်းရယူမည့် မီနီ အာကိတ်ဂိမ်း။',
    category: 'arcade',
    minPlayers: 1,
    maxPlayers: 2,
    status: 'coming_soon',
    icon: '🚀',
    difficulty: 'medium',
    sortOrder: 5,
  },
  {
    id: 'kart_racing',
    title: 'မီနီ ကားပြိုင်ပွဲ (Mini Kart Racer)',
    shortTitle: 'မီနီ ကားပြိုင်ပွဲ',
    description: 'သူငယ်ချင်းများနှင့် အပြေးပြိုင်မည့် ရွှင်လန်းဖွယ် ကားပြိုင်ပွဲ။',
    category: 'racing',
    minPlayers: 2,
    maxPlayers: 4,
    status: 'coming_soon',
    icon: '🏎️',
    difficulty: 'easy',
    sortOrder: 6,
  },
  {
    id: 'bubble_shooter',
    title: 'ရောင်စုံပူဖောင်းပစ် (Bubble Pop)',
    shortTitle: 'ရောင်စုံပူဖောင်းပစ်',
    description:
      'အရောင်တူ ပူဖောင်း ၃ လုံးနှင့်အထက် ပစ်ပေါက်ပြီး စိတ်အပန်းဖြေနိုင်မည့် ပေါ့ပေါ့ပါးပါး ဂိမ်းငယ်။',
    category: 'casual',
    minPlayers: 1,
    maxPlayers: 2,
    status: 'coming_soon',
    icon: '🫧',
    difficulty: 'easy',
    sortOrder: 7,
  },
  {
    id: 'snow_rush',
    title: 'နှင်းတောင်ဆင်းပြိုင်ပွဲ (Snow Rush: Avalanche Escape)',
    shortTitle: 'နှင်းတောင်ဆင်းပြိုင်ပွဲ',
    description:
      'နှင်းတောင်စောင်းတစ်လျှောက် ၁ ကီလိုမီတာ အမြန်ဆင်းပြိုင်ရမည့် ရင်ခုန်စရာ နှင်းလျှောစီး အပြေးပြိုင်ပွဲ မကြာမီလာမည်။',
    category: 'racing',
    minPlayers: 2,
    maxPlayers: 4,
    status: 'coming_soon',
    icon: '🏂',
    difficulty: 'easy',
    sortOrder: 8,
  },
];

const GAME_REGISTRY_BY_ID: ReadonlyMap<string, GameRegistryEntry> = new Map(
  GAME_REGISTRY_ENTRIES.map((entry) => [entry.id, entry])
);

/**
 * Look up a game metadata entry by its gameType ID.
 * Returns undefined safely for null, undefined, empty, or unknown IDs.
 */
export function getGameById(gameType?: string | null): GameRegistryEntry | undefined {
  if (!gameType || typeof gameType !== 'string') {
    return undefined;
  }
  const normalized = gameType.trim();
  if (!normalized) {
    return undefined;
  }
  return GAME_REGISTRY_BY_ID.get(normalized);
}

/**
 * Return all registered games (both 'available' and 'coming_soon') sorted by sortOrder ascending.
 */
export function getAllGames(): GameRegistryEntry[] {
  return [...GAME_REGISTRY_ENTRIES].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Return only currently playable ('available') games sorted by sortOrder ascending.
 */
export function getAvailableGames(): GameRegistryEntry[] {
  return getAllGames().filter((entry) => entry.status === 'available');
}

/**
 * Resolve display title for a given gameType ID without throwing on missing or unknown values.
 * - Empty / null / undefined gameType falls back to the default game ('snakes_and_ladders') title.
 * - Unknown gameType falls back to 'မီနီဂိမ်း' (preserving existing platform fallback behavior).
 * - Set options.short = false to retrieve the full bilingual card title instead of compact header title.
 */
export function getGameTitle(
  gameType?: string | null,
  options?: { short?: boolean }
): string {
  const useFullTitle = options?.short === false;

  if (!gameType || typeof gameType !== 'string' || !gameType.trim()) {
    const defaultGame = GAME_REGISTRY_BY_ID.get(DEFAULT_GAME_ID);
    if (!defaultGame) {
      return UNKNOWN_GAME_FALLBACK_TITLE;
    }
    return useFullTitle ? defaultGame.title : defaultGame.shortTitle;
  }

  const found = getGameById(gameType);
  if (!found) {
    return UNKNOWN_GAME_FALLBACK_TITLE;
  }

  return useFullTitle ? found.title : found.shortTitle;
}
