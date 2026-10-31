import {
  AVALANCHE_BASE_SPEED_MPS,
  AVALANCHE_CATCHUP_MAX_GAP_M,
  AVALANCHE_INITIAL_DISTANCE_M,
  AVALANCHE_MAX_SPEED_MPS,
  AVALANCHE_SAFE_GRACE_SEC,
  BASE_MAX_SPEED_MPS,
  COUNTDOWN_DURATION_SEC,
  COURSE_LENGTH_M,
  ITEM_ARMING_DELAY_SEC,
  JUMP_DURATION_SEC,
  JUMP_PEAK_HEIGHT_PX,
  MAX_COLLISION_SUBSTEP_SEC,
  MAX_LATERAL_VELOCITY,
  MAX_SIMULATION_DT_SEC,
  MERCY_INVULN_DURATION_SEC,
  MIN_START_PUSH_MPS,
  MULTIPLAYER_DEFAULT_RACER_COLORS,
  MULTIPLAYER_MAX_PLAYERS,
  MULTIPLAYER_MIN_PLAYERS,
  MULTIPLAYER_OBSTACLE_MEMORY_BEHIND_M,
  MULTIPLAYER_TICK_DT_SEC,
  NITRO_HIT_DAMP_MULT,
  POST_WINNER_FINISH_WINDOW_SEC,
  RACER_COLLISION_HALF_LANE,
  RACER_COLLISION_HALF_LENGTH_M,
  SHIELD_BREAK_ANIM_DURATION_SEC,
  SNOWBALL_HIT_HALF_LANE,
  SNOWBALL_HIT_SLOW_SEC,
  SNOWBALL_HIT_SPEED_MULT,
  SNOW_TUMBLE_MAX_RECOVERY_M,
  SNOW_TUMBLE_RECOVERY_AHEAD_M,
  STARTING_GRID_LANES_2P,
  STARTING_GRID_LANES_3P,
  STARTING_GRID_LANES_4P,
  TRACK_SAFE_LANE_LIMIT,
  TRAP_JUMP_CLEARANCE_PX,
  TRAP_SELF_SAFE_AGE_SEC,
  TRAP_SLIP_PENALTY_SEC,
  TRAP_SLIP_SPEED_MULT,
} from '../constants';
import {
  cloneTrackItemBoxes,
  computeLiveRacerRank,
  rollDeterministicBattleItem,
  tryActivateRacerHeldItem,
} from '../items';
import {
  computeAvalancheWarning,
  createInitialAvalancheState,
  pickNearestSafeLaneAtDistance,
  resolveCoreRacerStatus,
  stepCoreRacerSubstep,
  triggerSnowTumble,
} from '../simulation';
import {
  createRandomTrackSeed,
  generateSnowRushTrack,
  normalizeTrackSeed,
} from '../track';
import type {
  AvalancheState,
  SnowRushInputState,
  SnowRushItemBox,
  SnowRushObstacle,
  SnowRushProjectile,
  SnowRushStepEvent,
  SnowRushTrap,
} from '../types';
import type {
  AuthoritativeRacerState,
  MultiplayerInputPayload,
  MultiplayerItemBoxStatus,
  MultiplayerPlayerInit,
  MultiplayerRaceEvent,
  MultiplayerRacePhase,
  MultiplayerRaceState,
  MultiplayerRacerSnapshot,
  RaceFinishReason,
  RaceFinishState,
  RaceStanding,
  SnowRushInputFrame,
  SnowRushSnapshot,
  SnowRushSteerAxis,
  StartingGridSlot,
} from './multiplayerTypes';

/**
 * Snow Rush: Avalanche Escape — Step 4.6 Shared Multi-Racer Simulation Core
 *
 * Pure TypeScript 2–4 Human Player Authoritative Engine:
 * - Zero Browser / DOM / Canvas / Web Audio / React / Firebase dependencies.
 * - Reuses `stepCoreRacerSubstep`, `tryActivateRacerHeldItem`, `generateSnowRushTrack`,
 *   `rollDeterministicBattleItem`, `triggerSnowTumble`, and `pickNearestSafeLaneAtDistance`
 *   as a single source of truth shared with Step 4.2–4.4 Local Simulation.
 * - Deterministic tie-breaking independent of JS object property insertion order or join order.
 */

const TIE_EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) {
    return Math.min(target, current + maxDelta);
  }
  return Math.max(target, current - maxDelta);
}

/**
 * Deterministic unsigned 32-bit FNV-1a + avalanche mix hash for stable UID ordering.
 */
export function hashStableUid(uid: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < uid.length; i += 1) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Deterministic unsigned 32-bit tie-break hash combining `trackSeed`, `serverTick`, and `uid`.
 */
