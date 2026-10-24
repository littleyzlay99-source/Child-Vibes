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
