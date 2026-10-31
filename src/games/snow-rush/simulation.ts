import {
  AVALANCHE_BASE_SPEED_MPS,
  AVALANCHE_CATCHUP_MAX_GAP_M,
  AVALANCHE_CAUTION_GAP_M,
  AVALANCHE_DANGER_GAP_M,
  AVALANCHE_INITIAL_DISTANCE_M,
  AVALANCHE_MAX_SPEED_MPS,
  AVALANCHE_SAFE_GRACE_SEC,
  BASE_MAX_SPEED_MPS,
  CARVE_SPEED_TRIM_MPS,
  COUNTDOWN_BEAT_SEC,
  COUNTDOWN_DURATION_SEC,
  COURSE_LENGTH_KM_TEXT,
  COURSE_LENGTH_M,
  DOWNHILL_ACCEL_MPS2,
  ICE_PATCH_BOOST_DURATION_SEC,
  ICE_PATCH_FRICTION_MULT,
  ICE_PATCH_SLIP_DURATION_SEC,
  ICE_PATCH_SPEED_MULT,
  ICE_PATCH_STEER_GRIP_MULT,
  JUMP_AIR_SPEED_BONUS_MPS,
  JUMP_DURATION_SEC,
  JUMP_PEAK_HEIGHT_PX,
  LATERAL_ACCEL_PER_SEC2,
  LATERAL_FRICTION_PER_SEC,
  MAX_COLLISION_SUBSTEP_SEC,
  MAX_LATERAL_VELOCITY,
  MAX_SIMULATION_DT_SEC,
  MAX_TRAIL_SAMPLES,
  MIN_RACING_FLOOR_MPS,
  MIN_START_PUSH_MPS,
  NITRO_ACCEL_MPS2,
  NITRO_BOOST_SPEED_MULT,
  NITRO_MAX_SPEED_CAP_MPS,
  OFFLINE_DEMO_BOT_PRESETS,
  PENALTY_DECEL_MPS2,
  PINE_TREE_PENALTY_SEC,
  PINE_TREE_SPEED_MULT,
  POST_TUMBLE_INVULN_SEC,
  RACER_COLLISION_HALF_LANE,
  RACER_COLLISION_HALF_LENGTH_M,
  RAMP_JUMP_DURATION_SEC,
  RAMP_JUMP_PEAK_HEIGHT_PX,
  RAMP_LANDING_BOOST_MULT,
  RAMP_LANDING_BOOST_SEC,
  RECOVERY_INITIAL_SPEED_MPS,
  RECOVERY_SPEED_RAMP_SEC,
  ROCK_SPIN_PENALTY_SEC,
  ROCK_SPEED_MULT,
  SHIELD_BREAK_ANIM_DURATION_SEC,
  SLALOM_BARRIER_PENALTY_SEC,
  SLALOM_BARRIER_SPEED_MULT,
  SNOW_MOUND_PENALTY_SEC,
  SNOW_MOUND_SPEED_MULT,
  SNOW_TUMBLE_DRIFT_SPEED_MPS,
  SNOW_TUMBLE_DURATION_SEC,
  SNOW_TUMBLE_MAX_RECOVERY_M,
  SNOW_TUMBLE_RECOVERY_AHEAD_M,
  TRACK_SAFE_LANE_LIMIT,
  TRAIL_SAMPLE_MIN_DELTA_M,
} from './constants';
import {
  appendVisualBurst,
  cloneTrackItemBoxes,
  computeLiveRacerRank,
  evaluateRacerItemBoxPickup,
  getItemMetadata,
  hashDeterministicRoll,
  shouldOfflineBotUseHeldItem,
  stepProjectilesSubstep,
  stepTrapsSubstep,
  stepVisualBursts,
  tryActivateRacerHeldItem,
} from './items';
import {
  createRandomTrackSeed,
  generateSnowRushTrack,
  normalizeTrackSeed,
} from './track';
import type {
  AvalancheState,
  AvalancheWarningLevel,
  JumpOrigin,
  OfflineDemoBotState,
  PlayerRacerState,
  RacerActiveStatus,
  SnowRushHudSnapshot,
  SnowRushInputState,
  SnowRushItemBox,
  SnowRushItemId,
  SnowRushObstacle,
  SnowRushObstacleKind,
  SnowRushProjectile,
  SnowRushPrototypeState,
  SnowRushStepEvent,
  SnowRushTrackLayout,
  SnowRushTrap,
  SnowRushVisualBurst,
} from './types';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) {
    return Math.min(target, current + maxDelta);
  }
  return Math.max(target, current - maxDelta);
}

export function formatDistanceKm(distanceM: number): string {
  const safeMeters = clamp(Number.isFinite(distanceM) ? distanceM : 0, 0, COURSE_LENGTH_M);
  return (safeMeters / 1000).toFixed(2);
}

export function getCourseProgressPercent(distanceM: number): number {
  const safeMeters = clamp(Number.isFinite(distanceM) ? distanceM : 0, 0, COURSE_LENGTH_M);
  return (safeMeters / COURSE_LENGTH_M) * 100;
}

export function formatSpeedKmh(speedMps: number): number {
  const safeSpeed = Math.max(0, Number.isFinite(speedMps) ? speedMps : 0);
  return Math.round(safeSpeed * 3.6);
}

export function formatRaceTimeSec(durationMs: number): string {
  const safeMs = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
  return (safeMs / 1000).toFixed(2);
}

export function createInitialAvalancheState(): AvalancheState {
  return {
    distanceM: AVALANCHE_INITIAL_DISTANCE_M,
    speedMps: 0,
    graceRemainingSec: AVALANCHE_SAFE_GRACE_SEC,
    isActive: false,
    warningLevel: 'safe',
    gapToPlayerM: Math.abs(AVALANCHE_INITIAL_DISTANCE_M),
  };
}

export function createInitialPlayerState(displayName = 'သင် (You)'): PlayerRacerState {
  return {
    id: 'local_player',
    displayName,
    distanceM: 0,
    laneOffset: 0,
    lateralVelocity: 0,
    speedMps: 0,
    topSpeedMps: 0,
    carveTilt: 0,
    isJumping: false,
    jumpOrigin: 'manual',
    jumpElapsedSec: 0,
    jumpDurationSec: JUMP_DURATION_SEC,
    jumpPeakHeightPx: JUMP_PEAK_HEIGHT_PX,
    jumpHeightPx: 0,
    jumpCount: 0,
    scarfPhase: 0,
    finishTimeMs: null,
    trail: [{ distanceM: 0, laneOffset: 0, carveAmount: 0, nitroActive: false }],
    penaltyTimerSec: 0,
    penaltySpeedMult: 1,
    penaltyKind: null,
    spinTimerSec: 0,
    iceSlipTimerSec: 0,
    iceBoostTimerSec: 0,
    iceDriftDir: 0,
    landingBoostTimerSec: 0,
    tumbleTimerSec: 0,
    invulnerableTimerSec: 0,
    recoveryRampTimerSec: 0,
    recoveryElapsedSec: 0,
    obstacleHitCount: 0,
    rampLaunchCount: 0,
    tumbleCount: 0,
    interactedObstacleIds: [],
    // Step 4.4 Battle Items & Anti-Stun-Lock State
    heldItem: null,
    itemArmingTimerSec: 0,
    nitroTimerSec: 0,
    shieldTimerSec: 0,
    shieldBreakAnimTimerSec: 0,
    attackSlowTimerSec: 0,
    attackSpeedMult: 1,
    mercyInvulnTimerSec: 0,
    itemsPickedUpCount: 0,
    itemsUsedCount: 0,
    shieldBlocksCount: 0,
    attacksLandedCount: 0,
    attacksTakenCount: 0,
  };
}

export function createInitialOfflineDemoBots(): OfflineDemoBotState[] {
  return OFFLINE_DEMO_BOT_PRESETS.map((preset) => ({
    isOfflineDemoBot: true,
    id: preset.id,
    displayNameMm: preset.displayNameMm,
    shortTag: preset.shortTag,
    jacketColor: preset.jacketColor,
    hatColor: preset.hatColor,
    scarfColor: preset.scarfColor,
    boardColor: preset.boardColor,
    distanceM: 0,
    laneOffset: preset.initialLaneOffset,
    lateralVelocity: 0,
    speedMps: 0,
    carveTilt: 0,
    isJumping: false,
    jumpOrigin: 'manual',
    jumpElapsedSec: 0,
    jumpDurationSec: JUMP_DURATION_SEC,
    jumpPeakHeightPx: JUMP_PEAK_HEIGHT_PX,
    jumpHeightPx: 0,
    scarfPhase: preset.weavePhaseRad,
    finishTimeMs: null,
    baseCruiseMps: preset.baseCruiseMps,
    weaveFreqRad: preset.weaveFreqRad,
    weavePhaseRad: preset.weavePhaseRad,
    weaveCenterOffset: preset.weaveCenterOffset,
    weaveAmplitude: preset.weaveAmplitude,
    penaltyTimerSec: 0,
    penaltySpeedMult: 1,
    penaltyKind: null,
    spinTimerSec: 0,
    iceSlipTimerSec: 0,
    iceBoostTimerSec: 0,
    iceDriftDir: 0,
    landingBoostTimerSec: 0,
    tumbleTimerSec: 0,
    invulnerableTimerSec: 0,
    recoveryRampTimerSec: 0,
    recoveryElapsedSec: 0,
    obstacleHitCount: 0,
    tumbleCount: 0,
    interactedObstacleIds: [],
    // Step 4.4 Bot Battle Items & Anti-Stun-Lock State
    heldItem: null,
    itemArmingTimerSec: 0,
    botItemReadyDelaySec: 0,
    nitroTimerSec: 0,
    shieldTimerSec: 0,
    shieldBreakAnimTimerSec: 0,
    attackSlowTimerSec: 0,
    attackSpeedMult: 1,
    mercyInvulnTimerSec: 0,
    itemsPickedUpCount: 0,
    itemsUsedCount: 0,
    shieldBlocksCount: 0,
    attacksLandedCount: 0,
    attacksTakenCount: 0,
  }));
}