export function hashSeedTickUid(trackSeed: number, serverTick: number, uid: string): number {
  const uidHash = hashStableUid(uid);
  let h =
    ((normalizeTrackSeed(trackSeed) >>> 0) ^
      Math.imul((Math.floor(serverTick) >>> 0) + 0x9e3779b9, 0x7feb352d) ^
      Math.imul(uidHash ^ 0x5bd1e995, 0x846ca68b)) >>>
    0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function compareDeterministicUidTieBreak(
  trackSeed: number,
  serverTick: number,
  uidA: string,
  uidB: string
): number {
  if (uidA === uidB) return 0;
  const hashA = hashSeedTickUid(trackSeed, serverTick, uidA);
  const hashB = hashSeedTickUid(trackSeed, serverTick, uidB);
  if (hashA !== hashB) {
    return hashA < hashB ? -1 : 1;
  }
  return uidA < uidB ? -1 : 1;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSteerAxis(rawSteer: unknown): SnowRushSteerAxis {
  if (rawSteer === -1 || rawSteer === 1 || rawSteer === 0) {
    return rawSteer;
  }
  if (typeof rawSteer === 'number' && Number.isFinite(rawSteer)) {
    if (rawSteer < -0.25) return -1;
    if (rawSteer > 0.25) return 1;
  }
  return 0;
}

/**
 * Sanitizes untrusted client input payloads into a strict `SnowRushInputFrame`.
 * Explicitly ignores any client-claimed state fields (`distanceM`, `speedMps`,
 * `laneOffset`, `heldItem`, `pickedBoxId`, `hitTargetId`, `winnerId`, `finishTimeMs`, etc.).
 */
export function sanitizeClientInputPayload(raw: unknown): SnowRushInputFrame | null {
  if (!isRecordObject(raw)) {
    return null;
  }

  let steer: SnowRushSteerAxis = 0;
  if ('steer' in raw) {
    steer = normalizeSteerAxis(raw.steer);
  } else if ('steerLeft' in raw || 'steerRight' in raw) {
    const left = Boolean(raw.steerLeft);
    const right = Boolean(raw.steerRight);
    steer = ((right ? 1 : 0) - (left ? 1 : 0)) as SnowRushSteerAxis;
  }

  const jumpPressed = Boolean(raw.jumpPressed);
  const useItemPressed = Boolean(raw.useItemPressed);

  const rawSeq = raw.seq;
  if (typeof rawSeq !== 'number' || !Number.isFinite(rawSeq) || rawSeq < 0) {
    return null;
  }

  return {
    steer,
    jumpPressed,
    useItemPressed,
    seq: Math.floor(rawSeq),
  };
}

interface NormalizedTickInput {
  readonly steer: SnowRushSteerAxis;
  readonly jumpPressed: boolean;
  readonly useItemPressed: boolean;
  readonly seq: number | null;
}

function normalizeTickInputEntry(raw: unknown): NormalizedTickInput | null {
  if (!isRecordObject(raw)) {
    return null;
  }

  // Strip all untrusted fields by reading ONLY steer/jump/item/seq
  let steer: SnowRushSteerAxis = 0;
  if ('steer' in raw) {
    steer = normalizeSteerAxis(raw.steer);
  } else {
    const left = Boolean(raw.steerLeft);
    const right = Boolean(raw.steerRight);
    steer = ((right ? 1 : 0) - (left ? 1 : 0)) as SnowRushSteerAxis;
  }

  const jumpPressed = Boolean(raw.jumpPressed);
  const useItemPressed = Boolean(raw.useItemPressed);

  let seq: number | null = null;
  if (typeof raw.seq === 'number' && Number.isFinite(raw.seq) && raw.seq >= 0) {
    seq = Math.floor(raw.seq);
  }

  return {
    steer,
    jumpPressed,
    useItemPressed,
    seq,
  };
}

function getStartingLanesForPlayerCount(playerCount: number): readonly number[] {
  if (playerCount === 2) return STARTING_GRID_LANES_2P;
  if (playerCount === 3) return STARTING_GRID_LANES_3P;
  if (playerCount === 4) return STARTING_GRID_LANES_4P;
  throw new Error(
    `Snow Rush Multiplayer requires ${MULTIPLAYER_MIN_PLAYERS}–${MULTIPLAYER_MAX_PLAYERS} players (received ${playerCount}).`
  );
}

/**
 * Assigns non-overlapping starting grid lanes for 2–4 human players:
 * - 2 Players: `[-0.32, +0.32]`
 * - 3 Players: `[-0.48, 0, +0.48]`
 * - 4 Players: `[-0.64, -0.22, +0.22, +0.64]`
 *
 * Uses deterministic `(trackSeed, uid)` hashing so:
 * 1. Device join order / array element order has ZERO effect on starting lanes.
 * 2. Host (`slot 0` in room lobby) NEVER receives hardcoded lane bias.
 * 3. Identical `(players, trackSeed)` ALWAYS produces the exact same starting grid.
 */
export function createStartingGrid(
  players: readonly MultiplayerPlayerInit[],
  trackSeed: number
): StartingGridSlot[] {
  if (
    players.length < MULTIPLAYER_MIN_PLAYERS ||
    players.length > MULTIPLAYER_MAX_PLAYERS
  ) {
    throw new Error(
      `Snow Rush Multiplayer supports ${MULTIPLAYER_MIN_PLAYERS}–${MULTIPLAYER_MAX_PLAYERS} human players (received ${players.length}).`
    );
  }

  const normalizedSeed = normalizeTrackSeed(trackSeed);
  const seenUids = new Set<string>();
  const sanitizedPlayers = players.map((p) => {
    const uid = p.uid.trim();
    if (!uid) {
      throw new Error('Every Snow Rush multiplayer participant must have a non-empty uid.');
    }
    if (seenUids.has(uid)) {
      throw new Error(`Duplicate player uid "${uid}" in Snow Rush starting grid.`);
    }
    seenUids.add(uid);
    return {
      uid,
      displayName: p.displayName.trim() || uid,
      requestedColor: p.color?.trim() || null,
    };
  });

  // Sort deterministically by (trackSeed, uid) — completely independent of join/lobby order
  const ordered = [...sanitizedPlayers].sort((a, b) =>
    compareDeterministicUidTieBreak(normalizedSeed, 0, a.uid, b.uid)
  );

  const lanes = getStartingLanesForPlayerCount(ordered.length);

  return ordered.map((entry, slotIndex) => ({
    uid: entry.uid,
    displayName: entry.displayName,
    color:
      entry.requestedColor ??
      MULTIPLAYER_DEFAULT_RACER_COLORS[slotIndex % MULTIPLAYER_DEFAULT_RACER_COLORS.length],
    slotIndex,
    laneOffset: clamp(lanes[slotIndex], -TRACK_SAFE_LANE_LIMIT, TRACK_SAFE_LANE_LIMIT),
  }));
}

function createInitialAuthoritativeRacer(slot: StartingGridSlot): AuthoritativeRacerState {
  return {
    id: slot.uid,
    uid: slot.uid,
    displayName: slot.displayName,
    color: slot.color,
    slotIndex: slot.slotIndex,
    isConnected: true,
    lastSteerAxis: 0,
    lastProcessedInputSeq: 0,
    distanceM: 0,
    laneOffset: slot.laneOffset,
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
    rampLaunchCount: 0,
    scarfPhase: slot.slotIndex * 0.65,
    finishTimeMs: null,
    finishRank: null,
    activeStatus: 'normal',
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

/**
 * Returns canonical sorted UID list independent of `Object.keys(racers)` insertion order.
 */
function getCanonicalRacerUids(
  racers: Readonly<Record<string, AuthoritativeRacerState>>
): string[] {
  return Object.keys(racers).sort((uidA, uidB) => {
    const rA = racers[uidA];
    const rB = racers[uidB];
    if (rA.slotIndex !== rB.slotIndex) {
      return rA.slotIndex - rB.slotIndex;
    }
    return uidA < uidB ? -1 : uidA > uidB ? 1 : 0;
  });
}

function prunePassedObstacleIds(
  interactedIds: readonly string[],
  racerDistanceM: number,
  obstacles: readonly SnowRushObstacle[]
): string[] {
  if (interactedIds.length === 0) return [];
  const minKeepDistanceM = racerDistanceM - MULTIPLAYER_OBSTACLE_MEMORY_BEHIND_M;
  const keepSet = new Set<string>();
  for (let i = 0; i < obstacles.length; i += 1) {
    const obs = obstacles[i];
    if (obs.distanceM < minKeepDistanceM) continue;
    if (obs.distanceM > racerDistanceM + 10) break;
    keepSet.add(obs.id);
  }
  const pruned = interactedIds.filter((id) => keepSet.has(id));
  return pruned.length === interactedIds.length ? [...interactedIds] : pruned;
}

/**
 * Computes deterministic 1-based standings across all 2–4 racers:
 * 1. Finished racers (`finishTimeMs !== null`) sort ahead of unfinished racers,
 *    ordered by locked `finishRank` -> `finishTimeMs` ascending -> deterministic seed+UID tie-break.
 * 2. Unfinished racers sort by `distanceM` descending -> `speedMps` descending -> deterministic seed+UID tie-break.
 */
export function computeRaceStandings(
  state: Pick<MultiplayerRaceState, 'racers' | 'trackSeed' | 'serverTick'>
): RaceStanding[] {
  const uids = getCanonicalRacerUids(state.racers);
  const racersList = uids.map((uid) => state.racers[uid]);

  racersList.sort((a, b) => {
    const aFinished = a.finishTimeMs !== null;
    const bFinished = b.finishTimeMs !== null;
    if (aFinished !== bFinished) {
      return aFinished ? -1 : 1;
    }

    if (aFinished && bFinished) {
      if (a.finishRank !== null && b.finishRank !== null && a.finishRank !== b.finishRank) {
        return a.finishRank - b.finishRank;
      }
      const timeDiff = (a.finishTimeMs ?? 0) - (b.finishTimeMs ?? 0);
      if (Math.abs(timeDiff) > TIE_EPSILON) {
        return timeDiff;
      }
      return compareDeterministicUidTieBreak(state.trackSeed, 0, a.uid, b.uid);
    }

    const distDiff = b.distanceM - a.distanceM;
    if (Math.abs(distDiff) > TIE_EPSILON) {
      return distDiff;
    }

    const speedDiff = b.speedMps - a.speedMps;
    if (Math.abs(speedDiff) > TIE_EPSILON) {
      return speedDiff;
    }

    return compareDeterministicUidTieBreak(state.trackSeed, state.serverTick, a.uid, b.uid);
  });

  return racersList.map((racer, idx) => ({
    uid: racer.uid,
    displayName: racer.displayName,
    color: racer.color,
    slotIndex: racer.slotIndex,
    rank: idx + 1,
    finished: racer.finishTimeMs !== null,
    finishTimeMs: racer.finishTimeMs,
    distanceM: racer.distanceM,
    speedMps: racer.speedMps,
    topSpeedMps: racer.topSpeedMps,
    obstacleHitCount: racer.obstacleHitCount,
    tumbleCount: racer.tumbleCount,
    itemsPickedUpCount: racer.itemsPickedUpCount,
    itemsUsedCount: racer.itemsUsedCount,
    shieldBlocksCount: racer.shieldBlocksCount,
    attacksLandedCount: racer.attacksLandedCount,
    attacksTakenCount: racer.attacksTakenCount,
  }));
}

/**
 * Creates the initial authoritative `MultiplayerRaceState` for 2–4 human players.
 */
export function createInitialMultiplayerRaceState(options: {
  players: readonly MultiplayerPlayerInit[];
  trackSeed?: number;
  initialPhase?: 'ready' | 'countdown';
}): MultiplayerRaceState {
  const trackSeed =
    options.trackSeed !== undefined
      ? normalizeTrackSeed(options.trackSeed)
      : createRandomTrackSeed();
  const track = generateSnowRushTrack(trackSeed);
  const grid = createStartingGrid(options.players, trackSeed);

  const racers: Record<string, AuthoritativeRacerState> = {};
  const ackSeqByUid: Record<string, number> = {};
  const racerOrder: string[] = [];

  for (let i = 0; i < grid.length; i += 1) {
    const slot = grid[i];
    racers[slot.uid] = createInitialAuthoritativeRacer(slot);
    ackSeqByUid[slot.uid] = 0;
    racerOrder.push(slot.uid);
  }

  const initialStandings = computeRaceStandings({
    racers,
    trackSeed,
    serverTick: 0,
  });

  const phase: MultiplayerRacePhase = options.initialPhase ?? 'ready';
  const events: MultiplayerRaceEvent[] =
    phase === 'countdown' ? [{ type: 'countdown_started', trackSeed }] : [];

  return {
    serverTick: 0,
    phase,
    countdownRemainingSec: COUNTDOWN_DURATION_SEC,
    elapsedRaceMs: 0,
    trackSeed,
    track,
    racers,
    racerOrder,
    itemBoxes: cloneTrackItemBoxes(track.itemBoxes),
    projectiles: [],
    traps: [],
    avalanche: createInitialAvalancheState(),
    nextEntitySerial: 1,
    ackSeqByUid,
    finishState: {
      winnerId: null,
      winnerFinishTimeMs: null,
      postWinnerWindowDurationSec: POST_WINNER_FINISH_WINDOW_SEC,
      postWinnerRemainingSec: null,
      finalized: false,
      finishReason: null,
      finalizedAtElapsedMs: null,
      standings: initialStandings,
    },
    events,
  };
}

/**
 * Starts (or restarts) the synchronized pre-race `3..2..1..GO!` countdown across all racers.
 */
export function startMultiplayerCountdown(
  prevState: MultiplayerRaceState,
  options?: { trackSeed?: number }
): MultiplayerRaceState {
  const canonicalUids = getCanonicalRacerUids(prevState.racers);
  const players: MultiplayerPlayerInit[] = canonicalUids.map((uid) => ({
    uid,
    displayName: prevState.racers[uid].displayName,
    color: prevState.racers[uid].color,
  }));

  return createInitialMultiplayerRaceState({
    players,
    trackSeed: options?.trackSeed ?? prevState.trackSeed,
    initialPhase: 'countdown',
  });
}

/**
 * Updates connection flag for a specific racer without halting the simulation loop.
 * Disconnected racers neutralize active steering (`lastSteerAxis = 0`) and continue safely.
 */
export function setMultiplayerRacerConnection(
  state: MultiplayerRaceState,
  uid: string,
  isConnected: boolean
): MultiplayerRaceState {
  const existing = state.racers[uid];
  if (!existing) {
    return state;
  }

  const canonicalUids = getCanonicalRacerUids(state.racers);
  const nextRacers: Record<string, AuthoritativeRacerState> = {};
  for (let i = 0; i < canonicalUids.length; i += 1) {
    const key = canonicalUids[i];
    if (key === uid) {
      nextRacers[key] = {
        ...existing,
        isConnected,
        lastSteerAxis: isConnected ? existing.lastSteerAxis : 0,
      };
    } else {
      nextRacers[key] = state.racers[key];
    }
  }

  return {
    ...state,
    racers: nextRacers,
  };
}

/**
 * Resolves simultaneous Item Box pickups across 2–4 racers with strict 3-tier deterministic tie-breaking:
 * 1. Earliest crossing fraction into the Item Box entry boundary.
 * 2. Closest lateral proximity to `box.laneOffset` center.
 * 3. Deterministic `(trackSeed, serverTick, uid)` hash (with lexical UID fallback).
 *
 * Guarantees:
 * - One Item Box can NEVER be picked up by two racers.
 * - A racer with a full inventory (`heldItem !== null`) neither overwrites their item nor consumes the box.
 * - Picked-up items enter the 1-slot inventory with `0.4s` arming delay and NEVER auto-activate.
 */
export function resolveSimultaneousItemPickup(params: {
  racers: Record<string, AuthoritativeRacerState>;
  prevDistancesByUid: Readonly<Record<string, number>>;
  itemBoxes: SnowRushItemBox[];
  trackSeed: number;
  serverTick: number;
  nextEntitySerial: number;
  events: MultiplayerRaceEvent[];
}): {
  racers: Record<string, AuthoritativeRacerState>;
  itemBoxes: SnowRushItemBox[];
  nextEntitySerial: number;
} {
  const { prevDistancesByUid, trackSeed, serverTick, events } = params;
  let { nextEntitySerial } = params;

  const canonicalUids = getCanonicalRacerUids(params.racers);
  const nextRacers: Record<string, AuthoritativeRacerState> = {};
  for (let i = 0; i < canonicalUids.length; i += 1) {
    const uid = canonicalUids[i];
    nextRacers[uid] = params.racers[uid];
  }

  const allLiveDistances = canonicalUids.map((uid) => nextRacers[uid].distanceM);
  const totalRacers = canonicalUids.length;
  let nextBoxes = params.itemBoxes;
  let boxesCopied = false;

  for (let boxIdx = 0; boxIdx < nextBoxes.length; boxIdx += 1) {
    const box = nextBoxes[boxIdx];
    if (box.pickedUpByRacerId !== null) continue;

    const boxEntryM = box.distanceM - box.halfLengthM - RACER_COLLISION_HALF_LENGTH_M;
    const boxExitM = box.distanceM + box.halfLengthM + RACER_COLLISION_HALF_LENGTH_M;

    interface BoxPickupCandidate {
      uid: string;
      entryTimeScore: number;
      lateralDistToCenter: number;
    }

    const candidates: BoxPickupCandidate[] = [];

    for (let uIdx = 0; uIdx < canonicalUids.length; uIdx += 1) {
      const uid = canonicalUids[uIdx];
      const racer = nextRacers[uid];

      if (
        racer.heldItem !== null ||
        racer.finishTimeMs !== null ||
        racer.distanceM >= COURSE_LENGTH_M ||
        racer.tumbleTimerSec > 0
      ) {
        continue;
      }

      const prevDistM = prevDistancesByUid[uid] ?? racer.distanceM;
      const segMinM = Math.min(prevDistM, racer.distanceM);
      const segMaxM = Math.max(prevDistM, racer.distanceM);

      if (segMaxM < boxEntryM || segMinM > boxExitM) {
        continue;
      }

      const lateralDistToCenter = Math.abs(racer.laneOffset - box.laneOffset);
      if (lateralDistToCenter > box.halfWidthLane + RACER_COLLISION_HALF_LANE) {
        continue;
      }

      const travelM = Math.max(0, racer.distanceM - prevDistM);
      const entryTimeScore =
        prevDistM >= boxEntryM
          ? -(prevDistM - boxEntryM) / Math.max(1, BASE_MAX_SPEED_MPS)
          : travelM > TIE_EPSILON
          ? (boxEntryM - prevDistM) / travelM
          : 1;

      candidates.push({
        uid,
        entryTimeScore,
        lateralDistToCenter,
      });
    }

    if (candidates.length === 0) {
      continue;
    }

    candidates.sort((a, b) => {
      const timeDiff = a.entryTimeScore - b.entryTimeScore;
      if (Math.abs(timeDiff) > TIE_EPSILON) {
        return timeDiff;
      }

      const lateralDiff = a.lateralDistToCenter - b.lateralDistToCenter;
      if (Math.abs(lateralDiff) > TIE_EPSILON) {
        return lateralDiff;
      }

      return compareDeterministicUidTieBreak(trackSeed, serverTick, a.uid, b.uid);
    });

    const winnerUid = candidates[0].uid;
    const winnerRacer = nextRacers[winnerUid];
    const pickupOrdinal = nextEntitySerial;
    nextEntitySerial += 1;

    const liveRank = computeLiveRacerRank(winnerRacer.distanceM, allLiveDistances);
    const rolledItem = rollDeterministicBattleItem(
      trackSeed,
      boxIdx + 1,
      pickupOrdinal,
      liveRank,
      totalRacers
    );

    if (!boxesCopied) {
      nextBoxes = [...nextBoxes];
      boxesCopied = true;
    }
    nextBoxes[boxIdx] = {
      ...box,
      pickedUpByRacerId: winnerUid,
    };

    nextRacers[winnerUid] = {
      ...winnerRacer,
      heldItem: rolledItem,
      itemArmingTimerSec: ITEM_ARMING_DELAY_SEC,
      itemsPickedUpCount: winnerRacer.itemsPickedUpCount + 1,
    };

    events.push({
      type: 'item_pickup',
      uid: winnerUid,
      itemId: rolledItem,
      boxId: box.id,
    });
  }

  return {
    racers: nextRacers,
    itemBoxes: nextBoxes,
    nextEntitySerial,
  };
}

function isRacerEligibleForMultiplayerCombat(racer: AuthoritativeRacerState): boolean {
  if (racer.finishTimeMs !== null || racer.distanceM >= COURSE_LENGTH_M) return false;
  if (racer.tumbleTimerSec > 0) return false;
  if (racer.invulnerableTimerSec > 0) return false;
  if (racer.mercyInvulnTimerSec > 0) return false;
  return true;
}

/**
 * Resolves Snowball Projectiles and Snow Traps across all 2–4 human racers deterministically:
 * - Projectiles never hit their owner, skip airborne (`isJumping`) racers, hit at most 1 nearest valid target,
 *   shatter active Ice Shields with 0 slow, apply `0.9s` slow + `2.0s` Mercy Invulnerability on unshielded hit,
 *   and despawn cleanly at `180 m` max range.
 * - Traps never immediately hit their placer (`ageSec < TRAP_SELF_SAFE_AGE_SEC`), can be jumped over,
 *   shatter active Ice Shields with 0 slow/spin, apply `0.9s` slip/spin + `2.0s` Mercy Invulnerability on hit,
 *   and expire cleanly after `18.0 s`.
 */
export function resolveMultiplayerCollisions(params: {
  racers: Record<string, AuthoritativeRacerState>;
  prevDistancesByUid: Readonly<Record<string, number>>;
  projectiles: SnowRushProjectile[];
  traps: SnowRushTrap[];
  subDtSec: number;
  trackSeed: number;
  serverTick: number;
  events: MultiplayerRaceEvent[];
}): {
  racers: Record<string, AuthoritativeRacerState>;
  projectiles: SnowRushProjectile[];
  traps: SnowRushTrap[];
} {
  const { prevDistancesByUid, subDtSec, trackSeed, serverTick, events } = params;
  const canonicalUids = getCanonicalRacerUids(params.racers);

  const nextRacers: Record<string, AuthoritativeRacerState> = {};
  for (let i = 0; i < canonicalUids.length; i += 1) {
    const uid = canonicalUids[i];
    nextRacers[uid] = params.racers[uid];
  }

  const incrementAttackerLanded = (ownerId: string) => {
    const attacker = nextRacers[ownerId];
    if (attacker) {
      nextRacers[ownerId] = {
        ...attacker,
        attacksLandedCount: attacker.attacksLandedCount + 1,
      };
    }
  };

  // 1. Resolve Snowball Projectiles
  const nextProjectiles: SnowRushProjectile[] = [];
  for (let pIdx = 0; pIdx < params.projectiles.length; pIdx += 1) {
    const proj = params.projectiles[pIdx];
    if (!proj.active) continue;

    const prevProjDistM = proj.distanceM;
    const rawNextDistM = prevProjDistM + proj.speedMps * subDtSec;
    const maxAllowedDistM = proj.startDistanceM + proj.maxRangeM;
    const clampedNextDistM = Math.min(rawNextDistM, maxAllowedDistM);

    const segMinM = Math.min(prevProjDistM, clampedNextDistM) - 0.55;
    const segMaxM = Math.max(prevProjDistM, clampedNextDistM) + 0.55;

    interface ProjectileTargetCandidate {
      uid: string;
      distanceM: number;
      lateralGap: number;
    }

    const candidates: ProjectileTargetCandidate[] = [];
    for (let uIdx = 0; uIdx < canonicalUids.length; uIdx += 1) {
      const uid = canonicalUids[uIdx];
      if (uid === proj.ownerId) continue;

      const target = nextRacers[uid];
      if (!isRacerEligibleForMultiplayerCombat(target)) continue;
      if (target.isJumping) continue;

      const targetMinM = target.distanceM - RACER_COLLISION_HALF_LENGTH_M;
      const targetMaxM = target.distanceM + RACER_COLLISION_HALF_LENGTH_M;
      if (segMaxM < targetMinM || segMinM > targetMaxM) continue;

      const lateralGap = Math.abs(target.laneOffset - proj.laneOffset);
      if (lateralGap > SNOWBALL_HIT_HALF_LANE + RACER_COLLISION_HALF_LANE) continue;

      candidates.push({
        uid,
        distanceM: target.distanceM,
        lateralGap,
      });
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const distDiff = a.distanceM - b.distanceM;
        if (Math.abs(distDiff) > TIE_EPSILON) {
          return distDiff;
        }
        const latDiff = a.lateralGap - b.lateralGap;
        if (Math.abs(latDiff) > TIE_EPSILON) {
          return latDiff;
        }
        return compareDeterministicUidTieBreak(trackSeed, serverTick, a.uid, b.uid);
      });

      const hitUid = candidates[0].uid;
      const hitTarget = nextRacers[hitUid];

      if (hitTarget.shieldTimerSec > 0) {
        nextRacers[hitUid] = {
          ...hitTarget,
          shieldTimerSec: 0,
          shieldBreakAnimTimerSec: SHIELD_BREAK_ANIM_DURATION_SEC,
          shieldBlocksCount: hitTarget.shieldBlocksCount + 1,
          activeStatus: resolveCoreRacerStatus({
            ...hitTarget,
            shieldTimerSec: 0,
          }),
        };
        events.push({
          type: 'shield_break',
          uid: hitUid,
          reason: 'snowball',
        });
      } else {
        const effectiveMult =
          hitTarget.nitroTimerSec > 0 ? NITRO_HIT_DAMP_MULT : SNOWBALL_HIT_SPEED_MULT;
        const dampedSpeed =
          hitTarget.nitroTimerSec > 0
            ? Math.max(18.5, hitTarget.speedMps * NITRO_HIT_DAMP_MULT)
            : Math.min(hitTarget.speedMps, BASE_MAX_SPEED_MPS * SNOWBALL_HIT_SPEED_MULT);

        const updatedTarget: AuthoritativeRacerState = {
          ...hitTarget,
          speedMps: dampedSpeed,
          attackSlowTimerSec: SNOWBALL_HIT_SLOW_SEC,
          attackSpeedMult: effectiveMult,
          mercyInvulnTimerSec: MERCY_INVULN_DURATION_SEC,
          attacksTakenCount: hitTarget.attacksTakenCount + 1,
        };
        updatedTarget.activeStatus = resolveCoreRacerStatus(updatedTarget);
        nextRacers[hitUid] = updatedTarget;

        incrementAttackerLanded(proj.ownerId);
        events.push({
          type: 'snowball_hit',
          attackerId: proj.ownerId,
          targetId: hitUid,
        });
      }
      // Single-hit projectile despawns immediately
      continue;
    }

    if (rawNextDistM >= maxAllowedDistM || clampedNextDistM >= COURSE_LENGTH_M + 12) {
      events.push({
        type: 'snowball_miss',
        ownerId: proj.ownerId,
      });
      continue;
    }

    nextProjectiles.push({
      ...proj,
      distanceM: clampedNextDistM,
    });
  }

  // 2. Resolve Placed Snow Traps
  const nextTraps: SnowRushTrap[] = [];
  for (let tIdx = 0; tIdx < params.traps.length; tIdx += 1) {
    const trap = params.traps[tIdx];
    if (!trap.active) continue;

    const remainingSec = trap.remainingSec - subDtSec;
    const ageSec = trap.ageSec + subDtSec;
    if (remainingSec <= 0) {
      continue;
    }

    const trapEntryM = trap.distanceM - trap.halfLengthM - RACER_COLLISION_HALF_LENGTH_M;
    const trapExitM = trap.distanceM + trap.halfLengthM + RACER_COLLISION_HALF_LENGTH_M;

    interface TrapTargetCandidate {
      uid: string;
      entryTimeScore: number;
      lateralGap: number;
    }

    const trapCandidates: TrapTargetCandidate[] = [];
    for (let uIdx = 0; uIdx < canonicalUids.length; uIdx += 1) {
      const uid = canonicalUids[uIdx];
      const target = nextRacers[uid];

      if (uid === trap.ownerId && ageSec < TRAP_SELF_SAFE_AGE_SEC) {
        continue;
      }
      if (!isRacerEligibleForMultiplayerCombat(target)) {
        continue;
      }
      if (target.isJumping && target.jumpHeightPx >= TRAP_JUMP_CLEARANCE_PX) {
        continue;
      }

      const prevDistM = prevDistancesByUid[uid] ?? target.distanceM;
      const segMinM = Math.min(prevDistM, target.distanceM);
      const segMaxM = Math.max(prevDistM, target.distanceM);
      if (segMaxM < trapEntryM || segMinM > trapExitM) {
        continue;
      }

      const lateralGap = Math.abs(target.laneOffset - trap.laneOffset);
      if (lateralGap > trap.halfWidthLane + RACER_COLLISION_HALF_LANE) {
        continue;
      }

      const travelM = Math.max(0, target.distanceM - prevDistM);
      const entryTimeScore =
        prevDistM >= trapEntryM
          ? -(prevDistM - trapEntryM) / Math.max(1, BASE_MAX_SPEED_MPS)
          : travelM > TIE_EPSILON
          ? (trapEntryM - prevDistM) / travelM
          : 1;

      trapCandidates.push({
        uid,
        entryTimeScore,
        lateralGap,
      });
    }

    if (trapCandidates.length > 0) {
      trapCandidates.sort((a, b) => {
        const timeDiff = a.entryTimeScore - b.entryTimeScore;
        if (Math.abs(timeDiff) > TIE_EPSILON) {
          return timeDiff;
        }
        const latDiff = a.lateralGap - b.lateralGap;
        if (Math.abs(latDiff) > TIE_EPSILON) {
          return latDiff;
        }
        return compareDeterministicUidTieBreak(trackSeed, serverTick, a.uid, b.uid);
      });

      const hitUid = trapCandidates[0].uid;
      const hitTarget = nextRacers[hitUid];

      if (hitTarget.shieldTimerSec > 0) {
        nextRacers[hitUid] = {
          ...hitTarget,
          shieldTimerSec: 0,
          shieldBreakAnimTimerSec: SHIELD_BREAK_ANIM_DURATION_SEC,
          shieldBlocksCount: hitTarget.shieldBlocksCount + 1,
          activeStatus: resolveCoreRacerStatus({
            ...hitTarget,
            shieldTimerSec: 0,
          }),
        };
        events.push({
          type: 'shield_break',
          uid: hitUid,
          reason: 'trap',
        });
      } else {
        const effectiveMult =
          hitTarget.nitroTimerSec > 0 ? NITRO_HIT_DAMP_MULT : TRAP_SLIP_SPEED_MULT;
        const slippedSpeed =
          hitTarget.nitroTimerSec > 0
            ? Math.max(18.5, hitTarget.speedMps * NITRO_HIT_DAMP_MULT)
            : Math.min(hitTarget.speedMps, BASE_MAX_SPEED_MPS * TRAP_SLIP_SPEED_MULT);
        const wobbleDir = hitTarget.laneOffset >= trap.laneOffset ? 1 : -1;

        const updatedTarget: AuthoritativeRacerState = {
          ...hitTarget,
          speedMps: slippedSpeed,
          spinTimerSec:
            hitTarget.nitroTimerSec > 0
              ? hitTarget.spinTimerSec
              : Math.max(hitTarget.spinTimerSec, TRAP_SLIP_PENALTY_SEC),
          attackSlowTimerSec: TRAP_SLIP_PENALTY_SEC,
          attackSpeedMult: effectiveMult,
          lateralVelocity: clamp(
            hitTarget.lateralVelocity + wobbleDir * 0.42,
            -MAX_LATERAL_VELOCITY,
            MAX_LATERAL_VELOCITY
          ),
          mercyInvulnTimerSec: MERCY_INVULN_DURATION_SEC,
          attacksTakenCount: hitTarget.attacksTakenCount + 1,
        };
        updatedTarget.activeStatus = resolveCoreRacerStatus(updatedTarget);
        nextRacers[hitUid] = updatedTarget;

        if (trap.ownerId !== hitUid) {
          incrementAttackerLanded(trap.ownerId);
        }
        events.push({
          type: 'trap_hit',
          ownerId: trap.ownerId,
          targetId: hitUid,
        });
      }
      // Single-hit trap removed immediately
      continue;
    }

    nextTraps.push({
      ...trap,
      remainingSec,
      ageSec,
    });
  }

  return {
    racers: nextRacers,
    projectiles: nextProjectiles,
    traps: nextTraps,
  };
}

function translateActivationStepEvents(
  uid: string,
  stepEvents: readonly SnowRushStepEvent[],
  targetEvents: MultiplayerRaceEvent[]
): void {
  for (let i = 0; i < stepEvents.length; i += 1) {
    const ev = stepEvents[i];
    if (ev.type === 'player_item_empty') {
      targetEvents.push({ type: 'item_empty', uid });
    } else if (ev.type === 'nitro_activate') {
      targetEvents.push({ type: 'nitro_activate', uid: ev.racerId });
    } else if (ev.type === 'snowball_launch') {
      targetEvents.push({
        type: 'snowball_launch',
        uid: ev.racerId,
        projectileId: ev.projectileId,
      });
    } else if (ev.type === 'trap_place') {
      targetEvents.push({
        type: 'trap_place',
        uid: ev.racerId,
        trapId: ev.trapId,
      });
    } else if (ev.type === 'shield_activate') {
      targetEvents.push({ type: 'shield_activate', uid: ev.racerId });
    }
  }
}

/**
 * Finalizes an authoritative multiplayer race, locking final standings and immutable winnerId.
 */
export function finalizeMultiplayerRace(
  state: MultiplayerRaceState,
  reason: RaceFinishReason
): MultiplayerRaceState {
  if (state.phase === 'finished' && state.finishState.finalized) {
    return state;
  }

  const canonicalUids = getCanonicalRacerUids(state.racers);
  const finalizedRacers: Record<string, AuthoritativeRacerState> = {};

  for (let i = 0; i < canonicalUids.length; i += 1) {
    const uid = canonicalUids[i];
    const r = state.racers[uid];
    if (r.finishTimeMs !== null) {
      finalizedRacers[uid] = {
        ...r,
        distanceM: COURSE_LENGTH_M,
        lateralVelocity: 0,
        isJumping: false,
        jumpElapsedSec: 0,
        jumpHeightPx: 0,
        penaltyTimerSec: 0,
        spinTimerSec: 0,
        tumbleTimerSec: 0,
        invulnerableTimerSec: 0,
        mercyInvulnTimerSec: 0,
        nitroTimerSec: 0,
        shieldTimerSec: 0,
        attackSlowTimerSec: 0,
        activeStatus: 'normal',
      };
    } else {
      finalizedRacers[uid] = {
        ...r,
        lateralVelocity: 0,
        speedMps: 0,
        isJumping: false,
        jumpElapsedSec: 0,
        jumpHeightPx: 0,
        penaltyTimerSec: 0,
        spinTimerSec: 0,
        tumbleTimerSec: 0,
        invulnerableTimerSec: 0,
        mercyInvulnTimerSec: 0,
        nitroTimerSec: 0,
        shieldTimerSec: 0,
        attackSlowTimerSec: 0,
        activeStatus: 'normal',
      };
    }
  }

  const finalStandings = computeRaceStandings({
    racers: finalizedRacers,
    trackSeed: state.trackSeed,
    serverTick: state.serverTick,
  });

  // Preserve immutable first finisher if already locked; otherwise pick top finished standing
  const lockedWinnerId =
    state.finishState.winnerId ??
    (finalStandings[0]?.finished ? finalStandings[0].uid : finalStandings[0]?.uid ?? null);
  const lockedWinnerFinishTimeMs =
    state.finishState.winnerFinishTimeMs ??
    (lockedWinnerId ? finalizedRacers[lockedWinnerId]?.finishTimeMs ?? null : null);

  // Stamp final rank onto each racer
  for (let i = 0; i < finalStandings.length; i += 1) {
    const st = finalStandings[i];
    finalizedRacers[st.uid] = {
      ...finalizedRacers[st.uid],
      finishRank: finalizedRacers[st.uid].finishRank ?? st.rank,
    };
  }

  const nextFinishState: RaceFinishState = {
    winnerId: lockedWinnerId,
    winnerFinishTimeMs: lockedWinnerFinishTimeMs,
    postWinnerWindowDurationSec: POST_WINNER_FINISH_WINDOW_SEC,
    postWinnerRemainingSec: 0,
    finalized: true,
    finishReason: reason,
    finalizedAtElapsedMs: state.elapsedRaceMs,
    standings: finalStandings,
  };

  return {
    ...state,
    phase: 'finished',
    racers: finalizedRacers,
    projectiles: [],
    avalanche: {
      ...state.avalanche,
      speedMps: 0,
      warningLevel: 'safe',
    },
    finishState: nextFinishState,
    events: [
      ...state.events,
      {
        type: 'race_finalized',
        winnerId: lockedWinnerId,
        reason,
        standings: finalStandings,
      },
    ],
  };
}

/**
 * Advances the shared authoritative multi-racer Snow Rush simulation by one server tick
 * (defaults to `20 Hz` / `50 ms` = `0.05 s`, sub-stepped internally at `<= 1/120 s`).
 *
 * Security & Determinism Guarantees:
 * - Processes `inputsByUid` in canonical UID slot order (object key order has zero impact).
 * - Deduplicates `seq <= ackSeqByUid[uid]` frames so duplicate network packets never double-fire items or jumps.
 * - Explicitly ignores any untrusted client properties (`distanceM`, `speedMps`, `winnerId`, etc.).
 * - Locks first finisher (`winnerId`) immutably and runs `15.0s` post-winner finish window until all racers finish or timeout expires.
 */
export function stepMultiplayerSnowRushTick(
  state: MultiplayerRaceState,
  inputsByUid: Readonly<Record<string, MultiplayerInputPayload | unknown>> = {},
  rawDtSec: number = MULTIPLAYER_TICK_DT_SEC
): MultiplayerRaceState {
  const dtSec = clamp(Number.isFinite(rawDtSec) ? rawDtSec : 0, 0, MAX_SIMULATION_DT_SEC);
  if (dtSec <= 0) {
    return state.events.length === 0 ? state : { ...state, events: [] };
  }

  const nextServerTick = state.serverTick + 1;
  const canonicalUids = getCanonicalRacerUids(state.racers);
  const collectedEvents: MultiplayerRaceEvent[] = [];

  // Normalize & sequence-filter inputs in canonical UID order (never input object key order)
  const nextAckSeqByUid: Record<string, number> = {};
  const substepInputsByUid: Record<string, SnowRushInputState> = {};
  const nextRacersInit: Record<string, AuthoritativeRacerState> = {};

  for (let i = 0; i < canonicalUids.length; i += 1) {
    const uid = canonicalUids[i];
    const racer = state.racers[uid];
    const prevAckSeq = state.ackSeqByUid[uid] ?? racer.lastProcessedInputSeq ?? 0;
    nextAckSeqByUid[uid] = prevAckSeq;

    const rawEntry = Object.prototype.hasOwnProperty.call(inputsByUid, uid)
      ? inputsByUid[uid]
      : undefined;
    const parsed = rawEntry !== undefined ? normalizeTickInputEntry(rawEntry) : null;

    let effectiveSteer: SnowRushSteerAxis = racer.isConnected ? racer.lastSteerAxis : 0;
    let effectiveJump = false;
    let effectiveUseItem = false;
    let updatedLastSeq = prevAckSeq;

    if (parsed !== null && racer.isConnected) {
      if (parsed.seq !== null) {
        if (parsed.seq <= prevAckSeq) {
          // Duplicate or out-of-order stale frame -> ignore one-shot actions & steer overwrite
          collectedEvents.push({
            type: 'duplicate_input_ignored',
            uid,
            seq: parsed.seq,
            lastAckSeq: prevAckSeq,
          });
        } else {
          updatedLastSeq = parsed.seq;
          nextAckSeqByUid[uid] = parsed.seq;
          effectiveSteer = parsed.steer;
          effectiveJump = parsed.jumpPressed;
          effectiveUseItem = parsed.useItemPressed;
        }
      } else {
        // Unsequenced local/test `SnowRushInputState`
        effectiveSteer = parsed.steer;
        effectiveJump = parsed.jumpPressed;
        effectiveUseItem = parsed.useItemPressed;
      }
    }

    nextRacersInit[uid] = {
      ...racer,
      lastSteerAxis: effectiveSteer,
      lastProcessedInputSeq: updatedLastSeq,
    };

    substepInputsByUid[uid] = {
      steerLeft: effectiveSteer < 0,
      steerRight: effectiveSteer > 0,
      jumpPressed: effectiveJump,
      useItemPressed: effectiveUseItem,
    };
  }

  // Phase 1: 'ready' — gentle idle scarf motion
  if (state.phase === 'ready') {
    for (let i = 0; i < canonicalUids.length; i += 1) {
      const uid = canonicalUids[i];
      nextRacersInit[uid] = {
        ...nextRacersInit[uid],
        scarfPhase: nextRacersInit[uid].scarfPhase + dtSec * 3.2,
      };
    }
    return {
      ...state,
      serverTick: nextServerTick,
      racers: nextRacersInit,
      ackSeqByUid: nextAckSeqByUid,
      events: collectedEvents,
    };
  }

  // Phase 2: 'countdown' — synchronized 3..2..1..GO! launch into 'racing'
  if (state.phase === 'countdown') {
    const nextCountdown = Math.max(0, state.countdownRemainingSec - dtSec);

    for (let i = 0; i < canonicalUids.length; i += 1) {
      const uid = canonicalUids[i];
      const r = nextRacersInit[uid];
      const previewTilt = approach(r.carveTilt, r.lastSteerAxis * 0.35, dtSec * 5);

      if (nextCountdown <= 0) {
        nextRacersInit[uid] = {
          ...r,
          speedMps: MIN_START_PUSH_MPS,
          topSpeedMps: MIN_START_PUSH_MPS,
          carveTilt: previewTilt,
          scarfPhase: r.scarfPhase + dtSec * 6.0,
        };
      } else {
        nextRacersInit[uid] = {
          ...r,
          carveTilt: previewTilt,
          scarfPhase: r.scarfPhase + dtSec * 4.2,
        };
      }
    }

    if (nextCountdown <= 0) {
      collectedEvents.push({ type: 'race_started', serverTick: nextServerTick });
    }

    const standings = computeRaceStandings({
      racers: nextRacersInit,
      trackSeed: state.trackSeed,
      serverTick: nextServerTick,
    });

    return {
      ...state,
      serverTick: nextServerTick,
      phase: nextCountdown <= 0 ? 'racing' : 'countdown',
      countdownRemainingSec: nextCountdown,
      racers: nextRacersInit,
      ackSeqByUid: nextAckSeqByUid,
      finishState: {
        ...state.finishState,
        standings,
      },
      events: collectedEvents,
    };
  }

  // Phase 3: 'finished' — race results and winnerId are completely immutable
  if (state.phase === 'finished') {
    for (let i = 0; i < canonicalUids.length; i += 1) {
      const uid = canonicalUids[i];
      const r = nextRacersInit[uid];
      nextRacersInit[uid] = {
        ...r,
        speedMps: approach(r.speedMps, 0, 26 * dtSec),
        carveTilt: approach(r.carveTilt, 0, 5 * dtSec),
        scarfPhase: r.scarfPhase + dtSec * 3.6,
      };
    }
    return {
      ...state,
      serverTick: nextServerTick,
      racers: nextRacersInit,
      ackSeqByUid: nextAckSeqByUid,
      events: collectedEvents,
    };
  }

  // Phase 4: Active 'racing' or 'finish_window' — fixed internal sub-stepping prevents tunneling
  const substepCount = Math.max(1, Math.ceil(dtSec / MAX_COLLISION_SUBSTEP_SEC));
  const subDtSec = dtSec / substepCount;

  let elapsedRaceMs = state.elapsedRaceMs;
  let racers = nextRacersInit;
  let itemBoxes = state.itemBoxes;
  let projectiles = state.projectiles;
  let traps = state.traps;
  let avalanche: AvalancheState = state.avalanche;
  let nextEntitySerial = state.nextEntitySerial;
  let phase: MultiplayerRacePhase = state.phase;
  let winnerId: string | null = state.finishState.winnerId;
  let winnerFinishTimeMs: number | null = state.finishState.winnerFinishTimeMs;
  let postWinnerRemainingSec: number | null = state.finishState.postWinnerRemainingSec;
  let pendingFinalizeReason: RaceFinishReason | null = null;

  for (let stepIdx = 0; stepIdx < substepCount; stepIdx += 1) {
    const subStartMs = elapsedRaceMs;
    elapsedRaceMs += subDtSec * 1000;
    const elapsedRaceSec = elapsedRaceMs / 1000;

    // 4A. Manual Held Item Activation for each racer in canonical UID order
    for (let uIdx = 0; uIdx < canonicalUids.length; uIdx += 1) {
      const uid = canonicalUids[uIdx];
      const input = substepInputsByUid[uid];
      if (!input.useItemPressed) continue;

      substepInputsByUid[uid] = { ...input, useItemPressed: false };
      const localActEvents: SnowRushStepEvent[] = [];
      const actRes = tryActivateRacerHeldItem({
        racer: racers[uid],
        isLocalPlayer: true,
        projectiles,
        traps,
        nextEntitySerial,
        events: localActEvents,
      });
      racers = {
        ...racers,
        [uid]: {
          ...actRes.racer,
          activeStatus: resolveCoreRacerStatus(actRes.racer),
        },
      };
      projectiles = actRes.projectiles;
      traps = actRes.traps;
      nextEntitySerial = actRes.nextEntitySerial;
      translateActivationStepEvents(uid, localActEvents, collectedEvents);
    }

    // 4B. Step Downhill Movement, Jumps, Ramps, Ice Patches & Obstacles via shared `stepCoreRacerSubstep`
    const prevDistancesByUid: Record<string, number> = {};
    const recoveredByUid: Record<string, boolean> = {};
    const newlyFinishedCandidates: { uid: string; exactFinishTimeMs: number }[] = [];
    const steppedRacers: Record<string, AuthoritativeRacerState> = {};

    for (let uIdx = 0; uIdx < canonicalUids.length; uIdx += 1) {
      const uid = canonicalUids[uIdx];
      const racer = racers[uid];
      const wasFinished = racer.finishTimeMs !== null;
      const prevDistM = racer.distanceM;
      prevDistancesByUid[uid] = prevDistM;

      const input = substepInputsByUid[uid];
      const res = stepCoreRacerSubstep(
        racer,
        input,
        BASE_MAX_SPEED_MPS,
        subDtSec,
        elapsedRaceMs,
        avalanche.distanceM,
        state.track
      );

      if (res.manualJumped) {
        substepInputsByUid[uid] = { ...input, jumpPressed: false };
        collectedEvents.push({ type: 'racer_jump', uid, origin: 'manual' });
      }
      if (res.rampLaunched) {
        collectedEvents.push({ type: 'racer_jump', uid, origin: 'ramp' });
      }
      if (res.rampBoosted) {
        collectedEvents.push({ type: 'racer_ramp_boost', uid });
      }
      if (res.shieldBlockedObstacle) {
        collectedEvents.push({ type: 'shield_break', uid, reason: 'obstacle' });
      }
      for (let hIdx = 0; hIdx < res.hitObstacles.length; hIdx += 1) {
        collectedEvents.push({
          type: 'racer_obstacle_hit',
          uid,
          kind: res.hitObstacles[hIdx],
        });
      }

      recoveredByUid[uid] = res.recoveredFromTumble;

      let computedFinishTimeMs = racer.finishTimeMs;
      if (!wasFinished && res.fields.finishTimeMs !== null) {
        const stepTravelM = Math.max(TIE_EPSILON, res.fields.speedMps * subDtSec);
        const remainingToFinishM = clamp(COURSE_LENGTH_M - prevDistM, 0, stepTravelM);
        const fraction = clamp(remainingToFinishM / stepTravelM, 0, 1);
        computedFinishTimeMs = Number((subStartMs + fraction * subDtSec * 1000).toFixed(3));
        newlyFinishedCandidates.push({
          uid,
          exactFinishTimeMs: computedFinishTimeMs,
        });
      }

      const prunedInteractedIds = prunePassedObstacleIds(
        res.fields.interactedObstacleIds,
        res.fields.distanceM,
        state.track.obstacles
      );

      const updatedRacer: AuthoritativeRacerState = {
        ...racer,
        ...res.fields,
        finishTimeMs: wasFinished ? racer.finishTimeMs : computedFinishTimeMs,
        finishRank: racer.finishRank,
        topSpeedMps: Math.max(racer.topSpeedMps, res.fields.speedMps),
        jumpCount:
          racer.jumpCount + (res.manualJumped ? 1 : 0) + (res.rampLaunched ? 1 : 0),
        rampLaunchCount: racer.rampLaunchCount + (res.rampLaunched ? 1 : 0),
        interactedObstacleIds: prunedInteractedIds,
      };
      updatedRacer.activeStatus = resolveCoreRacerStatus(updatedRacer);
      steppedRacers[uid] = updatedRacer;
    }

    racers = steppedRacers;

    // Assign exact finish ranks to any racers who crossed 1,000m in this substep
    if (newlyFinishedCandidates.length > 0) {
      newlyFinishedCandidates.sort((a, b) => {
        const timeDiff = a.exactFinishTimeMs - b.exactFinishTimeMs;
        if (Math.abs(timeDiff) > TIE_EPSILON) {
          return timeDiff;
        }
        return compareDeterministicUidTieBreak(
          state.trackSeed,
          nextServerTick,
          a.uid,
          b.uid
        );
      });

      let alreadyFinishedCount = 0;
      for (let i = 0; i < canonicalUids.length; i += 1) {
        const r = racers[canonicalUids[i]];
        if (r.finishRank !== null) {
          alreadyFinishedCount += 1;
        }
      }

      for (let fIdx = 0; fIdx < newlyFinishedCandidates.length; fIdx += 1) {
        const finisher = newlyFinishedCandidates[fIdx];
        const assignedRank = alreadyFinishedCount + fIdx + 1;
        racers = {
          ...racers,
          [finisher.uid]: {
            ...racers[finisher.uid],
            finishRank: assignedRank,
          },
        };
        collectedEvents.push({
          type: 'racer_finished',
          uid: finisher.uid,
          finishTimeMs: finisher.exactFinishTimeMs,
          rank: assignedRank,
        });

        // Lock first finisher immutably!
        if (winnerId === null) {
          winnerId = finisher.uid;
          winnerFinishTimeMs = finisher.exactFinishTimeMs;
        }
      }
    }

    // 4C. Simultaneous Deterministic Item Box Pickup across all active racers
    const pickupRes = resolveSimultaneousItemPickup({
      racers,
      prevDistancesByUid,
      itemBoxes,
      trackSeed: state.trackSeed,
      serverTick: nextServerTick,
      nextEntitySerial,
      events: collectedEvents,
    });
    racers = pickupRes.racers;
    itemBoxes = pickupRes.itemBoxes;
    nextEntitySerial = pickupRes.nextEntitySerial;

    // 4D. Multi-Racer Combat Collisions (Snowballs & Placed Snow Traps)
    const combatRes = resolveMultiplayerCollisions({
      racers,
      prevDistancesByUid,
      projectiles,
      traps,
      subDtSec,
      trackSeed: state.trackSeed,
      serverTick: nextServerTick,
      events: collectedEvents,
    });
    racers = combatRes.racers;
    projectiles = combatRes.projectiles;
    traps = combatRes.traps;

    // 4E. Shared Authoritative Avalanche Chase & Snow Tumble Recovery
    const unfinishedDistances: number[] = [];
    for (let i = 0; i < canonicalUids.length; i += 1) {
      const r = racers[canonicalUids[i]];
      if (r.finishTimeMs === null && r.distanceM < COURSE_LENGTH_M) {
        unfinishedDistances.push(r.distanceM);
      }
    }

    let nextAvalancheDistM = avalanche.distanceM;
    let nextAvalancheSpeedMps = 0;
    let nextGraceSec = Math.max(0, AVALANCHE_SAFE_GRACE_SEC - elapsedRaceSec);
    let nextIsActive = false;

    if (elapsedRaceSec < AVALANCHE_SAFE_GRACE_SEC) {
      nextAvalancheDistM = AVALANCHE_INITIAL_DISTANCE_M;
      nextAvalancheSpeedMps = 0;
      nextIsActive = false;
    } else if (unfinishedDistances.length > 0) {
      nextGraceSec = 0;
      nextIsActive = true;
      const trailingRacerDistM = Math.min(...unfinishedDistances);
      const gapToTrailingM = trailingRacerDistM - avalanche.distanceM;
      const catchupFactor = clamp((gapToTrailingM - 60) / 55, 0, 1);
      const computedSpeed =
        AVALANCHE_BASE_SPEED_MPS +
        catchupFactor * (AVALANCHE_MAX_SPEED_MPS - AVALANCHE_BASE_SPEED_MPS);
      nextAvalancheSpeedMps = clamp(computedSpeed, 0, AVALANCHE_MAX_SPEED_MPS);

      nextAvalancheDistM = avalanche.distanceM + nextAvalancheSpeedMps * subDtSec;

      if (trailingRacerDistM - nextAvalancheDistM > AVALANCHE_CATCHUP_MAX_GAP_M) {
        nextAvalancheDistM = trailingRacerDistM - AVALANCHE_CATCHUP_MAX_GAP_M;
      }

      nextAvalancheDistM = Math.min(COURSE_LENGTH_M - 15, nextAvalancheDistM);
    } else {
      nextGraceSec = 0;
      nextIsActive = false;
      nextAvalancheSpeedMps = 0;
    }

    // Align recovered racers +25m ahead of end-of-substep Avalanche (strictly <= 995m, never false finish)
    for (let i = 0; i < canonicalUids.length; i += 1) {
      const uid = canonicalUids[i];
      if (!recoveredByUid[uid]) continue;

      const r = racers[uid];
      const alignedRecoveryM = clamp(
        Math.max(r.distanceM, nextAvalancheDistM + SNOW_TUMBLE_RECOVERY_AHEAD_M),
        0,
        SNOW_TUMBLE_MAX_RECOVERY_M
      );
      const safeSpot = pickNearestSafeLaneAtDistance(
        r.laneOffset,
        alignedRecoveryM,
        state.track.obstacles
      );
      const mergedGuarded =
        safeSpot.guardedIds.length > 0
          ? prunePassedObstacleIds(
              Array.from(new Set([...r.interactedObstacleIds, ...safeSpot.guardedIds])),
              alignedRecoveryM,
              state.track.obstacles
            )
          : r.interactedObstacleIds;

      const recoveredRacer: AuthoritativeRacerState = {
        ...r,
        distanceM: alignedRecoveryM,
        laneOffset: safeSpot.laneOffset,
        interactedObstacleIds: mergedGuarded,
      };
      recoveredRacer.activeStatus = resolveCoreRacerStatus(recoveredRacer);
      racers = {
        ...racers,
        [uid]: recoveredRacer,
      };
      collectedEvents.push({
        type: 'racer_recovery',
        uid,
        distanceM: alignedRecoveryM,
        laneOffset: safeSpot.laneOffset,
      });
    }

    // Snow Tumble Catch Check — Ice Shield NEVER blocks the Avalanche; finished racers are 100% immune
    if (nextIsActive) {
      for (let i = 0; i < canonicalUids.length; i += 1) {
        const uid = canonicalUids[i];
        const r = racers[uid];
        if (
          r.finishTimeMs === null &&
          r.distanceM < COURSE_LENGTH_M &&
          r.tumbleTimerSec <= 0 &&
          r.invulnerableTimerSec <= 0 &&
          nextAvalancheDistM >= r.distanceM
        ) {
          const tumbled = triggerSnowTumble(r);
          tumbled.activeStatus = resolveCoreRacerStatus(tumbled);
          racers = {
            ...racers,
            [uid]: tumbled,
          };
          collectedEvents.push({ type: 'racer_snow_tumble', uid });
        }
      }
    }

    // Compute shared Avalanche warning relative to trailing unfinished racer
    let trailingRacerForWarning: AuthoritativeRacerState | null = null;
    for (let i = 0; i < canonicalUids.length; i += 1) {
      const r = racers[canonicalUids[i]];
      if (r.finishTimeMs !== null) continue;
      if (trailingRacerForWarning === null || r.distanceM < trailingRacerForWarning.distanceM) {
        trailingRacerForWarning = r;
      }
    }

    const gapToTrailingM =
      trailingRacerForWarning !== null
        ? Math.max(0, trailingRacerForWarning.distanceM - nextAvalancheDistM)
        : Math.max(0, COURSE_LENGTH_M - nextAvalancheDistM);

    const nextWarning = computeAvalancheWarning(
      nextIsActive,
      trailingRacerForWarning === null,
      trailingRacerForWarning ? trailingRacerForWarning.tumbleTimerSec : 0,
      gapToTrailingM
    );

    if (
      trailingRacerForWarning !== null &&
      nextWarning === 'danger' &&
      avalanche.warningLevel !== 'danger' &&
      avalanche.warningLevel !== 'tumble'
    ) {
      collectedEvents.push({
        type: 'avalanche_warning',
        uid: trailingRacerForWarning.uid,
      });
    }

    avalanche = {
      distanceM: nextAvalancheDistM,
      speedMps: nextAvalancheSpeedMps,
      graceRemainingSec: nextGraceSec,
      isActive: nextIsActive,
      warningLevel: nextWarning,
      gapToPlayerM: gapToTrailingM,
    };

    // 4F. Post-Winner 15.0s Finish Window & All-Finished Immediate Finalization Check
    const allFinished = canonicalUids.every((uid) => racers[uid].finishTimeMs !== null);
    if (allFinished) {
      pendingFinalizeReason = 'all_finished';
      postWinnerRemainingSec = 0;
      break;
    }

    if (winnerId !== null) {
      if (phase === 'racing') {
        phase = 'finish_window';
        postWinnerRemainingSec = POST_WINNER_FINISH_WINDOW_SEC;
        collectedEvents.push({
          type: 'finish_window_started',
          winnerId,
          durationSec: POST_WINNER_FINISH_WINDOW_SEC,
        });
      } else if (phase === 'finish_window') {
        const currentRemaining = postWinnerRemainingSec ?? POST_WINNER_FINISH_WINDOW_SEC;
        const nextRemaining = Math.max(0, currentRemaining - subDtSec);
        postWinnerRemainingSec = nextRemaining;
        if (nextRemaining <= 0) {
          pendingFinalizeReason = 'post_winner_timeout';
          break;
        }
      }
    }
  }

  const liveStandings = computeRaceStandings({
    racers,
    trackSeed: state.trackSeed,
    serverTick: nextServerTick,
  });

  const updatedState: MultiplayerRaceState = {
    ...state,
    serverTick: nextServerTick,
    phase,
    elapsedRaceMs,
    racers,
    itemBoxes,
    projectiles,
    traps,
    avalanche,
    nextEntitySerial,
    ackSeqByUid: nextAckSeqByUid,
    finishState: {
      winnerId,
      winnerFinishTimeMs,
      postWinnerWindowDurationSec: POST_WINNER_FINISH_WINDOW_SEC,
      postWinnerRemainingSec,
      finalized: false,
      finishReason: null,
      finalizedAtElapsedMs: null,
      standings: liveStandings,
    },
    events: collectedEvents,
  };

  if (pendingFinalizeReason !== null) {
    return finalizeMultiplayerRace(updatedState, pendingFinalizeReason);
  }

  return updatedState;
}

/**
 * Builds a compact, JSON-serializable `SnowRushSnapshot` for network broadcast and reconnect restore.
 * Excludes static track geometry (reconstructed via `trackSeed`), visual particles, canvas trails, and audio objects.
 */
export function buildMultiplayerSnapshot(state: MultiplayerRaceState): SnowRushSnapshot {
  const canonicalUids = getCanonicalRacerUids(state.racers);
  const racersSnapshot: Record<string, MultiplayerRacerSnapshot> = {};
  const ackSnapshot: Record<string, number> = {};

  for (let i = 0; i < canonicalUids.length; i += 1) {
    const uid = canonicalUids[i];
    const r = state.racers[uid];
    racersSnapshot[uid] = {
      ...r,
      interactedObstacleIds: [...r.interactedObstacleIds],
    };
    ackSnapshot[uid] = state.ackSeqByUid[uid] ?? r.lastProcessedInputSeq ?? 0;
  }

  const itemBoxStatuses: MultiplayerItemBoxStatus[] = state.itemBoxes.map((box) => ({
    id: box.id,
    rowIndex: box.rowIndex,
    distanceM: box.distanceM,
    laneOffset: box.laneOffset,
    pickedUpByRacerId: box.pickedUpByRacerId,
  }));

  const standings = computeRaceStandings(state);

  return {
    serverTick: state.serverTick,
    elapsedRaceMs: state.elapsedRaceMs,
    trackSeed: state.trackSeed,
    racePhase: state.phase,
    countdownRemainingSec: state.countdownRemainingSec,
    racers: racersSnapshot,
    racerOrder: [...canonicalUids],
    avalanche: { ...state.avalanche },
    activeProjectiles: state.projectiles
      .filter((p) => p.active)
      .map((p) => ({ ...p })),
    activeTraps: state.traps
      .filter((t) => t.active)
      .map((t) => ({ ...t })),
    itemBoxStatuses,
    raceStandings: standings,
    finishState: {
      ...state.finishState,
      standings,
    },
    ackSeqByUid: ackSnapshot,
    nextEntitySerial: state.nextEntitySerial,
  };
}

/**
 * Reconstructs a complete, tick-resumable `MultiplayerRaceState` from a `SnowRushSnapshot`
 * (deterministic track & item box geometry are rebuilt directly from `snapshot.trackSeed`).
 */
export function restoreMultiplayerStateFromSnapshot(
  snapshot: SnowRushSnapshot
): MultiplayerRaceState {
  const normalizedSeed = normalizeTrackSeed(snapshot.trackSeed);
  const track = generateSnowRushTrack(normalizedSeed);

  const pickedMap = new Map<string, string | null>();
  for (let i = 0; i < snapshot.itemBoxStatuses.length; i += 1) {
    const status = snapshot.itemBoxStatuses[i];
    pickedMap.set(status.id, status.pickedUpByRacerId);
  }

  const itemBoxes: SnowRushItemBox[] = track.itemBoxes.map((box) => ({
    ...box,
    pickedUpByRacerId: pickedMap.has(box.id) ? (pickedMap.get(box.id) ?? null) : null,
  }));

  const sortedUids = [...Object.keys(snapshot.racers)].sort((uidA, uidB) => {
    const rA = snapshot.racers[uidA];
    const rB = snapshot.racers[uidB];
    if (rA.slotIndex !== rB.slotIndex) {
      return rA.slotIndex - rB.slotIndex;
    }
    return uidA < uidB ? -1 : uidA > uidB ? 1 : 0;
  });

  const racers: Record<string, AuthoritativeRacerState> = {};
  const ackSeqByUid: Record<string, number> = {};

  for (let i = 0; i < sortedUids.length; i += 1) {
    const uid = sortedUids[i];
    const snapRacer = snapshot.racers[uid];
    racers[uid] = {
      ...snapRacer,
      interactedObstacleIds: [...snapRacer.interactedObstacleIds],
    };
    ackSeqByUid[uid] = snapshot.ackSeqByUid[uid] ?? snapRacer.lastProcessedInputSeq ?? 0;
  }

  const standings = computeRaceStandings({
    racers,
    trackSeed: normalizedSeed,
    serverTick: snapshot.serverTick,
  });

  return {
    serverTick: snapshot.serverTick,
    phase: snapshot.racePhase,
    countdownRemainingSec: snapshot.countdownRemainingSec,
    elapsedRaceMs: snapshot.elapsedRaceMs,
    trackSeed: normalizedSeed,
    track,
    racers,
    racerOrder: sortedUids,
    itemBoxes,
    projectiles: snapshot.activeProjectiles.map((p) => ({ ...p })),
    traps: snapshot.activeTraps.map((t) => ({ ...t })),
    avalanche: { ...snapshot.avalanche },
    nextEntitySerial: snapshot.nextEntitySerial,
    ackSeqByUid,
    finishState: {
      ...snapshot.finishState,
      standings,
    },
    events: [],
  };
}
