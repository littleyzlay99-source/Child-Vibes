/**
 * Snow Rush: Avalanche Escape — Step 4.4 Local 2D Playable Prototype Types
 * Covers Deterministic Obstacles, Collision States, Avalanche Chase, Snow Tumble Recovery,
 * Battle Items / Power-ups, Manual Item Control, Projectiles, Traps, Ice Shield,
 * Mercy Invulnerability, and Offline Demo Bots.
 * Strictly local — never writes to Firestore or RoomPlayer.position.
 */

export type RacePhase = 'ready' | 'countdown' | 'racing' | 'finished';

export type SnowRushObstacleKind =
  | 'pine_tree'
  | 'rock'
  | 'snow_mound'
  | 'ice_patch'
  | 'jump_ramp'
  | 'slalom_gate';

export type SnowRushItemId =
  | 'nitro_boost'
  | 'snowball_attack'
  | 'snow_trap'
  | 'ice_shield';

export interface SnowRushItemMetadata {
  id: SnowRushItemId;
  name: string;
  nameMm: string;
  icon: string;
  accentHex: string;
}

export type JumpOrigin = 'manual' | 'ramp';

export type AvalancheWarningLevel = 'safe' | 'caution' | 'danger' | 'tumble';

export type RacerActiveStatus =
  | 'normal'
  | 'tumble'
  | 'invulnerable'
  | 'mercy_invuln'
  | 'nitro_boost'
  | 'ice_shield'
  | 'spin'
  | 'slowed'
  | 'ice_slip'
  | 'ramp_boost';

export interface SlalomBarrierSpan {
  minLane: number;
  maxLane: number;
}

export interface SnowRushObstacle {
  id: string;
  rowIndex: number;
  kind: SnowRushObstacleKind;
  distanceM: number;
  halfLengthM: number;
  laneOffset: number; // -1.0 to +1.0 (0 for slalom_gate, which uses blockedSpans)
  halfWidthLane: number;
  jumpable: boolean;
  clearanceHeightPx: number;
  /** Populated for `slalom_gate` to specify barrier segments and clear gate corridor */
  blockedSpans?: readonly SlalomBarrierSpan[];
  openCenterLane?: number;
  openHalfWidthLane?: number;
  /** Open lane centers on this obstacle row (always >= 2 lanes) */
  openLaneCenters: readonly number[];
}

export interface SnowRushItemBox {
  id: string;
  rowIndex: number;
  distanceM: number;
  laneOffset: number;
  halfLengthM: number;
  halfWidthLane: number;
  pickedUpByRacerId: string | null;
}

export interface SnowRushProjectile {
  id: string;
  ownerId: string;
  distanceM: number;
  startDistanceM: number;
  maxRangeM: number;
  laneOffset: number;
  speedMps: number;
  active: boolean;
}

export interface SnowRushTrap {
  id: string;
  ownerId: string;
  distanceM: number;
  laneOffset: number;
  halfLengthM: number;
  halfWidthLane: number;
  remainingSec: number;
  ageSec: number;
  active: boolean;
}

export type SnowRushVisualBurstKind =
  | 'item_pickup'
  | 'snowball_hit'
  | 'snowball_miss'
  | 'trap_hit'
  | 'shield_break';

export interface SnowRushVisualBurst {
  id: string;
  kind: SnowRushVisualBurstKind;
  distanceM: number;
  laneOffset: number;
  elapsedSec: number;
  durationSec: number;
}

export interface SnowRushTrackLayout {
  seed: number;
  obstacles: readonly SnowRushObstacle[];
  itemBoxes: readonly SnowRushItemBox[];
}

export interface SnowRushInputState {
  steerLeft: boolean;
  steerRight: boolean;
  jumpPressed: boolean;
  /** Step 4.4 Manual Held Item Activation (Desktop E/Shift/Enter or Mobile ITEM button) */
  useItemPressed?: boolean;
}

export interface SnowTrailSample {
  distanceM: number;
  laneOffset: number;
  carveAmount: number;
  nitroActive?: boolean;
}