export function createInitialSnowRushState(options?: {
  playerName?: string;
  showOfflineBots?: boolean;
  trackSeed?: number;
}): SnowRushPrototypeState {
  const showOfflineBots = options?.showOfflineBots ?? true;
  const seed =
    options?.trackSeed !== undefined
      ? normalizeTrackSeed(options.trackSeed)
      : createRandomTrackSeed();
  const track = generateSnowRushTrack(seed);

  return {
    phase: 'ready',
    countdownRemainingSec: COUNTDOWN_DURATION_SEC,
    elapsedRaceMs: 0,
    track,
    itemBoxes: cloneTrackItemBoxes(track.itemBoxes),
    projectiles: [],
    traps: [],
    visualBursts: [],
    nextEntitySerial: 1,
    avalanche: createInitialAvalancheState(),
    player: createInitialPlayerState(options?.playerName || 'သင် (You)'),
    offlineDemoBots: createInitialOfflineDemoBots(),
    showOfflineBots,
    finishRank: null,
    events: [],
  };
}

export function startCountdownState(
  prev: SnowRushPrototypeState,
  options?: { playerName?: string; showOfflineBots?: boolean; trackSeed?: number }
): SnowRushPrototypeState {
  const showOfflineBots = options?.showOfflineBots ?? prev.showOfflineBots;
  const playerName = options?.playerName ?? prev.player.displayName;
  const seed =
    options?.trackSeed !== undefined
      ? normalizeTrackSeed(options.trackSeed)
      : createRandomTrackSeed();
  const track = generateSnowRushTrack(seed);

  return {
    phase: 'countdown',
    countdownRemainingSec: COUNTDOWN_DURATION_SEC,
    elapsedRaceMs: 0,
    track,
    itemBoxes: cloneTrackItemBoxes(track.itemBoxes),
    projectiles: [],
    traps: [],
    visualBursts: [],
    nextEntitySerial: 1,
    avalanche: createInitialAvalancheState(),
    player: createInitialPlayerState(playerName),
    offlineDemoBots: createInitialOfflineDemoBots(),
    showOfflineBots,
    finishRank: null,
    events: [],
  };
}

function computeParabolicJumpHeight(
  elapsedSec: number,
  durationSec: number,
  peakHeightPx: number
): number {
  const safeDuration = Math.max(0.05, durationSec);
  const t = clamp(elapsedSec / safeDuration, 0, 1);
  return 4 * t * (1 - t) * peakHeightPx;
}

function getRecoverySpeedStageCap(recoveryElapsedSec: number): number {
  if (recoveryElapsedSec < 0.5) {
    return 14.2;
  }
  if (recoveryElapsedSec < 1.0) {
    return 17.6;
  }
  return BASE_MAX_SPEED_MPS;
}

function doesRacerOverlapObstacleLaterally(
  laneOffset: number,
  obs: SnowRushObstacle
): boolean {
  if (obs.kind === 'slalom_gate' && obs.blockedSpans) {
    const racerMin = laneOffset - RACER_COLLISION_HALF_LANE;
    const racerMax = laneOffset + RACER_COLLISION_HALF_LANE;
    return obs.blockedSpans.some(
      (span) => racerMax >= span.minLane && racerMin <= span.maxLane
    );
  }
  return Math.abs(laneOffset - obs.laneOffset) <= obs.halfWidthLane + RACER_COLLISION_HALF_LANE;
}

function doesSegmentOverlapObstacleDistance(
  prevDistM: number,
  nextDistM: number,
  obs: SnowRushObstacle
): boolean {
  const segMin = Math.min(prevDistM, nextDistM) - RACER_COLLISION_HALF_LENGTH_M;
  const segMax = Math.max(prevDistM, nextDistM) + RACER_COLLISION_HALF_LENGTH_M;
  const obsMin = obs.distanceM - obs.halfLengthM;
  const obsMax = obs.distanceM + obs.halfLengthM;
  return segMax >= obsMin && segMin <= obsMax;
}

export function pickNearestSafeLaneAtDistance(
  currentLane: number,
  distanceM: number,
  obstacles: readonly SnowRushObstacle[]
): { laneOffset: number; guardedIds: string[] } {
  let chosenLane = clamp(currentLane, -TRACK_SAFE_LANE_LIMIT, TRACK_SAFE_LANE_LIMIT);
  const guardedIds: string[] = [];

  for (let i = 0; i < obstacles.length; i += 1) {
    const obs = obstacles[i];
    if (obs.distanceM < distanceM - 3.2) continue;
    if (obs.distanceM > distanceM + 3.2) break;

    guardedIds.push(obs.id);
    if (doesRacerOverlapObstacleLaterally(chosenLane, obs) && obs.openLaneCenters.length > 0) {
      let best = obs.openLaneCenters[0];
      let bestDist = Math.abs(chosenLane - best);
      for (let j = 1; j < obs.openLaneCenters.length; j += 1) {
        const d = Math.abs(chosenLane - obs.openLaneCenters[j]);
        if (d < bestDist) {
          bestDist = d;
          best = obs.openLaneCenters[j];
        }
      }
      chosenLane = best;
    }
  }

  return { laneOffset: chosenLane, guardedIds };
}

