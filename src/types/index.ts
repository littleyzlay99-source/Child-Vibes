export type RewardSourceType =
  | 'match_win'
  | 'match_loss'
  | 'daily_reward'
  | 'achievement'
  | 'mission'
  | 'special_event'
  | 'bonus';

export interface RewardDefinition {
  id: string;
  source: RewardSourceType;
  xp: number;
  points: number;
  descriptionMm: string;
}

export interface LevelProgressInfo {
  level: number; // 1 to 999
  totalXp: number; // Cumulative lifetime XP (continues increasing after Level 999)
  currentLevelXp: number; // XP earned within the current level tier
  xpForNextLevel: number; // 150 for Lv 1-100, 300 for Lv 101-998, 0 at Lv 999
  xpRemainingForNextLevel: number; // Remaining XP needed to reach next level (0 at Lv 999)
  progressPercent: number; // 0 to 100 (100 at Lv 999)
  isMaxLevel: boolean; // true when level >= 999
}

export interface MatchRewardResult {
  pointsEarned: number;
  xpEarned: number;
  previousLevel: number;
  newLevel: number;
  leveledUp: boolean;
  levelsGained: number;
  totalXp: number;
  currentLevelXp: number;
  xpForNextLevel: number;
  xpRemainingForNextLevel: number;
  progressPercent: number;
  isMaxLevel: boolean;
  currentPoints: number;
  totalPointsEarned: number;
  alreadyClaimed: boolean;
}

export interface UserProfile {
  id: string; // Auth UID
  playerId: string; // Unique player ID e.g. "SG-729481"
  displayName: string;
  email: string;
  photoURL: string;
  level: number; // 1 to 999
  xp: number; // Current level XP progress (synced with totalXp)
  totalXp?: number; // Cumulative lifetime XP (authoritative for Level & Level Leaderboard tie-break)
  points: number; // Spendable current point balance (synced with currentPoints)
  currentPoints?: number; // Spendable current point balance (reduced only by Shop purchases)
  totalPointsEarned?: number; // Cumulative lifetime points earned (never reduced by Shop purchases)
  totalWins: number;
  totalGames: number;
  activeFrame: string;
  activeBoardSkin: string;
  activeDiceSkin: string;
  activeTokenSkin: string;
  inventory: string[]; // List of owned item IDs
  claimedAchievements?: string[]; // Claimed achievement IDs
  lastClaimId?: string | null; // Last verified atomic match reward claim ID
  lastDailyClaimId?: string | null; // Last verified atomic daily reward claim ID
  lastAchievementClaimId?: string | null; // Last verified atomic achievement claim ID
  activeRoomId?: string | null; // Active multiplayer room session for recovery
  activeRoomCode?: string | null;
  activeGameType?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveGameSession {
  uid: string;
  roomId: string;
  roomCode: string;
  gameType: string;
  savedAt: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  targetCount: number;
  rewardPoints: number;
  rewardXp: number;
}

export interface ShopItem {
  id: string;
  name: string;
  category: 'frame' | 'board' | 'dice' | 'token' | 'badge';
  description: string;
  price: number;
  previewClass?: string;
  previewBorder?: string;
  iconName?: string;
  gradient?: string;
}

export interface PlayerPresenceEntry {
  isConnected: boolean;
  lastSeen: number;
  disconnectedAt?: number | null;
}

export interface PlayerPositionRecord {
  position: number;
  positionVersion: number;
  lastMoveId: string | null;
  updatedAtMs: number;
}

export interface RoomPlayer {
  uid: string;
  playerId: string;
  displayName: string;
  photoURL: string;
  isReady: boolean;
  color: string;
  position: number; // 1 to 100
  positionVersion?: number; // Monotonically increasing version per move
  lastMoveId?: string | null; // Unique ID of this player's last move
  updatedAtMs?: number; // Monotonic client/tx timestamp of last position update
  rank?: number;
  activeTokenSkin?: string;
  isConnected: boolean; // Internet connection status
  lastSeen: number; // Timestamp in milliseconds
  disconnectedAt?: number | null; // Timestamp when disconnected
}

export type RoomStatus = 'waiting' | 'full' | 'playing' | 'finished';

export interface GameRoom {
  id: string;
  roomCode: string;
  gameType: string;
  hostId: string;
  hostName: string;
  status: RoomStatus;
  maxPlayers: number;
  playerCount?: number; // Synchronized count of unique active players
  players: RoomPlayer[];
  currentTurnIndex: number;
  lastDiceRoll: number;
  lastMoveSummary: string;
  winnerId: string | null;
  winnerName: string | null;
  matchParticipantIds?: string[]; // Snapshot of participating UIDs when match reaches finished
  exactFinish: boolean;
  // Version Control & Atomic Synchronization
  stateVersion?: number; // Monotonically incremented on every authoritative state write
  gameRound?: number; // Incremented on Play Again reset
  lastMoveId?: string | null; // Unique ID for each dice roll move (prevents duplicate animation)
  playerPositions?: Record<string, PlayerPositionRecord>; // Per-player authoritative position map
  presence?: Record<string, PlayerPresenceEntry>; // Isolated presence map (never touches positions)
  // Timer & Realtime Turn Management
  turnStartTimestamp: number; // Timestamp ms when turn began
  turnDeadline: number; // Timestamp ms (turnStartTimestamp + 30000)
  reconnectionDeadline: number | null; // Timestamp ms (now + 60000)
  disconnectedPlayerId: string | null;
  disconnectedPlayerName: string | null;
  lastMoveTimestamp: number; // Timestamp ms of last move action
  lastMovePath?: number[]; // Step-by-step path tiles for smooth animation across clients
  lastMovingPlayerUid?: string | null;
  createdAt: string;
  updatedAt: string;
  serverUpdatedAt?: unknown; // Firestore serverTimestamp()
}

export interface JoinRoomResult {
  roomId: string;
  room: GameRoom;
  alreadyJoined: boolean;
}

export interface PointTransaction {
  id: string;
  userId: string;
  type:
    | 'welcome_bonus'
    | 'win_reward'
    | 'play_reward'
    | 'shop_purchase'
    | 'daily_reward'
    | 'achievement_reward'
    | 'mission_reward'
    | 'event_reward'
    | 'bonus_reward';
  amount: number;
  xpAmount?: number;
  description: string;
  createdAt: string;
}

export interface MiniGameCard {
  id: string;
  title: string;
  category: string;
  description: string;
  icon: string;
  minPlayers: number;
  maxPlayers: number;
  badge: 'available' | 'coming_soon';
  difficulty: 'easy' | 'medium' | 'hard';
}
