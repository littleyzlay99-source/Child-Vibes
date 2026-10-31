import type {
  AvalancheState,
  JumpOrigin,
  RacerActiveStatus,
  SnowRushInputState,
  SnowRushItemBox,
  SnowRushItemId,
  SnowRushObstacleKind,
  SnowRushProjectile,
  SnowRushTrackLayout,
  SnowRushTrap,
} from '../types';

export type { SnowRushInputState };

/**
 * Snow Rush: Avalanche Escape — Step 4.6 Shared Multi-Racer Simulation Types
 *
 * 100% Pure TypeScript Runtime-Agnostic Contracts:
 * - Zero Browser / DOM / Canvas / Web Audio / React / Firebase dependencies.
 * - Directly portable across Cloudflare Durable Objects, Node.js, and Browser prediction.
 */

export type MultiplayerRacePhase =
  | 'ready'
  | 'countdown'
  | 'racing'
  | 'finish_window'
  | 'finished';

export type SnowRushSteerAxis = -1 | 0 | 1;

/**
 * Sanitized client input frame sent to the authoritative simulation.
 * Contains ONLY player intent (`steer`, `jumpPressed`, `useItemPressed`, `seq`).
 * Untrusted client claims (`distanceM`, `speedMps`, `laneOffset`, `winnerId`, etc.)
 * are never accepted by the engine.
 */
export interface SnowRushInputFrame {
  readonly steer: SnowRushSteerAxis;
  readonly jumpPressed: boolean;
  readonly useItemPressed: boolean;
  readonly seq: number;
}

export type MultiplayerInputPayload = SnowRushInputFrame | SnowRushInputState;

export interface MultiplayerPlayerInit {
  readonly uid: string;
  readonly displayName: string;
  readonly color?: string;
}

export interface StartingGridSlot {
  readonly uid: string;
  readonly displayName: string;
  readonly color: string;
  readonly slotIndex: number;
  readonly laneOffset: number;
}

/**
 * Authoritative per-UID racer state maintained on the server / simulation core.
 * Excludes visual particles, canvas trail arrays, and audio objects.
 */
export interface AuthoritativeRacerState {
  id: string;
  uid: string;
  displayName: string;
  color: string;
  slotIndex: number;
  isConnected: boolean;
  lastSteerAxis: SnowRushSteerAxis;
  lastProcessedInputSeq: number;
  distanceM: number;
  laneOffset: number;
  lateralVelocity: number;
  speedMps: number;
  topSpeedMps: number;
  carveTilt: number;
  isJumping: boolean;
  jumpOrigin: JumpOrigin;
  jumpElapsedSec: number;
  jumpDurationSec: number;
  jumpPeakHeightPx: number;
  jumpHeightPx: number;
  jumpCount: number;
  rampLaunchCount: number;
  scarfPhase: number;
  finishTimeMs: number | null;
  finishRank: number | null;
  activeStatus: RacerActiveStatus;
  // Obstacle & Avalanche Recovery State
  penaltyTimerSec: number;
  penaltySpeedMult: number;
  penaltyKind: SnowRushObstacleKind | null;
  spinTimerSec: number;
  iceSlipTimerSec: number;
  iceBoostTimerSec: number;
  iceDriftDir: number;
  landingBoostTimerSec: number;
  tumbleTimerSec: number;
  invulnerableTimerSec: number;
  recoveryRampTimerSec: number;
  recoveryElapsedSec: number;
  obstacleHitCount: number;
  tumbleCount: number;
  interactedObstacleIds: string[];
  // Battle Items & Anti-Stun-Lock State
  heldItem: SnowRushItemId | null;
  itemArmingTimerSec: number;
  nitroTimerSec: number;
  shieldTimerSec: number;
  shieldBreakAnimTimerSec: number;
  attackSlowTimerSec: number;
  attackSpeedMult: number;
  mercyInvulnTimerSec: number;
  itemsPickedUpCount: number;
  itemsUsedCount: number;
  shieldBlocksCount: number;
  attacksLandedCount: number;
  attacksTakenCount: number;
}

export interface RaceStanding {
  readonly uid: string;
  readonly displayName: string;
  readonly color: string;
  readonly slotIndex: number;
  readonly rank: number;
  readonly finished: boolean;
  readonly finishTimeMs: number | null;
  readonly distanceM: number;
  readonly speedMps: number;
  readonly topSpeedMps: number;
  readonly obstacleHitCount: number;
  readonly tumbleCount: number;
  readonly itemsPickedUpCount: number;
  readonly itemsUsedCount: number;
  readonly shieldBlocksCount: number;
  readonly attacksLandedCount: number;
  readonly attacksTakenCount: number;
}

