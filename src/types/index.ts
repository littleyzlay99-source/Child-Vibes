export interface UserProfile {
  id: string; // Auth UID
  playerId: string; // Unique player ID e.g. "SG-729481"
  displayName: string;
  email: string;
  photoURL: string;
  level: number;
  xp: number;
  points: number;
  totalWins: number;
  totalGames: number;
  activeFrame: string;
  activeBoardSkin: string;
  activeDiceSkin: string;
  activeTokenSkin: string;
  inventory: string[]; // List of owned item IDs
  createdAt: string;
  updatedAt: string;
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

export interface RoomPlayer {
  uid: string;
  playerId: string;
  displayName: string;
  photoURL: string;
  isReady: boolean;
  color: string;
  position: number; // 1 to 100
  rank?: number;
  activeTokenSkin?: string;
}

export interface GameRoom {
  id: string;
  roomCode: string;
  gameType: string;
  hostId: string;
  hostName: string;
  status: 'waiting' | 'playing' | 'finished';
  maxPlayers: number;
  players: RoomPlayer[];
  currentTurnIndex: number;
  lastDiceRoll: number;
  lastMoveSummary: string;
  winnerId: string | null;
  winnerName: string | null;
  exactFinish: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PointTransaction {
  id: string;
  userId: string;
  type: 'welcome_bonus' | 'win_reward' | 'play_reward' | 'shop_purchase' | 'daily_reward';
  amount: number;
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
