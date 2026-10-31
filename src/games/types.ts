import type React from 'react';
import type { GameRegistryEntry, GameStatus, RegisteredGameId } from './registry';
import type {
  GameRoom,
  LevelProgressInfo,
  MatchRewardResult,
  RoomPlayer,
} from '../types';

export type { GameRegistryEntry, GameStatus, RegisteredGameId };

/**
 * Optional per-player position version record used by board-based mini-games
 * to synchronize optimistic moves with RoomView's monotonic snapshot tracker.
 */
export interface AuthoritativePlayerStateSync {
  uid: string;
  position: number;
  positionVersion: number;
  lastMoveId: string | null;
  updatedAtMs: number;
}

/**
 * Payload committed from an active Game Module back to the Shared Room Controller
 * immediately after an authoritative move transaction succeeds.
 */
export interface RoomStateCommitPayload {
  stateVersion: number;
  playerSync?: AuthoritativePlayerStateSync;
  applyRoomPatch: (prevRoom: GameRoom) => GameRoom;
}

/**
 * Equipped cosmetic item IDs passed from the player's profile into active Game Modules.
 */
export interface GameModulePlayerCosmetics {
  activeBoardSkin: string;
  activeDiceSkin: string;
  activeTokenSkin: string;
  activeFrame: string;
}

/**
 * Standardized props contract between the Platform Shared Room Controller (RoomView)
 * and any registered Mini-Game Gameplay Component.
 */
export interface GameModuleGameplayProps {
  room: GameRoom;
  currentUserId: string | null;
  currentUserDisplayName: string | null;
  currentPlayer: RoomPlayer | undefined;
  isHost: boolean;
  isOnline: boolean;
  reconnectCountdown: number;
  cosmetics: GameModulePlayerCosmetics;
  rewardOutcome: MatchRewardResult | null;
  fallbackProgress: LevelProgressInfo;
  isClaimingReward: boolean;
  isExiting: boolean;
  onCommitRoomState: (payload: RoomStateCommitPayload) => void;
  onTurnTimeout: () => Promise<void>;
  onPlayAgain: () => Promise<void>;
  onRequestExit: () => void;
  onLeaveAfterFinish: () => Promise<void>;
}

/**
 * Pluggable Mini-Game Module contract registered in the Game Module Resolver.
 * Metadata (title, status, min/maxPlayers, icon) remains owned by Central Game Registry.
 */
export interface GameModuleDefinition {
  readonly id: RegisteredGameId;
  readonly GameplayComponent: React.ComponentType<GameModuleGameplayProps>;
  readonly instructionsMm: string;
  readonly getRuleSummaryMm?: (
    room: Pick<GameRoom, 'exactFinish' | 'maxPlayers'>
  ) => string | null;
}

export type GameModuleUnresolvedReason =
  | 'coming_soon'
  | 'unknown_game'
  | 'module_missing';

/**
 * Discriminated union returned by `resolveGameModule(gameType)`.
 * Guarantees callers explicitly handle unavailable / coming_soon / invalid game types
 * without ever silently falling back to Snakes & Ladders.
 */
export type GameModuleResolution =
  | {
      readonly kind: 'resolved';
      readonly gameType: RegisteredGameId;
      readonly registryEntry: GameRegistryEntry;
      readonly module: GameModuleDefinition;
    }
  | {
      readonly kind: 'unresolved';
      readonly reason: GameModuleUnresolvedReason;
      readonly requestedGameType: string;
      readonly registryEntry?: GameRegistryEntry;
    };
