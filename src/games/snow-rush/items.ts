import {
  COURSE_LENGTH_M,
  ICE_SHIELD_DURATION_SEC,
  ITEM_ARMING_DELAY_SEC,
  ITEM_BOX_HALF_LENGTH_M,
  ITEM_BOX_HALF_WIDTH_LANE,
  ITEM_BOX_ROW_DISTANCES_M,
  MAX_ACTIVE_TRAPS,
  MAX_LATERAL_VELOCITY,
  MAX_VISUAL_BURSTS,
  MERCY_INVULN_DURATION_SEC,
  NITRO_BOOST_DURATION_SEC,
  NITRO_BOOST_SPEED_MULT,
  NITRO_HIT_DAMP_MULT,
  NITRO_MAX_SPEED_CAP_MPS,
  BASE_MAX_SPEED_MPS,
  RACER_COLLISION_HALF_LANE,
  RACER_COLLISION_HALF_LENGTH_M,
  SHIELD_BREAK_ANIM_DURATION_SEC,
  SNOWBALL_HIT_HALF_LANE,
  SNOWBALL_HIT_SLOW_SEC,
  SNOWBALL_HIT_SPEED_MULT,
  SNOWBALL_MAX_RANGE_M,
  SNOWBALL_PROJECTILE_SPEED_MPS,
  SNOWBALL_SPAWN_AHEAD_M,
  SNOW_RUSH_ITEMS_META,
  TRACK_LANE_CENTERS,
  TRACK_SAFE_LANE_LIMIT,
  TRAP_DROP_BEHIND_M,
  TRAP_HALF_LENGTH_M,
  TRAP_HALF_WIDTH_LANE,
  TRAP_JUMP_CLEARANCE_PX,
  TRAP_MAX_LIFETIME_SEC,
  TRAP_SELF_SAFE_AGE_SEC,
  TRAP_SLIP_PENALTY_SEC,
  TRAP_SLIP_SPEED_MULT,
} from './constants';
import type {
  OfflineDemoBotState,
  SnowRushItemBox,
  SnowRushItemId,
  SnowRushObstacle,
  SnowRushProjectile,
  SnowRushStepEvent,
  SnowRushTrap,
  SnowRushVisualBurst,
  SnowRushVisualBurstKind,
} from './types';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createItemPrng(seed: number): () => number {
  let state = ((Math.floor(Math.abs(seed)) >>> 0) ^ 0x4954454d) >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleDeterministic<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Generates deterministic world-coordinate Item Boxes at [140, 280, 420, 560, 700, 840] meters.
 * Places 3 or 4 Item Boxes across the 5 track lanes per row using a seeded PRNG.
 */
export function generateDeterministicItemBoxes(seed: number): SnowRushItemBox[] {
  const rng = createItemPrng(seed);
  const boxes: SnowRushItemBox[] = [];
  let serial = 1;

  ITEM_BOX_ROW_DISTANCES_M.forEach((rowDistanceM, rowIndex) => {
    const boxCount = rng() < 0.55 ? 4 : 3;
    const chosenLanes = shuffleDeterministic([0, 1, 2, 3, 4], rng)
      .slice(0, boxCount)
      .sort((a, b) => a - b);

    chosenLanes.forEach((laneIdx) => {
      boxes.push({
        id: `ibox_${serial}_r${rowIndex}`,
        rowIndex,
        distanceM: rowDistanceM,
        laneOffset: TRACK_LANE_CENTERS[laneIdx],
        halfLengthM: ITEM_BOX_HALF_LENGTH_M,
        halfWidthLane: ITEM_BOX_HALF_WIDTH_LANE,
        pickedUpByRacerId: null,
      });
      serial += 1;
    });
  });

  return boxes;
}

export function cloneTrackItemBoxes(boxes: readonly SnowRushItemBox[]): SnowRushItemBox[] {
  return boxes.map((box) => ({ ...box, pickedUpByRacerId: null }));
}

export function getItemMetadata(itemId: SnowRushItemId | null) {
  if (!itemId) return null;
  return SNOW_RUSH_ITEMS_META[itemId] ?? null;
}

/**
 * Deterministic hash in [0, 1) used for rank-weighted item rolls and bot AI decisions.
 */
export function hashDeterministicRoll(seed: number, saltA: number, saltB: number): number {
  let h =
    ((Math.floor(Math.abs(seed)) >>> 0) ^
      Math.imul(Math.floor(saltA) + 17, 0x9e3779b1) ^
      Math.imul(Math.floor(saltB) + 31, 0x85ebca6b)) >>>
    0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Computes 1-based live rank of a racer among all participating racers (1 = leading).
 */
export function computeLiveRacerRank(
  racerDistanceM: number,
  allDistancesM: readonly number[]
): number {
  let aheadCount = 0;
  for (let i = 0; i < allDistancesM.length; i += 1) {
    if (allDistancesM[i] > racerDistanceM + 0.01) {
      aheadCount += 1;
    }
  }
  return 1 + aheadCount;
}

/**
 * Deterministic, rank-aware Battle Item roll with mild catch-up weighting:
 * - Trailing racers have slightly higher weight for `nitro_boost` & `snowball_attack`.
 * - Leading racers have slightly higher weight for `snow_trap` & `ice_shield`,
 *   while keeping every item possible so outcomes are never 100% scripted.
 */
export function rollDeterministicBattleItem(
  seed: number,
  boxSerialKey: number,
  pickupOrdinal: number,
  racerRank: number,
  totalRacers: number
): SnowRushItemId {
  const u = hashDeterministicRoll(seed, boxSerialKey * 13 + racerRank, pickupOrdinal);

  let weights: readonly [SnowRushItemId, number][];
  if (totalRacers <= 1) {
    weights = [
      ['nitro_boost', 0.28],
      ['snowball_attack', 0.26],
      ['snow_trap', 0.22],
      ['ice_shield', 0.24],
    ];
  } else if (racerRank >= totalRacers) {
    // Trailing racer: stronger catch-up boost & forward attack chance
    weights = [
      ['nitro_boost', 0.40],
      ['snowball_attack', 0.28],
      ['ice_shield', 0.22],
      ['snow_trap', 0.10],
    ];
  } else if (racerRank === 1) {
    // Leading racer: tactical trap & defensive shield emphasis
    weights = [
      ['snow_trap', 0.34],
      ['ice_shield', 0.30],
      ['snowball_attack', 0.22],
      ['nitro_boost', 0.14],
    ];
  } else {
    // Middle pack racer: balanced offense + boost + defense
    weights = [
      ['snowball_attack', 0.30],
      ['nitro_boost', 0.28],
      ['ice_shield', 0.24],
      ['snow_trap', 0.18],
    ];
  }

  let cumulative = 0;
  for (let i = 0; i < weights.length; i += 1) {
    cumulative += weights[i][1];
    if (u < cumulative) {
      return weights[i][0];
    }
  }
  return weights[weights.length - 1][0];
}

export interface CombatRacerMutableFields {
  id: string;
  distanceM: number;
  laneOffset: number;
  lateralVelocity: number;
  speedMps: number;
  isJumping: boolean;
  jumpHeightPx: number;
  finishTimeMs: number | null;
  penaltyTimerSec: number;
  penaltySpeedMult: number;
  penaltyKind: SnowRushObstacle['kind'] | null;
  spinTimerSec: number;
  iceSlipTimerSec: number;
  iceDriftDir: number;
  tumbleTimerSec: number;
  invulnerableTimerSec: number;
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

export function appendVisualBurst(
  bursts: SnowRushVisualBurst[],
  serial: number,
  kind: SnowRushVisualBurstKind,
  distanceM: number,
  laneOffset: number,
  durationSec = 0.42
): SnowRushVisualBurst[] {
  const entry: SnowRushVisualBurst = {
    id: `vfx_${serial}_${kind}`,
    kind,
    distanceM,
    laneOffset,
    elapsedSec: 0,
    durationSec,
  };
  if (bursts.length >= MAX_VISUAL_BURSTS) {
    return [...bursts.slice(bursts.length - MAX_VISUAL_BURSTS + 1), entry];
  }
  return [...bursts, entry];
}

export function stepVisualBursts(
  bursts: SnowRushVisualBurst[],
  dtSec: number
): SnowRushVisualBurst[] {
  if (bursts.length === 0) return bursts;
  const next: SnowRushVisualBurst[] = [];
  for (let i = 0; i < bursts.length; i += 1) {
    const b = bursts[i];
    const elapsedSec = b.elapsedSec + dtSec;
    if (elapsedSec < b.durationSec) {
      next.push({ ...b, elapsedSec });
    }
  }
  return next;
}

/**
 * Evaluates Item Box pickup along segment [prevDistM, nextDistM] for a single racer.
 * - Full inventory (`heldItem !== null`) NEVER overwrites existing item and does NOT consume the box.
 * - Finished and tumbling racers cannot pick up boxes.
 * - Picked up item enters 1-slot inventory with `0.4s` arming delay (never auto-activates).
 */
export function evaluateRacerItemBoxPickup<T extends CombatRacerMutableFields>(params: {
  racer: T;
  prevDistM: number;
  itemBoxes: SnowRushItemBox[];
  seed: number;
  racerRank: number;
  totalRacers: number;
  nextEntitySerial: number;
  visualBursts: SnowRushVisualBurst[];
  events: SnowRushStepEvent[];
}): {
  racer: T;
  itemBoxes: SnowRushItemBox[];
  nextEntitySerial: number;
  visualBursts: SnowRushVisualBurst[];
  pickedUp: boolean;
} {
  const { racer, prevDistM, seed, racerRank, totalRacers, events } = params;
  let { itemBoxes, nextEntitySerial, visualBursts } = params;

  if (
    racer.heldItem !== null ||
    racer.finishTimeMs !== null ||
    racer.distanceM >= COURSE_LENGTH_M ||
    racer.tumbleTimerSec > 0
  ) {
    return { racer, itemBoxes, nextEntitySerial, visualBursts, pickedUp: false };
  }

  const segMin = Math.min(prevDistM, racer.distanceM) - RACER_COLLISION_HALF_LENGTH_M;
  const segMax = Math.max(prevDistM, racer.distanceM) + RACER_COLLISION_HALF_LENGTH_M;

  for (let i = 0; i < itemBoxes.length; i += 1) {
    const box = itemBoxes[i];
    if (box.pickedUpByRacerId !== null) continue;
    if (box.distanceM + box.halfLengthM < segMin) continue;
    if (box.distanceM - box.halfLengthM > segMax) break;

    const lateralGap = Math.abs(racer.laneOffset - box.laneOffset);
    if (lateralGap > box.halfWidthLane + RACER_COLLISION_HALF_LANE) continue;

    // Valid single pickup!
    const pickupOrdinal = nextEntitySerial;
    nextEntitySerial += 1;
    const rolledItem = rollDeterministicBattleItem(
      seed,
      i + 1,
      pickupOrdinal,
      racerRank,
      totalRacers
    );

    const updatedBoxes = [...itemBoxes];
    updatedBoxes[i] = {
      ...box,
      pickedUpByRacerId: racer.id,
    };
    itemBoxes = updatedBoxes;

    visualBursts = appendVisualBurst(
      visualBursts,
      nextEntitySerial++,
      'item_pickup',
      box.distanceM,
      box.laneOffset,
      0.38
    );

    events.push({
      type: 'item_pickup',
      racerId: racer.id,
      itemId: rolledItem,
      boxId: box.id,
    });

    const updatedRacer: T = {
      ...racer,
      heldItem: rolledItem,
      itemArmingTimerSec: ITEM_ARMING_DELAY_SEC,
      itemsPickedUpCount: racer.itemsPickedUpCount + 1,
    };

    return {
      racer: updatedRacer,
      itemBoxes,
      nextEntitySerial,
      visualBursts,
      pickedUp: true,
    };
  }

  return { racer, itemBoxes, nextEntitySerial, visualBursts, pickedUp: false };
}

/**
 * Manual activation of the racer's 1-slot Held Item.
 * - Requires `useItemPressed === true`.
 * - Respects `0.4s` arming delay (`itemArmingTimerSec <= 0`).
 * - Empties slot immediately upon activation.
 */
export function tryActivateRacerHeldItem<T extends CombatRacerMutableFields>(params: {
  racer: T;
  isLocalPlayer: boolean;
  projectiles: SnowRushProjectile[];
  traps: SnowRushTrap[];
  nextEntitySerial: number;
  events: SnowRushStepEvent[];
}): {
  racer: T;
  projectiles: SnowRushProjectile[];
  traps: SnowRushTrap[];
  nextEntitySerial: number;
  activated: boolean;
} {
  const { racer, isLocalPlayer, events } = params;
  let { projectiles, traps, nextEntitySerial } = params;

  if (
    racer.finishTimeMs !== null ||
    racer.distanceM >= COURSE_LENGTH_M ||
    racer.tumbleTimerSec > 0
  ) {
    return { racer, projectiles, traps, nextEntitySerial, activated: false };
  }

  if (racer.heldItem === null) {
    if (isLocalPlayer) {
      events.push({ type: 'player_item_empty' });
    }
    return { racer, projectiles, traps, nextEntitySerial, activated: false };
  }

  // Enforce 0.4s post-pickup arming delay
  if (racer.itemArmingTimerSec > 0) {
    return { racer, projectiles, traps, nextEntitySerial, activated: false };
  }

  const itemToUse = racer.heldItem;
  let updatedRacer: T = {
    ...racer,
    heldItem: null,
    itemArmingTimerSec: 0,
    itemsUsedCount: racer.itemsUsedCount + 1,
  };

  if (itemToUse === 'nitro_boost') {
    // Nitro Boost: 2.2s @ +45% capped <= 30.0 m/s; cleanly purges active obstacle slow / spin / ice slip
    const surgedSpeed = Math.min(
      NITRO_MAX_SPEED_CAP_MPS,
      Math.max(updatedRacer.speedMps, BASE_MAX_SPEED_MPS * NITRO_BOOST_SPEED_MULT * 0.92)
    );
    updatedRacer = {
      ...updatedRacer,
      nitroTimerSec: NITRO_BOOST_DURATION_SEC,
      speedMps: surgedSpeed,
      penaltyTimerSec: 0,
      penaltySpeedMult: 1,
      penaltyKind: null,
      spinTimerSec: 0,
      attackSlowTimerSec: 0,
      attackSpeedMult: 1,
      iceSlipTimerSec: 0,
      iceDriftDir: 0,
    };
    events.push({ type: 'nitro_activate', racerId: racer.id });
  } else if (itemToUse === 'snowball_attack') {
    const projectileId = `proj_${nextEntitySerial}_snowball`;
    nextEntitySerial += 1;
    const spawnDistM = Math.min(COURSE_LENGTH_M + 5, racer.distanceM + SNOWBALL_SPAWN_AHEAD_M);
    projectiles = [
      ...projectiles,
      {
        id: projectileId,
        ownerId: racer.id,
        distanceM: spawnDistM,
        startDistanceM: spawnDistM,
        maxRangeM: SNOWBALL_MAX_RANGE_M,
        laneOffset: racer.laneOffset,
        speedMps: SNOWBALL_PROJECTILE_SPEED_MPS,
        active: true,
      },
    ];
    events.push({ type: 'snowball_launch', racerId: racer.id, projectileId });
  } else if (itemToUse === 'snow_trap') {
    const trapId = `trap_${nextEntitySerial}`;
    nextEntitySerial += 1;
    const dropDistM = clamp(racer.distanceM - TRAP_DROP_BEHIND_M, 2, COURSE_LENGTH_M - 4);
    const newTrap: SnowRushTrap = {
      id: trapId,
      ownerId: racer.id,
      distanceM: dropDistM,
      laneOffset: clamp(
        racer.laneOffset,
        -TRACK_SAFE_LANE_LIMIT + TRAP_HALF_WIDTH_LANE,
        TRACK_SAFE_LANE_LIMIT - TRAP_HALF_WIDTH_LANE
      ),
      halfLengthM: TRAP_HALF_LENGTH_M,
      halfWidthLane: TRAP_HALF_WIDTH_LANE,
      remainingSec: TRAP_MAX_LIFETIME_SEC,
      ageSec: 0,
      active: true,
    };
    const activeTraps = traps.filter((t) => t.active);
    traps =
      activeTraps.length >= MAX_ACTIVE_TRAPS
        ? [...activeTraps.slice(activeTraps.length - MAX_ACTIVE_TRAPS + 1), newTrap]
        : [...activeTraps, newTrap];
    events.push({ type: 'trap_place', racerId: racer.id, trapId });
  } else if (itemToUse === 'ice_shield') {
    updatedRacer = {
      ...updatedRacer,
      shieldTimerSec: ICE_SHIELD_DURATION_SEC,
      shieldBreakAnimTimerSec: 0,
    };
    events.push({ type: 'shield_activate', racerId: racer.id });
  }

  return {
    racer: updatedRacer,
    projectiles,
    traps,
    nextEntitySerial,
    activated: true,
  };
}

function isRacerValidCombatTarget(target: CombatRacerMutableFields): boolean {
  if (target.finishTimeMs !== null || target.distanceM >= COURSE_LENGTH_M) return false;
  if (target.tumbleTimerSec > 0) return false;
  if (target.invulnerableTimerSec > 0) return false;
  if (target.mercyInvulnTimerSec > 0) return false;
  return true;
}

function applyShieldBlock<T extends CombatRacerMutableFields>(
  target: T,
  reason: 'snowball' | 'trap' | 'obstacle',
  events: SnowRushStepEvent[]
): T {
  events.push({ type: 'shield_break', racerId: target.id, reason });
  return {
    ...target,
    shieldTimerSec: 0,
    shieldBreakAnimTimerSec: SHIELD_BREAK_ANIM_DURATION_SEC,
    shieldBlocksCount: target.shieldBlocksCount + 1,
  };
}

export function applyShieldObstacleBlock<T extends CombatRacerMutableFields>(
  racer: T,
  events: SnowRushStepEvent[]
): T {
  return applyShieldBlock(racer, 'obstacle', events);
}

/**
 * Advances active Snowball projectiles for one substep and evaluates world-coordinate hits.
 * - Speed: 34 m/s forward.
 * - Max Range: 180m (despawns with miss event/burst).
 * - Misses airborne (`isJumping`) racers.
 * - Blocked by active `Ice Shield` (breaks shield immediately, 0 slow).
 * - Single-hit only: deactivated immediately upon hit or block.
 */
export function stepProjectilesSubstep<
  TPlayer extends CombatRacerMutableFields,
  TBot extends CombatRacerMutableFields,
>(params: {
  projectiles: SnowRushProjectile[];
  player: TPlayer;
  bots: TBot[];
  showOfflineBots: boolean;
  subDtSec: number;
  nextEntitySerial: number;
  visualBursts: SnowRushVisualBurst[];
  events: SnowRushStepEvent[];
}): {
  projectiles: SnowRushProjectile[];
  player: TPlayer;
  bots: TBot[];
  nextEntitySerial: number;
  visualBursts: SnowRushVisualBurst[];
} {
  let { player, bots, nextEntitySerial, visualBursts } = params;
  const { projectiles, showOfflineBots, subDtSec, events } = params;
  if (projectiles.length === 0) {
    return { projectiles, player, bots, nextEntitySerial, visualBursts };
  }

  const nextProjectiles: SnowRushProjectile[] = [];
  const nextBots = showOfflineBots ? [...bots] : bots;

  const incrementAttackerLanded = (ownerId: string) => {
    if (player.id === ownerId) {
      player = { ...player, attacksLandedCount: player.attacksLandedCount + 1 };
      return;
    }
    if (showOfflineBots) {
      for (let bIdx = 0; bIdx < nextBots.length; bIdx += 1) {
        if (nextBots[bIdx].id === ownerId) {
          nextBots[bIdx] = {
            ...nextBots[bIdx],
            attacksLandedCount: nextBots[bIdx].attacksLandedCount + 1,
          };
          break;
        }
      }
    }
  };

  for (let i = 0; i < projectiles.length; i += 1) {
    const proj = projectiles[i];
    if (!proj.active) continue;

    const prevDistM = proj.distanceM;
    const rawNextDistM = prevDistM + proj.speedMps * subDtSec;
    const maxAllowedDistM = proj.startDistanceM + proj.maxRangeM;
    const clampedNextDistM = Math.min(rawNextDistM, maxAllowedDistM);

    const segMin = Math.min(prevDistM, clampedNextDistM) - 0.55;
    const segMax = Math.max(prevDistM, clampedNextDistM) + 0.55;

    // Collect candidate targets sorted by distanceM ascending so nearest target is hit first
    interface TargetRef {
      kind: 'player' | 'bot';
      botIdx: number;
      racer: CombatRacerMutableFields;
    }
    const candidates: TargetRef[] = [];
    if (player.id !== proj.ownerId) {
      candidates.push({ kind: 'player', botIdx: -1, racer: player });
    }
    if (showOfflineBots) {
      for (let bIdx = 0; bIdx < nextBots.length; bIdx += 1) {
        if (nextBots[bIdx].id !== proj.ownerId) {
          candidates.push({ kind: 'bot', botIdx: bIdx, racer: nextBots[bIdx] });
        }
      }
    }
    candidates.sort((a, b) => a.racer.distanceM - b.racer.distanceM);

    let consumed = false;

    for (let cIdx = 0; cIdx < candidates.length; cIdx += 1) {
      const cand = candidates[cIdx];
      const target = cand.racer;

      if (!isRacerValidCombatTarget(target)) continue;

      // Airborne racers cleanly leap over low-skimming snowballs
      if (target.isJumping) continue;

      const targetMin = target.distanceM - RACER_COLLISION_HALF_LENGTH_M;
      const targetMax = target.distanceM + RACER_COLLISION_HALF_LENGTH_M;
      if (segMax < targetMin || segMin > targetMax) continue;

      const lateralGap = Math.abs(target.laneOffset - proj.laneOffset);
      if (lateralGap > SNOWBALL_HIT_HALF_LANE + RACER_COLLISION_HALF_LANE) continue;

      // Hit or Shield Block!
      consumed = true;
      if (target.shieldTimerSec > 0) {
        visualBursts = appendVisualBurst(
          visualBursts,
          nextEntitySerial++,
          'shield_break',
          target.distanceM,
          target.laneOffset,
          SHIELD_BREAK_ANIM_DURATION_SEC
        );
        if (cand.kind === 'player') {
          player = applyShieldBlock(player, 'snowball', events);
        } else {
          nextBots[cand.botIdx] = applyShieldBlock(nextBots[cand.botIdx], 'snowball', events);
        }
      } else {
        const effectiveMult =
          target.nitroTimerSec > 0 ? NITRO_HIT_DAMP_MULT : SNOWBALL_HIT_SPEED_MULT;
        const dampedSpeed =
          target.nitroTimerSec > 0
            ? Math.max(18.5, target.speedMps * NITRO_HIT_DAMP_MULT)
            : Math.min(target.speedMps, BASE_MAX_SPEED_MPS * SNOWBALL_HIT_SPEED_MULT);

        visualBursts = appendVisualBurst(
          visualBursts,
          nextEntitySerial++,
          'snowball_hit',
          target.distanceM,
          target.laneOffset,
          0.44
        );
        events.push({
          type: 'snowball_hit',
          attackerId: proj.ownerId,
          targetId: target.id,
        });
        incrementAttackerLanded(proj.ownerId);

        if (cand.kind === 'player') {
          player = {
            ...player,
            speedMps: dampedSpeed,
            attackSlowTimerSec: SNOWBALL_HIT_SLOW_SEC,
            attackSpeedMult: effectiveMult,
            mercyInvulnTimerSec: MERCY_INVULN_DURATION_SEC,
            attacksTakenCount: player.attacksTakenCount + 1,
          };
        } else {
          const hitBot = nextBots[cand.botIdx];
          nextBots[cand.botIdx] = {
            ...hitBot,
            speedMps: dampedSpeed,
            attackSlowTimerSec: SNOWBALL_HIT_SLOW_SEC,
            attackSpeedMult: effectiveMult,
            mercyInvulnTimerSec: MERCY_INVULN_DURATION_SEC,
            attacksTakenCount: hitBot.attacksTakenCount + 1,
          };
        }
      }
      break;
    }

    if (consumed) {
      continue;
    }

    if (rawNextDistM >= maxAllowedDistM || clampedNextDistM >= COURSE_LENGTH_M + 12) {
      // Reached 180m max range without hitting any racer -> despawn cleanly
      visualBursts = appendVisualBurst(
        visualBursts,
        nextEntitySerial++,
        'snowball_miss',
        clampedNextDistM,
        proj.laneOffset,
        0.3
      );
      events.push({ type: 'snowball_miss', ownerId: proj.ownerId });
      continue;
    }

    nextProjectiles.push({
      ...proj,
      distanceM: clampedNextDistM,
    });
  }

  return {
    projectiles: nextProjectiles,
    player,
    bots: nextBots,
    nextEntitySerial,
    visualBursts,
  };
}

/**
 * Steps placed Snow Traps (lifetime decay + single-target collision).
 * - Placer never hits their own freshly dropped trap.
 * - Jumpable (`isJumping && jumpHeightPx >= TRAP_JUMP_CLEARANCE_PX`).
 * - Blockable by `Ice Shield`.
 * - Single-hit removal + bounded lifetime (`18s`) prevents infinite object accumulation.
 */
export function stepTrapsSubstep<
  TPlayer extends CombatRacerMutableFields,
  TBot extends CombatRacerMutableFields,
>(params: {
  traps: SnowRushTrap[];
  player: TPlayer;
  prevPlayerDistM: number;
  bots: TBot[];
  prevBotDistsM: readonly number[];
  showOfflineBots: boolean;
  subDtSec: number;
  nextEntitySerial: number;
  visualBursts: SnowRushVisualBurst[];
  events: SnowRushStepEvent[];
}): {
  traps: SnowRushTrap[];
  player: TPlayer;
  bots: TBot[];
  nextEntitySerial: number;
  visualBursts: SnowRushVisualBurst[];
} {
  let { player, nextEntitySerial, visualBursts } = params;
  const {
    traps,
    prevPlayerDistM,
    bots,
    prevBotDistsM,
    showOfflineBots,
    subDtSec,
    events,
  } = params;

  if (traps.length === 0) {
    return { traps, player, bots, nextEntitySerial, visualBursts };
  }

  const nextTraps: SnowRushTrap[] = [];
  const nextBots = showOfflineBots ? [...bots] : bots;

  const incrementOwnerLanded = (ownerId: string) => {
    if (player.id === ownerId) {
      player = { ...player, attacksLandedCount: player.attacksLandedCount + 1 };
      return;
    }
    if (showOfflineBots) {
      for (let bIdx = 0; bIdx < nextBots.length; bIdx += 1) {
        if (nextBots[bIdx].id === ownerId) {
          nextBots[bIdx] = {
            ...nextBots[bIdx],
            attacksLandedCount: nextBots[bIdx].attacksLandedCount + 1,
          };
          break;
        }
      }
    }
  };

  for (let i = 0; i < traps.length; i += 1) {
    const trap = traps[i];
    if (!trap.active) continue;

    const remainingSec = trap.remainingSec - subDtSec;
    const ageSec = trap.ageSec + subDtSec;
    if (remainingSec <= 0) {
      continue;
    }

    const trapMinM = trap.distanceM - trap.halfLengthM;
    const trapMaxM = trap.distanceM + trap.halfLengthM;

    interface TrapCandidate {
      kind: 'player' | 'bot';
      botIdx: number;
      prevDistM: number;
      racer: CombatRacerMutableFields;
    }
    const candidates: TrapCandidate[] = [
      { kind: 'player', botIdx: -1, prevDistM: prevPlayerDistM, racer: player },
    ];
    if (showOfflineBots) {
      for (let bIdx = 0; bIdx < nextBots.length; bIdx += 1) {
        candidates.push({
          kind: 'bot',
          botIdx: bIdx,
          prevDistM: prevBotDistsM[bIdx] ?? nextBots[bIdx].distanceM,
          racer: nextBots[bIdx],
        });
      }
    }

    let triggered = false;
    for (let cIdx = 0; cIdx < candidates.length; cIdx += 1) {
      const cand = candidates[cIdx];
      const target = cand.racer;

      // Placer never immediately triggers their own trap
      if (target.id === trap.ownerId && ageSec < TRAP_SELF_SAFE_AGE_SEC) {
        continue;
      }

      if (!isRacerValidCombatTarget(target)) continue;

      // Airborne jump avoids trap cleanly
      if (target.isJumping && target.jumpHeightPx >= TRAP_JUMP_CLEARANCE_PX) {
        continue;
      }

      const segMin = Math.min(cand.prevDistM, target.distanceM) - RACER_COLLISION_HALF_LENGTH_M;
      const segMax = Math.max(cand.prevDistM, target.distanceM) + RACER_COLLISION_HALF_LENGTH_M;
      if (segMax < trapMinM || segMin > trapMaxM) continue;

      const lateralGap = Math.abs(target.laneOffset - trap.laneOffset);
      if (lateralGap > trap.halfWidthLane + RACER_COLLISION_HALF_LANE) continue;

      // Single-target trigger confirmed!
      triggered = true;

      if (target.shieldTimerSec > 0) {
        visualBursts = appendVisualBurst(
          visualBursts,
          nextEntitySerial++,
          'shield_break',
          trap.distanceM,
          trap.laneOffset,
          SHIELD_BREAK_ANIM_DURATION_SEC
        );
        if (cand.kind === 'player') {
          player = applyShieldBlock(player, 'trap', events);
        } else {
          nextBots[cand.botIdx] = applyShieldBlock(nextBots[cand.botIdx], 'trap', events);
        }
      } else {
        const effectiveMult =
          target.nitroTimerSec > 0 ? NITRO_HIT_DAMP_MULT : TRAP_SLIP_SPEED_MULT;
        const slippedSpeed =
          target.nitroTimerSec > 0
            ? Math.max(18.5, target.speedMps * NITRO_HIT_DAMP_MULT)
            : Math.min(target.speedMps, BASE_MAX_SPEED_MPS * TRAP_SLIP_SPEED_MULT);
        const wobbleDir = target.laneOffset >= trap.laneOffset ? 1 : -1;

        visualBursts = appendVisualBurst(
          visualBursts,
          nextEntitySerial++,
          'trap_hit',
          trap.distanceM,
          trap.laneOffset,
          0.44
        );
        events.push({
          type: 'trap_hit',
          ownerId: trap.ownerId,
          targetId: target.id,
        });
        if (trap.ownerId !== target.id) {
          incrementOwnerLanded(trap.ownerId);
        }

        if (cand.kind === 'player') {
          player = {
            ...player,
            speedMps: slippedSpeed,
            spinTimerSec:
              player.nitroTimerSec > 0
                ? player.spinTimerSec
                : Math.max(player.spinTimerSec, TRAP_SLIP_PENALTY_SEC),
            attackSlowTimerSec: TRAP_SLIP_PENALTY_SEC,
            attackSpeedMult: effectiveMult,
            lateralVelocity: clamp(
              player.lateralVelocity + wobbleDir * 0.42,
              -MAX_LATERAL_VELOCITY,
              MAX_LATERAL_VELOCITY
            ),
            mercyInvulnTimerSec: MERCY_INVULN_DURATION_SEC,
            attacksTakenCount: player.attacksTakenCount + 1,
          };
        } else {
          const hitBot = nextBots[cand.botIdx];
          nextBots[cand.botIdx] = {
            ...hitBot,
            speedMps: slippedSpeed,
            spinTimerSec:
              hitBot.nitroTimerSec > 0
                ? hitBot.spinTimerSec
                : Math.max(hitBot.spinTimerSec, TRAP_SLIP_PENALTY_SEC),
            attackSlowTimerSec: TRAP_SLIP_PENALTY_SEC,
            attackSpeedMult: effectiveMult,
            lateralVelocity: clamp(
              hitBot.lateralVelocity + wobbleDir * 0.42,
              -MAX_LATERAL_VELOCITY,
              MAX_LATERAL_VELOCITY
            ),
            mercyInvulnTimerSec: MERCY_INVULN_DURATION_SEC,
            attacksTakenCount: hitBot.attacksTakenCount + 1,
          };
        }
      }
      break;
    }

    if (!triggered) {
      nextTraps.push({
        ...trap,
        remainingSec,
        ageSec,
      });
    }
  }

  return {
    traps: nextTraps,
    player,
    bots: nextBots,
    nextEntitySerial,
    visualBursts,
  };
}

/**
 * Contextual Offline Demo Bot Item AI decision helper:
 * - Respects 0.4s arming delay + brief organic reaction window.
 * - Uses Nitro Boost on clear straightaways or when recovering/trailing.
 * - Fires Snowball ONLY when an active target is ahead within [4m, 168m] and aligned in lane.
 * - Places Snow Trap when another active racer is trailing behind or mid-course.
 * - Activates Ice Shield when threatened by an incoming snowball behind, nearby rival, or obstacle cluster.
 */
export function shouldOfflineBotUseHeldItem(params: {
  bot: OfflineDemoBotState;
  otherActiveRacers: readonly {
    id: string;
    distanceM: number;
    laneOffset: number;
    finishTimeMs: number | null;
    tumbleTimerSec: number;
  }[];
  projectiles: readonly SnowRushProjectile[];
  obstacles: readonly SnowRushObstacle[];
}): boolean {
  const { bot, otherActiveRacers, projectiles, obstacles } = params;
  if (
    bot.heldItem === null ||
    bot.itemArmingTimerSec > 0 ||
    bot.botItemReadyDelaySec > 0 ||
    bot.finishTimeMs !== null ||
    bot.distanceM >= COURSE_LENGTH_M ||
    bot.tumbleTimerSec > 0
  ) {
    return false;
  }

  if (bot.heldItem === 'nitro_boost') {
    // Check that no tall unjumpable obstacle is directly in front within 10m
    for (let i = 0; i < obstacles.length; i += 1) {
      const obs = obstacles[i];
      const aheadM = obs.distanceM - bot.distanceM;
      if (aheadM < 0.5) continue;
      if (aheadM > 10.5) break;
      if (
        (obs.kind === 'pine_tree' || obs.kind === 'slalom_gate') &&
        Math.abs(obs.laneOffset - bot.laneOffset) < 0.2
      ) {
        return false;
      }
    }
    return true;
  }

  if (bot.heldItem === 'snowball_attack') {
    // Strictly fire ONLY when a valid target is ahead within range & lane tolerance
    return otherActiveRacers.some((rival) => {
      if (rival.id === bot.id || rival.finishTimeMs !== null || rival.tumbleTimerSec > 0) {
        return false;
      }
      const aheadM = rival.distanceM - bot.distanceM;
      const laneDelta = Math.abs(rival.laneOffset - bot.laneOffset);
      return aheadM >= 3.5 && aheadM <= SNOWBALL_MAX_RANGE_M - 8 && laneDelta <= 0.21;
    });
  }

  if (bot.heldItem === 'snow_trap') {
    // Drop trap when another active racer is behind within 75m (or near final stretch > 220m if closely contested)
    const hasTrailingRival = otherActiveRacers.some((rival) => {
      if (rival.id === bot.id || rival.finishTimeMs !== null) return false;
      const behindM = bot.distanceM - rival.distanceM;
      return behindM >= 2.0 && behindM <= 85.0;
    });
    return hasTrailingRival;
  }

  if (bot.heldItem === 'ice_shield') {
    if (bot.shieldTimerSec > 0.6) return false;

    const incomingSnowball = projectiles.some(
      (p) =>
        p.active &&
        p.ownerId !== bot.id &&
        p.distanceM < bot.distanceM &&
        bot.distanceM - p.distanceM <= 48 &&
        Math.abs(p.laneOffset - bot.laneOffset) <= 0.26
    );
    if (incomingSnowball) return true;

    const closeRival = otherActiveRacers.some(
      (r) =>
        r.id !== bot.id &&
        r.finishTimeMs === null &&
        Math.abs(r.distanceM - bot.distanceM) <= 28
    );
    if (closeRival) return true;

    const obstacleAhead = obstacles.some(
      (obs) =>
        obs.distanceM > bot.distanceM + 2 &&
        obs.distanceM <= bot.distanceM + 16 &&
        obs.kind !== 'jump_ramp' &&
        obs.kind !== 'ice_patch'
    );
    return obstacleAhead;
  }

  return false;
}
