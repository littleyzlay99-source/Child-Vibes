import {
  ICE_PATCH_CLEARANCE_HEIGHT_PX,
  ITEM_BOX_OBSTACLE_CLEARANCE_M,
  ITEM_BOX_ROW_DISTANCES_M,
  MIN_OPEN_LANES_PER_ROW,
  ROCK_CLEARANCE_HEIGHT_PX,
  SNOW_MOUND_CLEARANCE_HEIGHT_PX,
  TRACK_LANE_CENTERS,
  TRACK_OBSTACLE_END_M,
  TRACK_OBSTACLE_START_M,
  TRACK_SAFE_LANE_LIMIT,
} from './constants';
import { generateDeterministicItemBoxes } from './items';
import type {
  SlalomBarrierSpan,
  SnowRushObstacle,
  SnowRushObstacleKind,
  SnowRushTrackLayout,
} from './types';

export const DEFAULT_FALLBACK_TRACK_SEED = 20260403;

/**
 * Normalizes any numeric seed into a non-zero unsigned 32-bit integer.
 */
export function normalizeTrackSeed(seed?: number): number {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    return DEFAULT_FALLBACK_TRACK_SEED;
  }
  const normalized = (Math.floor(Math.abs(seed)) >>> 0) || DEFAULT_FALLBACK_TRACK_SEED;
  return normalized;
}

/**
 * Generates a fresh non-deterministic 32-bit seed when starting a new local race
 * without an explicit seed override.
 */
export function createRandomTrackSeed(): number {
  const rand = Math.floor(Math.random() * 0x7ffffffe) + 1;
  return normalizeTrackSeed(rand ^ (Date.now() & 0x7fffffff));
}

/**
 * Pure Mulberry32 deterministic PRNG returning floats in [0, 1).
 */