export type RaceFinishReason = 'all_finished' | 'post_winner_timeout';

export interface RaceFinishState {
  readonly winnerId: string | null;
  readonly winnerFinishTimeMs: number | null;
  readonly postWinnerWindowDurationSec: number;
  readonly postWinnerRemainingSec: number | null;
  readonly finalized: boolean;
  readonly finishReason: RaceFinishReason | null;
  readonly finalizedAtElapsedMs: number | null;
  readonly standings: readonly RaceStanding[];
}

export type MultiplayerRaceEvent =
  | { type: 'countdown_started'; trackSeed: number }
  | { type: 'race_started'; serverTick: number }
  | { type: 'duplicate_input_ignored'; uid: string; seq: number; lastAckSeq: number }
  | { type: 'racer_jump'; uid: string; origin: JumpOrigin }
  | { type: 'racer_ramp_boost'; uid: string }
  | { type: 'racer_obstacle_hit'; uid: string; kind: SnowRushObstacleKind }
  | { type: 'avalanche_warning'; uid: string }
  | { type: 'racer_snow_tumble'; uid: string }
  | { type: 'racer_recovery'; uid: string; distanceM: number; laneOffset: number }
  | { type: 'item_pickup'; uid: string; itemId: SnowRushItemId; boxId: string }
  | { type: 'item_empty'; uid: string }
  | { type: 'nitro_activate'; uid: string }
  | { type: 'snowball_launch'; uid: string; projectileId: string }
  | { type: 'snowball_hit'; attackerId: string; targetId: string }
  | { type: 'snowball_miss'; ownerId: string }
  | { type: 'trap_place'; uid: string; trapId: string }
  | { type: 'trap_hit'; ownerId: string; targetId: string }
  | { type: 'shield_activate'; uid: string }
  | { type: 'shield_break'; uid: string; reason: 'snowball' | 'trap' | 'obstacle' }
  | { type: 'racer_finished'; uid: string; finishTimeMs: number; rank: number }
  | { type: 'finish_window_started'; winnerId: string; durationSec: number }
  | {
      type: 'race_finalized';
      winnerId: string | null;
      reason: RaceFinishReason;
      standings: readonly RaceStanding[];
    };

export interface MultiplayerRaceState {
  serverTick: number;
  phase: MultiplayerRacePhase;
  countdownRemainingSec: number;
  elapsedRaceMs: number;
  trackSeed: number;
  track: SnowRushTrackLayout;
  racers: Record<string, AuthoritativeRacerState>;
  racerOrder: readonly string[];
  itemBoxes: SnowRushItemBox[];
  projectiles: SnowRushProjectile[];
  traps: SnowRushTrap[];
  avalanche: AvalancheState;
  nextEntitySerial: number;
  ackSeqByUid: Record<string, number>;
  finishState: RaceFinishState;
  events: MultiplayerRaceEvent[];
}

export interface MultiplayerItemBoxStatus {
  readonly id: string;
  readonly rowIndex: number;
  readonly distanceM: number;
  readonly laneOffset: number;
  readonly pickedUpByRacerId: string | null;
}

/**
 * Compact authoritative racer snapshot sent over the network.
 * Contains zero visual particles, zero canvas trails, and zero audio state,
 * while preserving every authoritative physics field required for lossless restore.
 */
export type MultiplayerRacerSnapshot = Readonly<AuthoritativeRacerState>;

/**
 * Compact authoritative server snapshot for client reconciliation & reconnect restore.
 * Excludes static track geometry (reconstructed deterministically via `trackSeed`),
 * visual particles, canvas trails, and audio objects.
 */
export interface SnowRushSnapshot {
  readonly serverTick: number;
  readonly elapsedRaceMs: number;
  readonly trackSeed: number;
  readonly racePhase: MultiplayerRacePhase;
  readonly countdownRemainingSec: number;
  readonly racers: Readonly<Record<string, MultiplayerRacerSnapshot>>;
  readonly racerOrder: readonly string[];
  readonly avalanche: Readonly<AvalancheState>;
  readonly activeProjectiles: readonly Readonly<SnowRushProjectile>[];
  readonly activeTraps: readonly Readonly<SnowRushTrap>[];
  readonly itemBoxStatuses: readonly MultiplayerItemBoxStatus[];
  readonly raceStandings: readonly RaceStanding[];
  readonly finishState: Readonly<RaceFinishState>;
  readonly ackSeqByUid: Readonly<Record<string, number>>;
  readonly nextEntitySerial: number;
}