export interface CoreRacerFields {
  id: string;
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
  // Step 4.4 Fields
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

export interface StepCoreRacerResult {
  fields: CoreRacerFields;
  manualJumped: boolean;
  rampLaunched: boolean;
  rampBoosted: boolean;
  hitObstacles: SnowRushObstacleKind[];
  shieldBlockedObstacle: boolean;
  recoveredFromTumble: boolean;
}

export function stepCoreRacerSubstep(
  racer: CoreRacerFields,
  input: SnowRushInputState,
  baseTargetCruiseMps: number,
  subDtSec: number,
  nextElapsedMs: number,
  avalancheDistanceM: number,
  track: SnowRushTrackLayout
): StepCoreRacerResult {
  // 1. Highest Priority: Finished Racers are completely immutable to hazards, items & avalanche
  if (racer.finishTimeMs !== null || racer.distanceM >= COURSE_LENGTH_M) {
    return {
      fields: {
        ...racer,
        distanceM: COURSE_LENGTH_M,
        lateralVelocity: 0,
        speedMps: approach(racer.speedMps, 0, 26 * subDtSec),
        carveTilt: approach(racer.carveTilt, 0, 5 * subDtSec),
        isJumping: false,
        jumpElapsedSec: 0,
        jumpHeightPx: 0,
        scarfPhase: racer.scarfPhase + subDtSec * 3.6,
        finishTimeMs: racer.finishTimeMs ?? nextElapsedMs,
        penaltyTimerSec: 0,
        penaltySpeedMult: 1,
        penaltyKind: null,
        spinTimerSec: 0,
        iceSlipTimerSec: 0,
        iceBoostTimerSec: 0,
        landingBoostTimerSec: 0,
        tumbleTimerSec: 0,
        invulnerableTimerSec: 0,
        recoveryRampTimerSec: 0,
        itemArmingTimerSec: 0,
        nitroTimerSec: 0,
        shieldTimerSec: 0,
        shieldBreakAnimTimerSec: 0,
        attackSlowTimerSec: 0,
        attackSpeedMult: 1,
        mercyInvulnTimerSec: 0,
      },
      manualJumped: false,
      rampLaunched: false,
      rampBoosted: false,
      hitObstacles: [],
      shieldBlockedObstacle: false,
      recoveredFromTumble: false,
    };
  }

  // 2. Second Priority: Active Snow Tumble / Knockdown (1.3s) — restricts steer, jump & item use
  if (racer.tumbleTimerSec > 0) {
    const nextTumbleTimer = racer.tumbleTimerSec - subDtSec;
    const nextArmingTimer = Math.max(0, racer.itemArmingTimerSec - subDtSec);
    const nextShieldBreakAnim = Math.max(0, racer.shieldBreakAnimTimerSec - subDtSec);
    const dampedLateral = approach(racer.lateralVelocity, 0, 8.5 * subDtSec);
    const driftedLane = clamp(
      racer.laneOffset + dampedLateral * subDtSec,
      -TRACK_SAFE_LANE_LIMIT * 0.85,
      TRACK_SAFE_LANE_LIMIT * 0.85
    );
    const driftedDist = Math.min(
      SNOW_TUMBLE_MAX_RECOVERY_M,
      racer.distanceM + SNOW_TUMBLE_DRIFT_SPEED_MPS * subDtSec
    );

    if (nextTumbleTimer <= 0) {
      // Recovery Complete: place 25m ahead of Avalanche, strictly < COURSE_LENGTH_M (no false finish)
      const targetRecoveryM = clamp(
        Math.max(driftedDist, avalancheDistanceM + SNOW_TUMBLE_RECOVERY_AHEAD_M),
        0,
        SNOW_TUMBLE_MAX_RECOVERY_M
      );
      const safeSpot = pickNearestSafeLaneAtDistance(
        driftedLane,
        targetRecoveryM,
        track.obstacles
      );
      const nextInteracted =
        safeSpot.guardedIds.length > 0
          ? Array.from(new Set([...racer.interactedObstacleIds, ...safeSpot.guardedIds]))
          : racer.interactedObstacleIds;

      return {
        fields: {
          ...racer,
          distanceM: targetRecoveryM,
          laneOffset: safeSpot.laneOffset,
          lateralVelocity: 0,
          speedMps: RECOVERY_INITIAL_SPEED_MPS,
          carveTilt: 0,
          isJumping: false,
          jumpOrigin: 'manual',
          jumpElapsedSec: 0,
          jumpHeightPx: 0,
          scarfPhase: racer.scarfPhase + subDtSec * 6.0,
          penaltyTimerSec: 0,
          penaltySpeedMult: 1,
          penaltyKind: null,
          spinTimerSec: 0,
          iceSlipTimerSec: 0,
          iceBoostTimerSec: 0,
          landingBoostTimerSec: 0,
          tumbleTimerSec: 0,
          invulnerableTimerSec: POST_TUMBLE_INVULN_SEC,
          recoveryRampTimerSec: RECOVERY_SPEED_RAMP_SEC,
          recoveryElapsedSec: 0,
          interactedObstacleIds: nextInteracted,
          itemArmingTimerSec: nextArmingTimer,
          nitroTimerSec: 0,
          shieldTimerSec: 0,
          shieldBreakAnimTimerSec: nextShieldBreakAnim,
          attackSlowTimerSec: 0,
          attackSpeedMult: 1,
          mercyInvulnTimerSec: 0,
        },
        manualJumped: false,
        rampLaunched: false,
        rampBoosted: false,
        hitObstacles: [],
        shieldBlockedObstacle: false,
        recoveredFromTumble: true,
      };
    }

    return {
      fields: {
        ...racer,
        distanceM: driftedDist,
        laneOffset: driftedLane,
        lateralVelocity: dampedLateral,
        speedMps: SNOW_TUMBLE_DRIFT_SPEED_MPS,
        carveTilt: Math.sin(nextTumbleTimer * 12) * 0.65,
        isJumping: false,
        jumpElapsedSec: 0,
        jumpHeightPx: 0,
        scarfPhase: racer.scarfPhase + subDtSec * 9.0,
        tumbleTimerSec: nextTumbleTimer,
        itemArmingTimerSec: nextArmingTimer,
        nitroTimerSec: 0,
        shieldTimerSec: 0,
        shieldBreakAnimTimerSec: nextShieldBreakAnim,
        attackSlowTimerSec: 0,
        attackSpeedMult: 1,
        mercyInvulnTimerSec: 0,
      },
      manualJumped: false,
      rampLaunched: false,
      rampBoosted: false,
      hitObstacles: [],
      shieldBlockedObstacle: false,
      recoveredFromTumble: false,
    };
  }

  // 3. Normal Racing Substep (with Invulnerability, Nitro, Shield, Boosts, Ice Slip, and Penalties)
  const invulnerableTimerSec = Math.max(0, racer.invulnerableTimerSec - subDtSec);
  const itemArmingTimerSec = Math.max(0, racer.itemArmingTimerSec - subDtSec);
  const nitroTimerSec = Math.max(0, racer.nitroTimerSec - subDtSec);
  let shieldTimerSec = Math.max(0, racer.shieldTimerSec - subDtSec);
  let shieldBreakAnimTimerSec = Math.max(0, racer.shieldBreakAnimTimerSec - subDtSec);
  let shieldBlocksCount = racer.shieldBlocksCount;
  const attackSlowTimerSec = Math.max(0, racer.attackSlowTimerSec - subDtSec);
  const attackSpeedMult = attackSlowTimerSec > 0 ? racer.attackSpeedMult : 1;
  const mercyInvulnTimerSec = Math.max(0, racer.mercyInvulnTimerSec - subDtSec);

  let penaltyTimerSec = Math.max(0, racer.penaltyTimerSec - subDtSec);
  let penaltySpeedMult = penaltyTimerSec > 0 ? racer.penaltySpeedMult : 1;
  let penaltyKind = penaltyTimerSec > 0 ? racer.penaltyKind : null;
  let spinTimerSec = Math.max(0, racer.spinTimerSec - subDtSec);
  let iceSlipTimerSec = Math.max(0, racer.iceSlipTimerSec - subDtSec);
  let iceBoostTimerSec = Math.max(0, racer.iceBoostTimerSec - subDtSec);
  let iceDriftDir = iceSlipTimerSec > 0 ? racer.iceDriftDir : 0;
  let landingBoostTimerSec = Math.max(0, racer.landingBoostTimerSec - subDtSec);
  const recoveryRampTimerSec =
    nitroTimerSec > 0 ? 0 : Math.max(0, racer.recoveryRampTimerSec - subDtSec);
  const recoveryElapsedSec =
    recoveryRampTimerSec > 0 ? racer.recoveryElapsedSec + subDtSec : 0;

  // Steering (Ice Patch reduces grip & friction for 1.2s without disabling player input)
  const steerAxis = (input.steerRight ? 1 : 0) - (input.steerLeft ? 1 : 0);
  const gripMult = iceSlipTimerSec > 0 && nitroTimerSec <= 0 ? ICE_PATCH_STEER_GRIP_MULT : 1.0;
  const frictionMult =
    iceSlipTimerSec > 0 && nitroTimerSec <= 0 ? ICE_PATCH_FRICTION_MULT : 1.0;

  let lateralVelocity = racer.lateralVelocity;
  if (iceSlipTimerSec > 0 && iceDriftDir !== 0 && nitroTimerSec <= 0) {
    lateralVelocity = clamp(
      lateralVelocity + iceDriftDir * 0.55 * subDtSec,
      -MAX_LATERAL_VELOCITY,
      MAX_LATERAL_VELOCITY
    );
  }

  if (steerAxis !== 0) {
    lateralVelocity = clamp(
      lateralVelocity + steerAxis * LATERAL_ACCEL_PER_SEC2 * gripMult * subDtSec,
      -MAX_LATERAL_VELOCITY,
      MAX_LATERAL_VELOCITY
    );
  } else {
    lateralVelocity = approach(
      lateralVelocity,
      0,
      LATERAL_FRICTION_PER_SEC * frictionMult * subDtSec
    );
  }

  let laneOffset = racer.laneOffset + lateralVelocity * subDtSec;
  if (laneOffset < -TRACK_SAFE_LANE_LIMIT) {
    laneOffset = -TRACK_SAFE_LANE_LIMIT;
    if (lateralVelocity < 0) lateralVelocity *= 0.2;
  } else if (laneOffset > TRACK_SAFE_LANE_LIMIT) {
    laneOffset = TRACK_SAFE_LANE_LIMIT;
    if (lateralVelocity > 0) lateralVelocity *= 0.2;
  }

  const targetTilt = clamp(
    steerAxis !== 0 ? steerAxis * 0.92 : lateralVelocity * 0.45,
    -1,
    1
  );
  const carveTilt = approach(racer.carveTilt, targetTilt, subDtSec * 7.5);

  // Jump & Ramp Landing
  let isJumping = racer.isJumping;
  let jumpOrigin: JumpOrigin = racer.jumpOrigin;
  let jumpElapsedSec = racer.jumpElapsedSec;
  let jumpDurationSec = racer.jumpDurationSec;
  let jumpPeakHeightPx = racer.jumpPeakHeightPx;
  let jumpHeightPx = racer.jumpHeightPx;
  let manualJumped = false;
  let rampLaunched = false;
  let rampBoosted = false;

  if (input.jumpPressed && !isJumping) {
    isJumping = true;
    jumpOrigin = 'manual';
    jumpElapsedSec = 0;
    jumpDurationSec = JUMP_DURATION_SEC;
    jumpPeakHeightPx = JUMP_PEAK_HEIGHT_PX;
    manualJumped = true;
  }

  let speedMps = racer.speedMps;

  if (isJumping) {
    jumpElapsedSec += subDtSec;
    if (jumpElapsedSec >= jumpDurationSec) {
      if (jumpOrigin === 'ramp') {
        landingBoostTimerSec = RAMP_LANDING_BOOST_SEC;
        speedMps = Math.min(
          NITRO_MAX_SPEED_CAP_MPS,
          Math.max(speedMps, baseTargetCruiseMps * RAMP_LANDING_BOOST_MULT * 0.98)
        );
        rampBoosted = true;
      }
      isJumping = false;
      jumpOrigin = 'manual';
      jumpElapsedSec = 0;
      jumpDurationSec = JUMP_DURATION_SEC;
      jumpPeakHeightPx = JUMP_PEAK_HEIGHT_PX;
      jumpHeightPx = 0;
    } else {
      jumpHeightPx = computeParabolicJumpHeight(
        jumpElapsedSec,
        jumpDurationSec,
        jumpPeakHeightPx
      );
    }
  }

  // Forward Speed Target with strict Nitro cap (<= 30.0 m/s) & fair non-stacking slow moderation
  let targetSpeedMps =
    baseTargetCruiseMps -
    Math.abs(carveTilt) * CARVE_SPEED_TRIM_MPS +
    (isJumping ? JUMP_AIR_SPEED_BONUS_MPS : 0);

  if (recoveryRampTimerSec > 0) {
    targetSpeedMps = Math.min(
      targetSpeedMps,
      getRecoverySpeedStageCap(recoveryElapsedSec)
    );
  }

  let activeBoostMult = 1.0;
  if (nitroTimerSec > 0) {
    activeBoostMult = Math.max(activeBoostMult, NITRO_BOOST_SPEED_MULT);
  }
  if (landingBoostTimerSec > 0) {
    activeBoostMult = Math.max(activeBoostMult, RAMP_LANDING_BOOST_MULT);
  }
  if (iceBoostTimerSec > 0) {
    activeBoostMult = Math.max(activeBoostMult, ICE_PATCH_SPEED_MULT);
  }
  targetSpeedMps = Math.min(NITRO_MAX_SPEED_CAP_MPS, targetSpeedMps * activeBoostMult);

  const combinedSlowMult = Math.min(
    penaltyTimerSec > 0 ? penaltySpeedMult : 1,
    attackSlowTimerSec > 0 ? attackSpeedMult : 1
  );
  if (combinedSlowMult < 1) {
    targetSpeedMps *= combinedSlowMult;
  }
  if (nitroTimerSec > 0 && attackSlowTimerSec > 0) {
    targetSpeedMps = Math.max(18.5, targetSpeedMps);
  }

  const accelRate =
    speedMps > targetSpeedMps
      ? PENALTY_DECEL_MPS2
      : nitroTimerSec > 0
      ? NITRO_ACCEL_MPS2
      : DOWNHILL_ACCEL_MPS2;
  const speedFloor =
    penaltyTimerSec > 0 || attackSlowTimerSec > 0 || recoveryRampTimerSec > 0
      ? MIN_RACING_FLOOR_MPS
      : MIN_START_PUSH_MPS;

  speedMps = clamp(
    approach(speedMps, targetSpeedMps, accelRate * subDtSec),
    speedFloor,
    NITRO_MAX_SPEED_CAP_MPS
  );
  const prevDistM = racer.distanceM;
  const nextDistanceM = Math.min(COURSE_LENGTH_M, prevDistM + speedMps * subDtSec);

  // Finish Line Priority: crossing 1,000m completes run cleanly before any new collision
  if (nextDistanceM >= COURSE_LENGTH_M) {
    return {
      fields: {
        ...racer,
        distanceM: COURSE_LENGTH_M,
        laneOffset,
        lateralVelocity: 0,
        speedMps,
        carveTilt: approach(carveTilt, 0, subDtSec * 4),
        isJumping: false,
        jumpOrigin: 'manual',
        jumpElapsedSec: 0,
        jumpHeightPx: 0,
        scarfPhase: racer.scarfPhase + subDtSec * (4 + speedMps * 0.45),
        finishTimeMs: nextElapsedMs,
        penaltyTimerSec: 0,
        penaltySpeedMult: 1,
        penaltyKind: null,
        spinTimerSec: 0,
        iceSlipTimerSec: 0,
        iceBoostTimerSec: 0,
        landingBoostTimerSec: 0,
        tumbleTimerSec: 0,
        invulnerableTimerSec: 0,
        recoveryRampTimerSec: 0,
        itemArmingTimerSec: 0,
        nitroTimerSec: 0,
        shieldTimerSec: 0,
        shieldBreakAnimTimerSec: 0,
        attackSlowTimerSec: 0,
        attackSpeedMult: 1,
        mercyInvulnTimerSec: 0,
      },
      manualJumped,
      rampLaunched: false,
      rampBoosted,
      hitObstacles: [],
      shieldBlockedObstacle: false,
      recoveredFromTumble: false,
    };
  }

  // World-Coordinate Obstacle Collision Evaluation
  let interactedObstacleIds = racer.interactedObstacleIds;
  let obstacleHitCount = racer.obstacleHitCount;
  const hitObstacles: SnowRushObstacleKind[] = [];
  let shieldBlockedObstacle = false;
  const obstacles = track.obstacles;

  for (let i = 0; i < obstacles.length; i += 1) {
    const obs = obstacles[i];
    if (obs.distanceM + obs.halfLengthM + RACER_COLLISION_HALF_LENGTH_M < prevDistM) {
      continue;
    }
    if (obs.distanceM - obs.halfLengthM - RACER_COLLISION_HALF_LENGTH_M > nextDistanceM) {
      break;
    }

    if (interactedObstacleIds.includes(obs.id)) {
      continue;
    }

    if (!doesSegmentOverlapObstacleDistance(prevDistM, nextDistanceM, obs)) {
      continue;
    }
    if (!doesRacerOverlapObstacleLaterally(laneOffset, obs)) {
      continue;
    }

    // E. Jump Ramp: auto-launches racer for ~0.85s, +15% landing boost on touchdown
    if (obs.kind === 'jump_ramp') {
      if (jumpHeightPx <= 18) {
        interactedObstacleIds = [...interactedObstacleIds, obs.id];
        isJumping = true;
        jumpOrigin = 'ramp';
        jumpElapsedSec = 0;
        jumpDurationSec = RAMP_JUMP_DURATION_SEC;
        jumpPeakHeightPx = RAMP_JUMP_PEAK_HEIGHT_PX;
        jumpHeightPx = 4;
        rampLaunched = true;
      }
      continue;
    }

    // D. Ice Patch: +10% speed while crossing, ~1.2s reduced steering grip (jumpable if airborne)
    if (obs.kind === 'ice_patch') {
      if (obs.jumpable && jumpHeightPx >= obs.clearanceHeightPx) {
        continue;
      }
      interactedObstacleIds = [...interactedObstacleIds, obs.id];
      iceBoostTimerSec = Math.max(iceBoostTimerSec, ICE_PATCH_BOOST_DURATION_SEC);
      if (nitroTimerSec <= 0 && shieldTimerSec <= 0) {
        iceSlipTimerSec = Math.max(iceSlipTimerSec, ICE_PATCH_SLIP_DURATION_SEC);
        iceDriftDir = laneOffset >= obs.laneOffset ? 1 : -1;
        lateralVelocity = clamp(
          lateralVelocity + iceDriftDir * 0.36,
          -MAX_LATERAL_VELOCITY,
          MAX_LATERAL_VELOCITY
        );
      }
      speedMps = Math.min(
        NITRO_MAX_SPEED_CAP_MPS,
        Math.max(speedMps, baseTargetCruiseMps * ICE_PATCH_SPEED_MULT)
      );
      hitObstacles.push('ice_patch');
      continue;
    }

    // B. Rock & C. Snow Mound: Jumpable low obstacles
    if (obs.jumpable && jumpHeightPx >= obs.clearanceHeightPx) {
      continue;
    }

    // Solid obstacle collision confirmed! Guard obstacle ID so it can never hit twice
    interactedObstacleIds = [...interactedObstacleIds, obs.id];

    // Step 4.4 Ice Shield: absorbs 1 solid obstacle crash and shatters immediately!
    if (shieldTimerSec > 0) {
      shieldTimerSec = 0;
      shieldBreakAnimTimerSec = SHIELD_BREAK_ANIM_DURATION_SEC;
      shieldBlocksCount += 1;
      shieldBlockedObstacle = true;
      continue;
    }

    obstacleHitCount += 1;
    landingBoostTimerSec = 0;
    hitObstacles.push(obs.kind);

    if (obs.kind === 'pine_tree') {
      isJumping = false;
      jumpElapsedSec = 0;
      jumpHeightPx = 0;
      penaltySpeedMult =
        penaltyTimerSec > 0
          ? Math.min(penaltySpeedMult, PINE_TREE_SPEED_MULT)
          : PINE_TREE_SPEED_MULT;
      penaltyTimerSec = Math.max(penaltyTimerSec, PINE_TREE_PENALTY_SEC);
      penaltyKind = 'pine_tree';
      speedMps = Math.min(speedMps, baseTargetCruiseMps * PINE_TREE_SPEED_MULT);
    } else if (obs.kind === 'rock') {
      penaltySpeedMult =
        penaltyTimerSec > 0 ? Math.min(penaltySpeedMult, ROCK_SPEED_MULT) : ROCK_SPEED_MULT;
      penaltyTimerSec = Math.max(penaltyTimerSec, ROCK_SPIN_PENALTY_SEC);
      penaltyKind = 'rock';
      spinTimerSec = Math.max(spinTimerSec, ROCK_SPIN_PENALTY_SEC);
      speedMps = Math.min(speedMps, baseTargetCruiseMps * ROCK_SPEED_MULT);
    } else if (obs.kind === 'snow_mound') {
      penaltySpeedMult =
        penaltyTimerSec > 0
          ? Math.min(penaltySpeedMult, SNOW_MOUND_SPEED_MULT)
          : SNOW_MOUND_SPEED_MULT;
      penaltyTimerSec = Math.max(penaltyTimerSec, SNOW_MOUND_PENALTY_SEC);
      penaltyKind = 'snow_mound';
      speedMps = Math.min(speedMps, baseTargetCruiseMps * SNOW_MOUND_SPEED_MULT);
    } else if (obs.kind === 'slalom_gate') {
      isJumping = false;
      jumpElapsedSec = 0;
      jumpHeightPx = 0;
      penaltySpeedMult =
        penaltyTimerSec > 0
          ? Math.min(penaltySpeedMult, SLALOM_BARRIER_SPEED_MULT)
          : SLALOM_BARRIER_SPEED_MULT;
      penaltyTimerSec = Math.max(penaltyTimerSec, SLALOM_BARRIER_PENALTY_SEC);
      penaltyKind = 'slalom_gate';
      speedMps = Math.min(speedMps, baseTargetCruiseMps * SLALOM_BARRIER_SPEED_MULT);
      const openCenter = obs.openCenterLane ?? 0;
      const pushDir = openCenter >= laneOffset ? 1 : -1;
      lateralVelocity = clamp(
        lateralVelocity + pushDir * 0.55,
        -MAX_LATERAL_VELOCITY,
        MAX_LATERAL_VELOCITY
      );
    }
  }

  return {
    fields: {
      ...racer,
      distanceM: nextDistanceM,
      laneOffset,
      lateralVelocity,
      speedMps,
      carveTilt,
      isJumping,
      jumpOrigin,
      jumpElapsedSec,
      jumpDurationSec,
      jumpPeakHeightPx,
      jumpHeightPx,
      scarfPhase: racer.scarfPhase + subDtSec * (4 + speedMps * 0.45),
      penaltyTimerSec,
      penaltySpeedMult,
      penaltyKind,
      spinTimerSec,
      iceSlipTimerSec,
      iceBoostTimerSec,
      iceDriftDir,
      landingBoostTimerSec,
      tumbleTimerSec: 0,
      invulnerableTimerSec,
      recoveryRampTimerSec,
      recoveryElapsedSec,
      obstacleHitCount,
      interactedObstacleIds,
      itemArmingTimerSec,
      nitroTimerSec,
      shieldTimerSec,
      shieldBreakAnimTimerSec,
      shieldBlocksCount,
      attackSlowTimerSec,
      attackSpeedMult,
      mercyInvulnTimerSec,
    },
    manualJumped,
    rampLaunched,
    rampBoosted,
    hitObstacles,
    shieldBlockedObstacle,
    recoveredFromTumble: false,
  };
}

function hashBotDecision(seed: number, rowIndex: number, botKey: number): number {
  let h =
    (seed ^
      Math.imul(Math.floor(rowIndex * 10), 0x9e3779b1) ^
      Math.imul(botKey, 0x85ebca6b)) >>>
    0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function computeOfflineBotInput(
  bot: OfflineDemoBotState,
  elapsedRaceSec: number,
  track: SnowRushTrackLayout,
  itemBoxes: readonly SnowRushItemBox[],
  traps: readonly SnowRushTrap[],
  rivals: readonly {
    id: string;
    distanceM: number;
    laneOffset: number;
    finishTimeMs: number | null;
  }[]
): SnowRushInputState {
  if (bot.finishTimeMs !== null || bot.distanceM >= COURSE_LENGTH_M || bot.tumbleTimerSec > 0) {
    return { steerLeft: false, steerRight: false, jumpPressed: false, useItemPressed: false };
  }

  const botKey = bot.id.charCodeAt(bot.id.length - 1) || 1;
  let desiredLane = clamp(
    bot.weaveCenterOffset +
      Math.sin(elapsedRaceSec * bot.weaveFreqRad + bot.weavePhaseRad) * bot.weaveAmplitude,
    -TRACK_SAFE_LANE_LIMIT * 0.88,
    TRACK_SAFE_LANE_LIMIT * 0.88
  );
  let shouldJump = false;

  // Step 4.4: When slot is empty, opportunistically steer toward an unpicked Item Box ahead
  if (bot.heldItem === null) {
    let bestBoxLane: number | null = null;
    let bestBoxDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < itemBoxes.length; i += 1) {
      const box = itemBoxes[i];
      if (box.pickedUpByRacerId !== null) continue;
      const aheadM = box.distanceM - bot.distanceM;
      if (aheadM < 2.5) continue;
      if (aheadM > 28.0) break;
      const boxRoll = hashBotDecision(track.seed, box.rowIndex + 50, botKey);
      if (boxRoll < 0.82) {
        const d = Math.abs(box.laneOffset - bot.laneOffset);
        if (d < bestBoxDelta) {
          bestBoxDelta = d;
          bestBoxLane = box.laneOffset;
        }
      }
    }
    if (bestBoxLane !== null) {
      desiredLane = bestBoxLane;
    }
  } else if (bot.heldItem === 'snowball_attack' && bot.itemArmingTimerSec <= 0) {
    // Gently line up with a nearby rival ahead to take a clean snowball shot
    for (let i = 0; i < rivals.length; i += 1) {
      const r = rivals[i];
      if (r.id === bot.id || r.finishTimeMs !== null) continue;
      const aheadM = r.distanceM - bot.distanceM;
      if (aheadM >= 6 && aheadM <= 75 && Math.abs(r.laneOffset - bot.laneOffset) <= 0.36) {
        desiredLane = r.laneOffset;
        break;
      }
    }
  }

  // Step 4.4: Moderate awareness of dropped Snow Traps ahead (~62% dodge/jump so traps still land!)
  for (let i = 0; i < traps.length; i += 1) {
    const trap = traps[i];
    if (!trap.active || trap.ownerId === bot.id) continue;
    const aheadM = trap.distanceM - bot.distanceM;
    if (aheadM < 1.5 || aheadM > 14.0) continue;
    if (Math.abs(trap.laneOffset - bot.laneOffset) <= 0.2) {
      const dodgeRoll = hashBotDecision(track.seed, Math.floor(trap.distanceM), botKey);
      if (dodgeRoll < 0.62 && aheadM <= 6.5 && !bot.isJumping) {
        shouldJump = true;
      }
      break;
    }
  }

  // Obstacle avoidance (highest steering priority)
  const obstacles = track.obstacles;
  for (let i = 0; i < obstacles.length; i += 1) {
    const obs = obstacles[i];
    const aheadM = obs.distanceM - bot.distanceM;
    if (aheadM < 1.0) continue;
    if (aheadM > 24.0) break;

    if (bot.interactedObstacleIds.includes(obs.id)) continue;

    if (obs.kind === 'jump_ramp' && Math.abs(obs.laneOffset - bot.laneOffset) < 0.24) {
      desiredLane = obs.laneOffset;
      break;
    }

    const overlapsCurrent = doesRacerOverlapObstacleLaterally(bot.laneOffset, obs);
    const decisionRoll = hashBotDecision(track.seed, obs.rowIndex + i * 0.1, botKey);

    if (obs.kind === 'slalom_gate') {
      if (obs.openLaneCenters.length > 0 && decisionRoll < 0.88) {
        let nearestOpen = obs.openLaneCenters[0];
        let bestDelta = Math.abs(bot.laneOffset - nearestOpen);
        for (let k = 1; k < obs.openLaneCenters.length; k += 1) {
          const d = Math.abs(bot.laneOffset - obs.openLaneCenters[k]);
          if (d < bestDelta) {
            bestDelta = d;
            nearestOpen = obs.openLaneCenters[k];
          }
        }
        desiredLane = nearestOpen;
      }
      break;
    }

    if (!overlapsCurrent) continue;

    if (
      (obs.kind === 'rock' || obs.kind === 'snow_mound') &&
      aheadM >= 2.8 &&
      aheadM <= 7.6 &&
      !bot.isJumping
    ) {
      if (decisionRoll < 0.78) {
        shouldJump = true;
      }
      break;
    }

    if (
      (obs.kind === 'pine_tree' || aheadM > 8.0) &&
      obs.openLaneCenters.length > 0 &&
      decisionRoll < 0.84
    ) {
      let nearestOpen = obs.openLaneCenters[0];
      let bestDelta = Math.abs(bot.laneOffset - nearestOpen);
      for (let k = 1; k < obs.openLaneCenters.length; k += 1) {
        const d = Math.abs(bot.laneOffset - obs.openLaneCenters[k]);
        if (d < bestDelta) {
          bestDelta = d;
          nearestOpen = obs.openLaneCenters[k];
        }
      }
      desiredLane = nearestOpen;
      break;
    }
  }

  const laneError = desiredLane - bot.laneOffset;
  return {
    steerLeft: laneError < -0.045,
    steerRight: laneError > 0.045,
    jumpPressed: shouldJump,
    useItemPressed: false,
  };
}

/**
 * Avalanche Snow Tumble knockdown.
 * NOTE (Step 4.4 Spec): Ice Shield NEVER blocks the Avalanche — active shield/nitro are cleared on catch.
 */
export function triggerSnowTumble<T extends CoreRacerFields>(racer: T): T {
  return {
    ...racer,
    isJumping: false,
    jumpOrigin: 'manual',
    jumpElapsedSec: 0,
    jumpHeightPx: 0,
    speedMps: SNOW_TUMBLE_DRIFT_SPEED_MPS,
    penaltyTimerSec: 0,
    penaltySpeedMult: 1,
    penaltyKind: null,
    spinTimerSec: 0,
    landingBoostTimerSec: 0,
    nitroTimerSec: 0,
    shieldTimerSec: 0,
    attackSlowTimerSec: 0,
    attackSpeedMult: 1,
    mercyInvulnTimerSec: 0,
    tumbleTimerSec: SNOW_TUMBLE_DURATION_SEC,
    tumbleCount: racer.tumbleCount + 1,
  };
}

export function computeAvalancheWarning(
  isActive: boolean,
  playerFinished: boolean,
  playerTumbleTimerSec: number,
  gapToPlayerM: number
): AvalancheWarningLevel {
  if (playerFinished) return 'safe';
  if (playerTumbleTimerSec > 0) return 'tumble';
  if (!isActive) return 'safe';
  if (gapToPlayerM <= AVALANCHE_DANGER_GAP_M) return 'danger';
  if (gapToPlayerM <= AVALANCHE_CAUTION_GAP_M) return 'caution';
  return 'safe';
}

/**
 * Advance the local Snow Rush prototype by `rawDtSec` seconds.
 * Pure, sub-stepped, and deterministic — safe for unit verification and `requestAnimationFrame`.
 */
export function stepSnowRushSimulation(
  state: SnowRushPrototypeState,
  input: SnowRushInputState,
  rawDtSec: number
): SnowRushPrototypeState {
  const dtSec = clamp(Number.isFinite(rawDtSec) ? rawDtSec : 0, 0, MAX_SIMULATION_DT_SEC);
  if (dtSec <= 0) {
    return state.events.length === 0 ? state : { ...state, events: [] };
  }

  if (state.phase === 'ready') {
    return {
      ...state,
      events: [],
      player: {
        ...state.player,
        scarfPhase: state.player.scarfPhase + dtSec * 3.2,
      },
      offlineDemoBots: state.offlineDemoBots.map((bot) => ({
        ...bot,
        scarfPhase: bot.scarfPhase + dtSec * 3.0,
      })),
    };
  }

  if (state.phase === 'countdown') {
    const nextCountdown = Math.max(0, state.countdownRemainingSec - dtSec);
    const steerAxis = (input.steerRight ? 1 : 0) - (input.steerLeft ? 1 : 0);
    const previewTilt = approach(state.player.carveTilt, steerAxis * 0.35, dtSec * 5);

    if (nextCountdown <= 0) {
      return {
        ...state,
        phase: 'racing',
        countdownRemainingSec: 0,
        events: [],
        player: {
          ...state.player,
          speedMps: MIN_START_PUSH_MPS,
          topSpeedMps: MIN_START_PUSH_MPS,
          carveTilt: previewTilt,
          scarfPhase: state.player.scarfPhase + dtSec * 6.0,
        },
        offlineDemoBots: state.offlineDemoBots.map((bot) => ({
          ...bot,
          speedMps: MIN_START_PUSH_MPS * 0.96,
          scarfPhase: bot.scarfPhase + dtSec * 5.5,
        })),
      };
    }

    return {
      ...state,
      countdownRemainingSec: nextCountdown,
      events: [],
      player: {
        ...state.player,
        carveTilt: previewTilt,
        scarfPhase: state.player.scarfPhase + dtSec * 4.2,
      },
      offlineDemoBots: state.offlineDemoBots.map((bot) => ({
        ...bot,
        scarfPhase: bot.scarfPhase + dtSec * 4.0,
      })),
    };
  }

  // Finished phase: local player state & finishTimeMs remain immutable; Avalanche & items cannot alter finished player
  if (state.phase === 'finished') {
    return {
      ...state,
      events: [],
      projectiles: [],
      visualBursts: stepVisualBursts(state.visualBursts, dtSec),
      avalanche: {
        ...state.avalanche,
        speedMps: 0,
        warningLevel: 'safe',
      },
      player: {
        ...state.player,
        distanceM: COURSE_LENGTH_M,
        speedMps: approach(state.player.speedMps, 0, 26 * dtSec),
        carveTilt: approach(state.player.carveTilt, 0, 5 * dtSec),
        isJumping: false,
        jumpElapsedSec: 0,
        jumpHeightPx: 0,
        tumbleTimerSec: 0,
        invulnerableTimerSec: 0,
        mercyInvulnTimerSec: 0,
        nitroTimerSec: 0,
        shieldTimerSec: 0,
        shieldBreakAnimTimerSec: 0,
        attackSlowTimerSec: 0,
        penaltyTimerSec: 0,
        spinTimerSec: 0,
        scarfPhase: state.player.scarfPhase + dtSec * 3.8,
      },
    };
  }

  // Active 'racing' phase — fixed internal sub-stepping prevents obstacle & projectile tunneling
  const substepCount = Math.max(1, Math.ceil(dtSec / MAX_COLLISION_SUBSTEP_SEC));
  const subDtSec = dtSec / substepCount;

  let elapsedRaceMs = state.elapsedRaceMs;
  let player: PlayerRacerState = state.player;
  let bots: OfflineDemoBotState[] = state.offlineDemoBots;
  let itemBoxes: SnowRushItemBox[] = state.itemBoxes;
  let projectiles: SnowRushProjectile[] = state.projectiles;
  let traps: SnowRushTrap[] = state.traps;
  let visualBursts: SnowRushVisualBurst[] = state.visualBursts;
  let nextEntitySerial = state.nextEntitySerial;
  let avalanche: AvalancheState = state.avalanche;
  let phase: SnowRushPrototypeState['phase'] = state.phase;
  let finishRank: number | null = state.finishRank;
  const collectedEvents: SnowRushStepEvent[] = [];

  // Consume jump & item presses once inside the frame
  let playerInputForSubstep: SnowRushInputState = {
    steerLeft: Boolean(input.steerLeft),
    steerRight: Boolean(input.steerRight),
    jumpPressed: Boolean(input.jumpPressed),
    useItemPressed: Boolean(input.useItemPressed),
  };

  for (let stepIdx = 0; stepIdx < substepCount; stepIdx += 1) {
    elapsedRaceMs += subDtSec * 1000;
    const elapsedRaceSec = elapsedRaceMs / 1000;
    visualBursts = stepVisualBursts(visualBursts, subDtSec);

    // 0. Manual Player Item Activation (never auto-activates; respects 0.4s arming delay)
    if (playerInputForSubstep.useItemPressed) {
      playerInputForSubstep = { ...playerInputForSubstep, useItemPressed: false };
      const actRes = tryActivateRacerHeldItem({
        racer: player,
        isLocalPlayer: true,
        projectiles,
        traps,
        nextEntitySerial,
        events: collectedEvents,
      });
      player = actRes.racer;
      projectiles = actRes.projectiles;
      traps = actRes.traps;
      nextEntitySerial = actRes.nextEntitySerial;
    }

    // 1. Step Local Player Movement & Obstacle Collisions
    const prevPlayerDistM = player.distanceM;
    const playerRes = stepCoreRacerSubstep(
      player,
      playerInputForSubstep,
      BASE_MAX_SPEED_MPS,
      subDtSec,
      elapsedRaceMs,
      avalanche.distanceM,
      state.track
    );

    if (playerRes.manualJumped) {
      playerInputForSubstep = { ...playerInputForSubstep, jumpPressed: false };
      collectedEvents.push({ type: 'player_jump', origin: 'manual' });
    }
    if (playerRes.rampLaunched) {
      collectedEvents.push({ type: 'player_jump', origin: 'ramp' });
    }
    if (playerRes.rampBoosted) {
      collectedEvents.push({ type: 'player_ramp_boost' });
    }
    if (playerRes.shieldBlockedObstacle) {
      visualBursts = appendVisualBurst(
        visualBursts,
        nextEntitySerial++,
        'shield_break',
        playerRes.fields.distanceM,
        playerRes.fields.laneOffset,
        SHIELD_BREAK_ANIM_DURATION_SEC
      );
      collectedEvents.push({
        type: 'shield_break',
        racerId: player.id,
        reason: 'obstacle',
      });
    }
    playerRes.hitObstacles.forEach((kind) => {
      collectedEvents.push({ type: 'player_obstacle_hit', kind });
    });
    if (playerRes.recoveredFromTumble) {
      collectedEvents.push({ type: 'player_recovery' });
    }

    const nextTopSpeed = Math.max(player.topSpeedMps, playerRes.fields.speedMps);
    const nextJumpCount =
      player.jumpCount +
      (playerRes.manualJumped ? 1 : 0) +
      (playerRes.rampLaunched ? 1 : 0);
    const nextRampLaunchCount =
      player.rampLaunchCount + (playerRes.rampLaunched ? 1 : 0);

    let nextTrail = player.trail;
    const lastSample = nextTrail[nextTrail.length - 1];
    if (
      !playerRes.fields.isJumping &&
      playerRes.fields.tumbleTimerSec <= 0 &&
      (!lastSample ||
        playerRes.fields.distanceM - lastSample.distanceM >= TRAIL_SAMPLE_MIN_DELTA_M)
    ) {
      const sample = {
        distanceM: playerRes.fields.distanceM,
        laneOffset: playerRes.fields.laneOffset,
        carveAmount: Math.abs(playerRes.fields.carveTilt),
        nitroActive: playerRes.fields.nitroTimerSec > 0,
      };
      nextTrail =
        nextTrail.length >= MAX_TRAIL_SAMPLES
          ? [...nextTrail.slice(nextTrail.length - MAX_TRAIL_SAMPLES + 1), sample]
          : [...nextTrail, sample];
    }

    player = {
      ...player,
      ...playerRes.fields,
      topSpeedMps: nextTopSpeed,
      jumpCount: nextJumpCount,
      rampLaunchCount: nextRampLaunchCount,
      trail: nextTrail,
    };

    // 2. Step Offline Demo Bots (including contextual Item AI + movement + obstacles)
    const botRecoveredFlags: boolean[] = [];
    const prevBotDistsM = bots.map((b) => b.distanceM);

    if (state.showOfflineBots) {
      const updatedBots: OfflineDemoBotState[] = [];
      for (let idx = 0; idx < bots.length; idx += 1) {
        let bot: OfflineDemoBotState = {
          ...bots[idx],
          botItemReadyDelaySec: Math.max(0, bots[idx].botItemReadyDelaySec - subDtSec),
        };

        const otherRacers = [
          {
            id: player.id,
            distanceM: player.distanceM,
            laneOffset: player.laneOffset,
            finishTimeMs: player.finishTimeMs,
            tumbleTimerSec: player.tumbleTimerSec,
          },
          ...bots
            .filter((_, j) => j !== idx)
            .map((other) => ({
              id: other.id,
              distanceM: other.distanceM,
              laneOffset: other.laneOffset,
              finishTimeMs: other.finishTimeMs,
              tumbleTimerSec: other.tumbleTimerSec,
            })),
        ];

        if (
          shouldOfflineBotUseHeldItem({
            bot,
            otherActiveRacers: otherRacers,
            projectiles,
            obstacles: state.track.obstacles,
          })
        ) {
          const botAct = tryActivateRacerHeldItem({
            racer: bot,
            isLocalPlayer: false,
            projectiles,
            traps,
            nextEntitySerial,
            events: collectedEvents,
          });
          bot = botAct.racer;
          projectiles = botAct.projectiles;
          traps = botAct.traps;
          nextEntitySerial = botAct.nextEntitySerial;
        }

        const botInput = computeOfflineBotInput(
          bot,
          elapsedRaceSec,
          state.track,
          itemBoxes,
          traps,
          otherRacers
        );
        const speedWave = Math.sin(elapsedRaceSec * 0.85 + bot.weavePhaseRad) * 0.7;
        const botTargetCruise = Math.max(MIN_START_PUSH_MPS, bot.baseCruiseMps + speedWave);

        const botRes = stepCoreRacerSubstep(
          bot,
          botInput,
          botTargetCruise,
          subDtSec,
          elapsedRaceMs,
          avalanche.distanceM,
          state.track
        );
        botRecoveredFlags[idx] = botRes.recoveredFromTumble;

        if (botRes.shieldBlockedObstacle) {
          visualBursts = appendVisualBurst(
            visualBursts,
            nextEntitySerial++,
            'shield_break',
            botRes.fields.distanceM,
            botRes.fields.laneOffset,
            SHIELD_BREAK_ANIM_DURATION_SEC
          );
          collectedEvents.push({
            type: 'shield_break',
            racerId: bot.id,
            reason: 'obstacle',
          });
        }

        updatedBots.push({
          ...bot,
          ...botRes.fields,
        });
      }
      bots = updatedBots;
    }

    // 3. Evaluate Deterministic World-Coordinate Item Box Pickups (Player + Active Bots)
    const allLiveDistances = state.showOfflineBots
      ? [player.distanceM, ...bots.map((b) => b.distanceM)]
      : [player.distanceM];
    const totalRacers = allLiveDistances.length;

    const playerRank = computeLiveRacerRank(player.distanceM, allLiveDistances);
    const playerPickup = evaluateRacerItemBoxPickup({
      racer: player,
      prevDistM: prevPlayerDistM,
      itemBoxes,
      seed: state.track.seed,
      racerRank: playerRank,
      totalRacers,
      nextEntitySerial,
      visualBursts,
      events: collectedEvents,
    });
    player = playerPickup.racer;
    itemBoxes = playerPickup.itemBoxes;
    nextEntitySerial = playerPickup.nextEntitySerial;
    visualBursts = playerPickup.visualBursts;

    if (state.showOfflineBots) {
      const botsAfterPickup: OfflineDemoBotState[] = [];
      for (let idx = 0; idx < bots.length; idx += 1) {
        const bot = bots[idx];
        const botRank = computeLiveRacerRank(bot.distanceM, allLiveDistances);
        const botPickup = evaluateRacerItemBoxPickup({
          racer: bot,
          prevDistM: prevBotDistsM[idx] ?? bot.distanceM,
          itemBoxes,
          seed: state.track.seed,
          racerRank: botRank,
          totalRacers,
          nextEntitySerial,
          visualBursts,
          events: collectedEvents,
        });
        itemBoxes = botPickup.itemBoxes;
        nextEntitySerial = botPickup.nextEntitySerial;
        visualBursts = botPickup.visualBursts;

        let updatedBot = botPickup.racer;
        if (botPickup.pickedUp) {
          const thinkJitter = hashDeterministicRoll(
            state.track.seed,
            updatedBot.itemsPickedUpCount,
            idx + 1
          );
          updatedBot = {
            ...updatedBot,
            botItemReadyDelaySec: 0.22 + thinkJitter * 0.36,
          };
        }
        botsAfterPickup.push(updatedBot);
      }
      bots = botsAfterPickup;
    }

    // 4. Advance Active Snowball Projectiles & Evaluate Hits / Shield Blocks / Range Despawns
    const projRes = stepProjectilesSubstep({
      projectiles,
      player,
      bots,
      showOfflineBots: state.showOfflineBots,
      subDtSec,
      nextEntitySerial,
      visualBursts,
      events: collectedEvents,
    });
    projectiles = projRes.projectiles;
    player = projRes.player;
    bots = projRes.bots;
    nextEntitySerial = projRes.nextEntitySerial;
    visualBursts = projRes.visualBursts;

    // 5. Evaluate Active Snow Traps & Decay Trap Lifetimes
    const trapRes = stepTrapsSubstep({
      traps,
      player,
      prevPlayerDistM,
      bots,
      prevBotDistsM,
      showOfflineBots: state.showOfflineBots,
      subDtSec,
      nextEntitySerial,
      visualBursts,
      events: collectedEvents,
    });
    traps = trapRes.traps;
    player = trapRes.player;
    bots = trapRes.bots;
    nextEntitySerial = trapRes.nextEntitySerial;
    visualBursts = trapRes.visualBursts;

    // 6. Check if Local Player just crossed Finish Line (1,000 m)
    if (player.distanceM >= COURSE_LENGTH_M || player.finishTimeMs !== null) {
      const botsFinishedAhead = state.showOfflineBots
        ? bots.filter(
            (b) =>
              b.distanceM >= COURSE_LENGTH_M &&
              (b.finishTimeMs ?? Number.POSITIVE_INFINITY) <
                (player.finishTimeMs ?? elapsedRaceMs)
          ).length
        : 0;

      phase = 'finished';
      finishRank = 1 + botsFinishedAhead;
      avalanche = {
        ...avalanche,
        speedMps: 0,
        warningLevel: 'safe',
        gapToPlayerM: Math.max(0, COURSE_LENGTH_M - avalanche.distanceM),
      };
      break;
    }

    // 7. Advance Avalanche Chase (-90m start, 4.0s grace, 17.5 m/s base, <= 19.2 m/s cap, 130m trailing clamp)
    const activeUnfinishedDistances: number[] = [];
    if (player.finishTimeMs === null && player.distanceM < COURSE_LENGTH_M) {
      activeUnfinishedDistances.push(player.distanceM);
    }
    if (state.showOfflineBots) {
      bots.forEach((b) => {
        if (b.finishTimeMs === null && b.distanceM < COURSE_LENGTH_M) {
          activeUnfinishedDistances.push(b.distanceM);
        }
      });
    }

    let nextAvalancheDistM = avalanche.distanceM;
    let nextAvalancheSpeedMps = 0;
    let nextGraceSec = Math.max(0, AVALANCHE_SAFE_GRACE_SEC - elapsedRaceSec);
    let nextIsActive = false;

    if (elapsedRaceSec < AVALANCHE_SAFE_GRACE_SEC) {
      nextAvalancheDistM = AVALANCHE_INITIAL_DISTANCE_M;
      nextAvalancheSpeedMps = 0;
      nextIsActive = false;
    } else {
      nextGraceSec = 0;
      nextIsActive = true;
      const trailingRacerDistM =
        activeUnfinishedDistances.length > 0
          ? Math.min(...activeUnfinishedDistances)
          : COURSE_LENGTH_M;

      const gapToTrailingM = trailingRacerDistM - avalanche.distanceM;
      const catchupFactor = clamp((gapToTrailingM - 60) / 55, 0, 1);
      const computedSpeed =
        AVALANCHE_BASE_SPEED_MPS +
        catchupFactor * (AVALANCHE_MAX_SPEED_MPS - AVALANCHE_BASE_SPEED_MPS);
      nextAvalancheSpeedMps = clamp(computedSpeed, 0, AVALANCHE_MAX_SPEED_MPS);

      nextAvalancheDistM = avalanche.distanceM + nextAvalancheSpeedMps * subDtSec;

      if (
        activeUnfinishedDistances.length > 0 &&
        trailingRacerDistM - nextAvalancheDistM > AVALANCHE_CATCHUP_MAX_GAP_M
      ) {
        nextAvalancheDistM = trailingRacerDistM - AVALANCHE_CATCHUP_MAX_GAP_M;
      }

      nextAvalancheDistM = Math.min(COURSE_LENGTH_M - 15, nextAvalancheDistM);
    }

    // Align exact +25m recovery lead against end-of-substep Avalanche position
    if (playerRes.recoveredFromTumble) {
      const alignedRecoveryM = clamp(
        Math.max(player.distanceM, nextAvalancheDistM + SNOW_TUMBLE_RECOVERY_AHEAD_M),
        0,
        SNOW_TUMBLE_MAX_RECOVERY_M
      );
      const safeSpot = pickNearestSafeLaneAtDistance(
        player.laneOffset,
        alignedRecoveryM,
        state.track.obstacles
      );
      player = {
        ...player,
        distanceM: alignedRecoveryM,
        laneOffset: safeSpot.laneOffset,
        interactedObstacleIds:
          safeSpot.guardedIds.length > 0
            ? Array.from(new Set([...player.interactedObstacleIds, ...safeSpot.guardedIds]))
            : player.interactedObstacleIds,
      };
    }

    if (state.showOfflineBots && botRecoveredFlags.some(Boolean)) {
      bots = bots.map((bot, idx) => {
        if (!botRecoveredFlags[idx]) return bot;
        const alignedBotM = clamp(
          Math.max(bot.distanceM, nextAvalancheDistM + SNOW_TUMBLE_RECOVERY_AHEAD_M),
          0,
          SNOW_TUMBLE_MAX_RECOVERY_M
        );
        const safeSpot = pickNearestSafeLaneAtDistance(
          bot.laneOffset,
          alignedBotM,
          state.track.obstacles
        );
        return {
          ...bot,
          distanceM: alignedBotM,
          laneOffset: safeSpot.laneOffset,
          interactedObstacleIds:
            safeSpot.guardedIds.length > 0
              ? Array.from(new Set([...bot.interactedObstacleIds, ...safeSpot.guardedIds]))
              : bot.interactedObstacleIds,
        };
      });
    }

    // 8. Snow Tumble Catch Check — Ice Shield NEVER blocks the Avalanche!
    if (nextIsActive) {
      if (
        player.finishTimeMs === null &&
        player.distanceM < COURSE_LENGTH_M &&
        player.tumbleTimerSec <= 0 &&
        player.invulnerableTimerSec <= 0 &&
        nextAvalancheDistM >= player.distanceM
      ) {
        player = triggerSnowTumble(player);
        collectedEvents.push({ type: 'player_snow_tumble' });
      }

      if (state.showOfflineBots) {
        bots = bots.map((bot) => {
          if (
            bot.finishTimeMs === null &&
            bot.distanceM < COURSE_LENGTH_M &&
            bot.tumbleTimerSec <= 0 &&
            bot.invulnerableTimerSec <= 0 &&
            nextAvalancheDistM >= bot.distanceM
          ) {
            return triggerSnowTumble(bot);
          }
          return bot;
        });
      }
    }

    const gapToPlayerM = Math.max(0, player.distanceM - nextAvalancheDistM);
    const nextWarning = computeAvalancheWarning(
      nextIsActive,
      player.finishTimeMs !== null,
      player.tumbleTimerSec,
      gapToPlayerM
    );

    if (
      nextWarning === 'danger' &&
      avalanche.warningLevel !== 'danger' &&
      avalanche.warningLevel !== 'tumble'
    ) {
      collectedEvents.push({ type: 'avalanche_warning' });
    }

    avalanche = {
      distanceM: nextAvalancheDistM,
      speedMps: nextAvalancheSpeedMps,
      graceRemainingSec: nextGraceSec,
      isActive: nextIsActive,
      warningLevel: nextWarning,
      gapToPlayerM,
    };
  }

  return {
    ...state,
    phase,
    elapsedRaceMs,
    itemBoxes,
    projectiles,
    traps,
    visualBursts,
    nextEntitySerial,
    avalanche,
    player,
    offlineDemoBots: bots,
    finishRank,
    events: collectedEvents,
  };
}

export function resolveCoreRacerStatus(
  racer: Pick<
    CoreRacerFields,
    | 'tumbleTimerSec'
    | 'invulnerableTimerSec'
    | 'nitroTimerSec'
    | 'shieldTimerSec'
    | 'mercyInvulnTimerSec'
    | 'spinTimerSec'
    | 'penaltyTimerSec'
    | 'attackSlowTimerSec'
    | 'landingBoostTimerSec'
    | 'iceSlipTimerSec'
  >
): RacerActiveStatus {
  if (racer.tumbleTimerSec > 0) return 'tumble';
  if (racer.invulnerableTimerSec > 0) return 'invulnerable';
  if (racer.nitroTimerSec > 0) return 'nitro_boost';
  if (racer.shieldTimerSec > 0) return 'ice_shield';
  if (racer.mercyInvulnTimerSec > 0) return 'mercy_invuln';
  if (racer.spinTimerSec > 0) return 'spin';
  if (racer.penaltyTimerSec > 0 || racer.attackSlowTimerSec > 0) return 'slowed';
  if (racer.landingBoostTimerSec > 0) return 'ramp_boost';
  if (racer.iceSlipTimerSec > 0) return 'ice_slip';
  return 'normal';
}

function resolvePlayerHudStatus(player: PlayerRacerState): RacerActiveStatus {
  return resolveCoreRacerStatus(player);
}

export function buildHudSnapshot(state: SnowRushPrototypeState): SnowRushHudSnapshot {
  let countdownStep: number | null = null;
  if (state.phase === 'countdown') {
    countdownStep = Math.max(
      1,
      Math.min(3, Math.ceil(state.countdownRemainingSec / COUNTDOWN_BEAT_SEC))
    );
  } else if (state.phase === 'racing' && state.elapsedRaceMs < 650) {
    countdownStep = 0; // Brief "GO!" flash right after launch
  }

  const activeBots = state.showOfflineBots ? state.offlineDemoBots : [];
  const itemMeta = getItemMetadata(state.player.heldItem);
  const armingRounded = Number(Math.max(0, state.player.itemArmingTimerSec).toFixed(2));
  const isItemReady =
    state.phase === 'racing' &&
    state.player.tumbleTimerSec <= 0 &&
    state.player.heldItem !== null &&
    state.player.itemArmingTimerSec <= 0;

  return {
    phase: state.phase,
    countdownStep,
    trackSeed: state.track.seed,
    distanceM: state.player.distanceM,
    distanceKmText: formatDistanceKm(state.player.distanceM),
    courseLengthKmText: COURSE_LENGTH_KM_TEXT,
    progressPercent: getCourseProgressPercent(state.player.distanceM),
    speedKmh: state.phase === 'racing' ? formatSpeedKmh(state.player.speedMps) : 0,
    topSpeedKmh: formatSpeedKmh(state.player.topSpeedMps),
    jumpCount: state.player.jumpCount,
    obstacleHitCount: state.player.obstacleHitCount,
    tumbleCount: state.player.tumbleCount,
    playerStatus: resolvePlayerHudStatus(state.player),
    heldItem: state.player.heldItem,
    heldItemName: itemMeta ? itemMeta.name : null,
    heldItemNameMm: itemMeta ? itemMeta.nameMm : null,
    heldItemIcon: itemMeta ? itemMeta.icon : null,
    itemArmingSec: armingRounded,
    isItemReady,
    nitroRemainingSec: Number(Math.max(0, state.player.nitroTimerSec).toFixed(1)),
    shieldRemainingSec: Number(Math.max(0, state.player.shieldTimerSec).toFixed(1)),
    mercyInvulnRemainingSec: Number(Math.max(0, state.player.mercyInvulnTimerSec).toFixed(1)),
    itemsUsedCount: state.player.itemsUsedCount,
    attacksLandedCount: state.player.attacksLandedCount,
    shieldBlocksCount: state.player.shieldBlocksCount,
    avalancheDistanceM: state.avalanche.distanceM,
    avalancheProgressPercent: getCourseProgressPercent(state.avalanche.distanceM),
    avalancheGapM: Math.round(state.avalanche.gapToPlayerM),
    avalancheWarning: state.avalanche.warningLevel,
    avalancheGraceSec: Number(state.avalanche.graceRemainingSec.toFixed(1)),
    elapsedSecText: formatRaceTimeSec(state.elapsedRaceMs),
    finishTimeSecText:
      state.player.finishTimeMs !== null ? formatRaceTimeSec(state.player.finishTimeMs) : null,
    finishRank: state.finishRank,
    totalRacers: 1 + activeBots.length,
    showOfflineBots: state.showOfflineBots,
    bots: activeBots.map((bot) => {
      const botItemMeta = getItemMetadata(bot.heldItem);
      return {
        id: bot.id,
        shortTag: bot.shortTag,
        displayNameMm: bot.displayNameMm,
        progressPercent: getCourseProgressPercent(bot.distanceM),
        jacketColor: bot.jacketColor,
        isTumbling: bot.tumbleTimerSec > 0,
        heldItemIcon: botItemMeta ? botItemMeta.icon : null,
        hasShield: bot.shieldTimerSec > 0,
      };
    }),
  };
}