export function createSeededPrng(seed: number): () => number {
  let state = normalizeTrackSeed(seed);
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

function isNearItemBoxStation(distanceM: number): number | null {
  for (let i = 0; i < ITEM_BOX_ROW_DISTANCES_M.length; i += 1) {
    const stationM = ITEM_BOX_ROW_DISTANCES_M[i];
    if (Math.abs(distanceM - stationM) < ITEM_BOX_OBSTACLE_CLEARANCE_M) {
      return stationM;
    }
  }
  return null;
}

interface ObstacleDimensions {
  halfLengthM: number;
  halfWidthLane: number;
  jumpable: boolean;
  clearanceHeightPx: number;
}

function getObstacleDimensions(kind: SnowRushObstacleKind): ObstacleDimensions {
  switch (kind) {
    case 'pine_tree':
      return {
        halfLengthM: 1.55,
        halfWidthLane: 0.115,
        jumpable: false,
        clearanceHeightPx: Number.POSITIVE_INFINITY,
      };
    case 'rock':
      return {
        halfLengthM: 1.45,
        halfWidthLane: 0.11,
        jumpable: true,
        clearanceHeightPx: ROCK_CLEARANCE_HEIGHT_PX,
      };
    case 'snow_mound':
      return {
        halfLengthM: 1.65,
        halfWidthLane: 0.125,
        jumpable: true,
        clearanceHeightPx: SNOW_MOUND_CLEARANCE_HEIGHT_PX,
      };
    case 'ice_patch':
      return {
        halfLengthM: 3.1,
        halfWidthLane: 0.155,
        jumpable: true,
        clearanceHeightPx: ICE_PATCH_CLEARANCE_HEIGHT_PX,
      };
    case 'jump_ramp':
      return {
        halfLengthM: 2.2,
        halfWidthLane: 0.135,
        jumpable: false,
        clearanceHeightPx: Number.POSITIVE_INFINITY,
      };
    case 'slalom_gate':
      return {
        halfLengthM: 1.4,
        halfWidthLane: TRACK_SAFE_LANE_LIMIT,
        jumpable: false,
        clearanceHeightPx: Number.POSITIVE_INFINITY,
      };
  }
}

const WAVE_CYCLE_KINDS: readonly SnowRushObstacleKind[] = [
  'pine_tree',
  'rock',
  'snow_mound',
  'ice_patch',
  'jump_ramp',
  'slalom_gate',
  'pine_tree',
  'rock',
  'snow_mound',
  'jump_ramp',
];

function buildSlalomGateObstacle(
  id: string,
  rowIndex: number,
  distanceM: number,
  rng: () => number,
  prevGateStartIdx: number | null
): { obstacle: SnowRushObstacle; gateStartIdx: number } {
  // Choose 2 adjacent open lanes out of the 5 lanes (indices [0,1], [1,2], [2,3], or [3,4])
  // Guarantees >= 1 clear slalom opening AND >= 2 full open lane widths!
  const candidateStarts = [0, 1, 2, 3].filter((idx) => idx !== prevGateStartIdx);
  const startIdx = candidateStarts[Math.floor(rng() * candidateStarts.length)];
  const openIdxA = startIdx;
  const openIdxB = startIdx + 1;
  const openLaneCenters = [TRACK_LANE_CENTERS[openIdxA], TRACK_LANE_CENTERS[openIdxB]];

  const openMin = TRACK_LANE_CENTERS[openIdxA] - 0.16;
  const openMax = TRACK_LANE_CENTERS[openIdxB] + 0.16;
  const outerLimit = TRACK_SAFE_LANE_LIMIT + 0.08;

  const blockedSpans: SlalomBarrierSpan[] = [];
  if (openMin > -outerLimit + 0.06) {
    blockedSpans.push({ minLane: -outerLimit, maxLane: openMin });
  }
  if (openMax < outerLimit - 0.06) {
    blockedSpans.push({ minLane: openMax, maxLane: outerLimit });
  }

  const dims = getObstacleDimensions('slalom_gate');
  return {
    gateStartIdx: startIdx,
    obstacle: {
      id,
      rowIndex,
      kind: 'slalom_gate',
      distanceM,
      halfLengthM: dims.halfLengthM,
      laneOffset: 0,
      halfWidthLane: dims.halfWidthLane,
      jumpable: false,
      clearanceHeightPx: dims.clearanceHeightPx,
      blockedSpans,
      openCenterLane: (openMin + openMax) / 2,
      openHalfWidthLane: (openMax - openMin) / 2,
      openLaneCenters,
    },
  };
}

/**
 * Generates a deterministic, passable 1,500m obstacle + Item Box layout from `seed`.
 * - Same `seed` -> identical obstacle & itemBox arrays.
 * - Different `seed` -> different obstacle & itemBox lane placements.
 * - Every obstacle row leaves at least `MIN_OPEN_LANES_PER_ROW` (2) passable lanes open.
 * - Includes all 6 required obstacle types across the 1,500m (`COURSE_LENGTH_M`) course.
 * - Keeps obstacles clear of all 10 deterministic Item Box stations (`ITEM_BOX_ROW_DISTANCES_M`).
 */
export function generateSnowRushTrack(seed?: number): SnowRushTrackLayout {
  const effectiveSeed = normalizeTrackSeed(seed);
  const rng = createSeededPrng(effectiveSeed);

  const obstacles: SnowRushObstacle[] = [];
  let cursorM = TRACK_OBSTACLE_START_M + Math.round(rng() * 8 * 10) / 10;
  let rowIndex = 0;
  let deck: SnowRushObstacleKind[] = [];
  let prevGateStartIdx: number | null = null;
  let nextObstacleSerial = 1;

  while (cursorM <= TRACK_OBSTACLE_END_M) {
    // Keep a clean plaza around deterministic Item Box rows
    const conflictingStation = isNearItemBoxStation(cursorM);
    if (conflictingStation !== null) {
      cursorM = conflictingStation + ITEM_BOX_OBSTACLE_CLEARANCE_M + 0.6;
      if (cursorM > TRACK_OBSTACLE_END_M) break;
    }

    if (deck.length === 0) {
      deck = shuffleDeterministic(WAVE_CYCLE_KINDS, rng);
    }
    const primaryKind = deck.pop()!;
    const rowDistanceM = Math.round(cursorM * 10) / 10;

    if (primaryKind === 'slalom_gate') {
      const { obstacle, gateStartIdx } = buildSlalomGateObstacle(
        `obs_${nextObstacleSerial}_slalom_gate`,
        rowIndex,
        rowDistanceM,
        rng,
        prevGateStartIdx
      );
      nextObstacleSerial += 1;
      prevGateStartIdx = gateStartIdx;
      obstacles.push(obstacle);
      rowIndex += 1;
      cursorM += 24 + rng() * 5.5;
      continue;
    }

    const totalLanes = TRACK_LANE_CENTERS.length; // 5
    const maxAllowedObstacles = Math.max(1, totalLanes - MIN_OPEN_LANES_PER_ROW); // 3

    let countInRow = 2;
    if (primaryKind === 'jump_ramp' || primaryKind === 'ice_patch') {
      countInRow = rng() < 0.55 ? 2 : 1;
    } else {
      const roll = rng();
      countInRow = roll < 0.25 ? 1 : roll < 0.78 ? 2 : maxAllowedObstacles;
    }
    countInRow = Math.min(countInRow, maxAllowedObstacles);

    const laneIndices = shuffleDeterministic([0, 1, 2, 3, 4], rng);
    const occupiedIndices = laneIndices.slice(0, countInRow).sort((a, b) => a - b);
    const openIndices = laneIndices.slice(countInRow).sort((a, b) => a - b);
    const openLaneCenters = openIndices.map((idx) => TRACK_LANE_CENTERS[idx]);

    const secondaryPool: readonly SnowRushObstacleKind[] = [
      'pine_tree',
      'rock',
      'snow_mound',
      'ice_patch',
    ];

    occupiedIndices.forEach((laneIdx, slotIdx) => {
      const kind: SnowRushObstacleKind =
        slotIdx === 0
          ? primaryKind
          : secondaryPool[Math.floor(rng() * secondaryPool.length)];
      const dims = getObstacleDimensions(kind);
      const rawJitterM = slotIdx === 0 ? 0 : Math.round((rng() - 0.5) * 2.2 * 10) / 10;
      const candidateObsM = Math.min(
        TRACK_OBSTACLE_END_M,
        Math.max(TRACK_OBSTACLE_START_M, rowDistanceM + rawJitterM)
      );
      const finalObsM =
        isNearItemBoxStation(candidateObsM) !== null ? rowDistanceM : candidateObsM;

      const jitterLane = Math.round((rng() - 0.5) * 0.03 * 1000) / 1000;
      const laneOffset = Math.max(
        -TRACK_SAFE_LANE_LIMIT + dims.halfWidthLane,
        Math.min(
          TRACK_SAFE_LANE_LIMIT - dims.halfWidthLane,
          TRACK_LANE_CENTERS[laneIdx] + jitterLane
        )
      );

      obstacles.push({
        id: `obs_${nextObstacleSerial}_${kind}`,
        rowIndex,
        kind,
        distanceM: finalObsM,
        halfLengthM: dims.halfLengthM,
        laneOffset,
        halfWidthLane: dims.halfWidthLane,
        jumpable: dims.jumpable,
        clearanceHeightPx: dims.clearanceHeightPx,
        openLaneCenters,
      });
      nextObstacleSerial += 1;
    });

    // Bonus combo: 40% of Jump Ramps place a jumpable Rock or Snow Mound ~9.2m ahead if clear of Item Box row
    const comboDistanceM = Math.round((rowDistanceM + 9.2) * 10) / 10;
    if (
      primaryKind === 'jump_ramp' &&
      cursorM + 12 <= TRACK_OBSTACLE_END_M &&
      isNearItemBoxStation(comboDistanceM) === null &&
      rng() < 0.4
    ) {
      const rampLaneIdx = occupiedIndices[0];
      const comboKind: SnowRushObstacleKind = rng() < 0.5 ? 'rock' : 'snow_mound';
      const comboDims = getObstacleDimensions(comboKind);
      const comboOpenCenters = [0, 1, 2, 3, 4]
        .filter((idx) => idx !== rampLaneIdx)
        .map((idx) => TRACK_LANE_CENTERS[idx]);

      obstacles.push({
        id: `obs_${nextObstacleSerial}_${comboKind}`,
        rowIndex: rowIndex + 0.5,
        kind: comboKind,
        distanceM: comboDistanceM,
        halfLengthM: comboDims.halfLengthM,
        laneOffset: TRACK_LANE_CENTERS[rampLaneIdx],
        halfWidthLane: comboDims.halfWidthLane,
        jumpable: true,
        clearanceHeightPx: comboDims.clearanceHeightPx,
        openLaneCenters: comboOpenCenters,
      });
      nextObstacleSerial += 1;
      cursorM += 4.5;
    }

    rowIndex += 1;
    cursorM += 20.5 + rng() * 4.8;
  }

  obstacles.sort((a, b) => a.distanceM - b.distanceM);
  const itemBoxes = generateDeterministicItemBoxes(effectiveSeed);

  return {
    seed: effectiveSeed,
    obstacles,
    itemBoxes,
  };
}