export interface PlayerRacerState {
  id: string;
  displayName: string;
  distanceM: number; // 0 to 1000 meters
  laneOffset: number; // -1.0 (left edge) to +1.0 (right edge)
  lateralVelocity: number;
  speedMps: number;
  topSpeedMps: number;
  carveTilt: number; // -1.0 (left lean) to +1.0 (right lean)
  isJumping: boolean;
  jumpOrigin: JumpOrigin;
  jumpElapsedSec: number;
  jumpDurationSec: number;
  jumpPeakHeightPx: number;
  jumpHeightPx: number;
  jumpCount: number;
  scarfPhase: number;
  finishTimeMs: number | null;
  trail: SnowTrailSample[];
  // Step 4.3 Obstacle & Avalanche Recovery State
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
  rampLaunchCount: number;
  tumbleCount: number;
  interactedObstacleIds: string[];
  // Step 4.4 Battle Items & Anti-Stun-Lock State
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

/**
 * Offline pacing companion explicitly flagged as an Offline Demo Bot
 * so it can never be mistaken for an online multiplayer participant.
 */
export interface OfflineDemoBotState {
  readonly isOfflineDemoBot: true;
  id: string;
  displayNameMm: string;
  shortTag: string;
  jacketColor: string;
  hatColor: string;
  scarfColor: string;
  boardColor: string;
  distanceM: number;
  laneOffset: number;
  lateralVelocity: number;
  speedMps: number;
  carveTilt: number;
  isJumping: boolean;
  jumpOrigin: JumpOrigin;
  jumpElapsedSec: number;
  jumpDurationSec: number;
  jumpPeakHeightPx: number;
  jumpHeightPx: number;
  scarfPhase: number;
  finishTimeMs: number | null;
  baseCruiseMps: number;
  weaveFreqRad: number;
  weavePhaseRad: number;
  weaveCenterOffset: number;
  weaveAmplitude: number;
  // Step 4.3 Bot Obstacle & Avalanche Recovery State
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
  // Step 4.4 Bot Battle Items & Anti-Stun-Lock State
  heldItem: SnowRushItemId | null;
  itemArmingTimerSec: number;
  botItemReadyDelaySec: number;
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

export interface AvalancheState {
  distanceM: number; // Starts at -90m
  speedMps: number; // 0 during grace, 17.5m/s base, capped <= 19.2m/s
  graceRemainingSec: number; // Starts at 4.0s
  isActive: boolean;
  warningLevel: AvalancheWarningLevel;
  gapToPlayerM: number;
}

export type SnowRushStepEvent =
  | { type: 'player_jump'; origin: JumpOrigin }
  | { type: 'player_ramp_boost' }
  | { type: 'player_obstacle_hit'; kind: SnowRushObstacleKind }
  | { type: 'avalanche_warning' }
  | { type: 'player_snow_tumble' }
  | { type: 'player_recovery' }
  | { type: 'item_pickup'; racerId: string; itemId: SnowRushItemId; boxId: string }
  | { type: 'player_item_empty' }
  | { type: 'nitro_activate'; racerId: string }
  | { type: 'snowball_launch'; racerId: string; projectileId: string }
  | { type: 'snowball_hit'; attackerId: string; targetId: string }
  | { type: 'snowball_miss'; ownerId: string }
  | { type: 'trap_place'; racerId: string; trapId: string }
  | { type: 'trap_hit'; ownerId: string; targetId: string }
  | { type: 'shield_activate'; racerId: string }
  | { type: 'shield_break'; racerId: string; reason: 'snowball' | 'trap' | 'obstacle' };

export interface SnowRushPrototypeState {
  phase: RacePhase;
  countdownRemainingSec: number;
  elapsedRaceMs: number;
  track: SnowRushTrackLayout;
  itemBoxes: SnowRushItemBox[];
  projectiles: SnowRushProjectile[];
  traps: SnowRushTrap[];
  visualBursts: SnowRushVisualBurst[];
  nextEntitySerial: number;
  avalanche: AvalancheState;
  player: PlayerRacerState;
  offlineDemoBots: OfflineDemoBotState[];
  showOfflineBots: boolean;
  finishRank: number | null;
  events: SnowRushStepEvent[];
}

export interface BotHudProgressEntry {
  id: string;
  shortTag: string;
  displayNameMm: string;
  progressPercent: number;
  jacketColor: string;
  isTumbling: boolean;
  heldItemIcon: string | null;
  hasShield: boolean;
}

export interface SnowRushHudSnapshot {
  phase: RacePhase;
  countdownStep: number | null; // 3, 2, 1, or 0 ("GO!")
  trackSeed: number;
  distanceM: number;
  distanceKmText: string;
  courseLengthKmText: string;
  progressPercent: number;
  speedKmh: number;
  topSpeedKmh: number;
  jumpCount: number;
  obstacleHitCount: number;
  tumbleCount: number;
  playerStatus: RacerActiveStatus;
  // Step 4.4 Held Item & Active Effect HUD Readouts
  heldItem: SnowRushItemId | null;
  heldItemName: string | null;
  heldItemNameMm: string | null;
  heldItemIcon: string | null;
  itemArmingSec: number;
  isItemReady: boolean;
  nitroRemainingSec: number;
  shieldRemainingSec: number;
  mercyInvulnRemainingSec: number;
  itemsUsedCount: number;
  attacksLandedCount: number;
  shieldBlocksCount: number;
  // Avalanche & Course Progress
  avalancheDistanceM: number;
  avalancheProgressPercent: number;
  avalancheGapM: number;
  avalancheWarning: AvalancheWarningLevel;
  avalancheGraceSec: number;
  elapsedSecText: string;
  finishTimeSecText: string | null;
  finishRank: number | null;
  totalRacers: number;
  showOfflineBots: boolean;
  bots: BotHudProgressEntry[];
}
