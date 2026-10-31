import type {
  MultiplayerItemBoxStatus,
  MultiplayerRacePhase,
  MultiplayerRacerSnapshot,
  RaceFinishState,
  RaceStanding,
  SnowRushSnapshot,
} from '../engine/multiplayerTypes';
import type { AvalancheState, SnowRushProjectile, SnowRushTrap } from '../types';

/**
 * Snow Rush: Avalanche Escape — Step 4.7 Lightweight Snapshot Interpolation
 *
 * Smoothly renders 10–20 Hz authoritative server snapshots at 60 FPS on the client:
 * - Bounded snapshot buffer (max 6 frames)
 * - Configurable interpolation delay (default 100 ms)
 * - Teleport threshold (> 12 m jump, e.g. Snow Tumble +25 m recovery) snaps cleanly
 *   instead of lerping racers through obstacles
 * - Zero heavy client-side prediction or duplicate physics loops
 */

export const DEFAULT_INTERPOLATION_DELAY_MS = 100;
export const TELEPORT_SNAP_DISTANCE_M = 12;
const MAX_SNAPSHOT_BUFFER_SIZE = 6;

interface BufferedSnapshotEntry {
  readonly receivedAtMs: number;
  readonly snapshot: SnowRushSnapshot;
}

export interface InterpolatedSnowRushFrame {
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
  readonly interpolationAlpha: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function interpolateRacer(
  older: MultiplayerRacerSnapshot | undefined,
  newer: MultiplayerRacerSnapshot,
  alpha: number
): MultiplayerRacerSnapshot {
  if (!older || alpha >= 1) {
    return newer;
  }

  // Snap immediately on Snow Tumble recovery (+25 m) or round reset
  const distDelta = Math.abs(newer.distanceM - older.distanceM);
  if (distDelta > TELEPORT_SNAP_DISTANCE_M) {
    return newer;
  }

  return {
    ...newer,
    distanceM: lerp(older.distanceM, newer.distanceM, alpha),
    laneOffset: lerp(older.laneOffset, newer.laneOffset, alpha),
    lateralVelocity: lerp(older.lateralVelocity, newer.lateralVelocity, alpha),
    speedMps: lerp(older.speedMps, newer.speedMps, alpha),
    carveTilt: lerp(older.carveTilt, newer.carveTilt, alpha),
    jumpHeightPx: lerp(older.jumpHeightPx, newer.jumpHeightPx, alpha),
    scarfPhase: lerp(older.scarfPhase, newer.scarfPhase, alpha),
  };
}

function interpolateAvalanche(
  older: Readonly<AvalancheState>,
  newer: Readonly<AvalancheState>,
  alpha: number
): Readonly<AvalancheState> {
  if (alpha >= 1 || Math.abs(newer.distanceM - older.distanceM) > 40) {
    return newer;
  }
  return {
    ...newer,
    distanceM: lerp(older.distanceM, newer.distanceM, alpha),
    speedMps: lerp(older.speedMps, newer.speedMps, alpha),
  };
}

function interpolateProjectiles(
  olderList: readonly Readonly<SnowRushProjectile>[],
  newerList: readonly Readonly<SnowRushProjectile>[],
  alpha: number
): readonly Readonly<SnowRushProjectile>[] {
  if (alpha >= 1 || olderList.length === 0 || newerList.length === 0) {
    return newerList;
  }
  const olderById = new Map<string, Readonly<SnowRushProjectile>>();
  for (let i = 0; i < olderList.length; i += 1) {
    olderById.set(olderList[i].id, olderList[i]);
  }

  return newerList.map((proj) => {
    const prev = olderById.get(proj.id);
    if (!prev) return proj;
    return {
      ...proj,
      distanceM: lerp(prev.distanceM, proj.distanceM, alpha),
      laneOffset: lerp(prev.laneOffset, proj.laneOffset, alpha),
    };
  });
}

export class SnowRushSnapshotInterpolator {
  private buffer: BufferedSnapshotEntry[] = [];
  private readonly interpolationDelayMs: number;

  constructor(interpolationDelayMs: number = DEFAULT_INTERPOLATION_DELAY_MS) {
    this.interpolationDelayMs = Math.max(0, Math.min(300, interpolationDelayMs));
  }

  public reset(): void {
    this.buffer = [];
  }

  public getBufferLength(): number {
    return this.buffer.length;
  }

  public getLatestSnapshot(): SnowRushSnapshot | null {
    if (this.buffer.length === 0) {
      return null;
    }
    return this.buffer[this.buffer.length - 1].snapshot;
  }

  /**
   * Appends a new authoritative server snapshot into the interpolation ring buffer.
   * Out-of-order / duplicate `serverTick` frames are ignored; round resets clear stale history.
   */
  public pushSnapshot(snapshot: SnowRushSnapshot, receivedAtMs: number): void {
    if (this.buffer.length > 0) {
      const latest = this.buffer[this.buffer.length - 1];
      if (snapshot.trackSeed !== latest.snapshot.trackSeed) {
        this.buffer = [];
      } else if (snapshot.serverTick < latest.snapshot.serverTick) {
        // If serverTick dropped to 0 on a fresh round with identical seed, reset buffer; otherwise ignore stale packet
        if (snapshot.serverTick === 0 && latest.snapshot.serverTick > 5) {
          this.buffer = [];
        } else {
          return;
        }
      } else if (
        snapshot.serverTick === latest.snapshot.serverTick &&
        snapshot.racePhase === latest.snapshot.racePhase
      ) {
        // Replace identical tick snapshot in-place (e.g. player_connection update on same tick)
        this.buffer[this.buffer.length - 1] = {
          receivedAtMs: Math.max(latest.receivedAtMs, receivedAtMs),
          snapshot,
        };
        return;
      }
    }

    const monotonicTime =
      this.buffer.length > 0
        ? Math.max(receivedAtMs, this.buffer[this.buffer.length - 1].receivedAtMs + 1)
        : receivedAtMs;

    this.buffer.push({
      receivedAtMs: monotonicTime,
      snapshot,
    });

    while (this.buffer.length > MAX_SNAPSHOT_BUFFER_SIZE) {
      this.buffer.shift();
    }
  }

  /**
   * Samples an interpolated frame at `nowMs` (typically `performance.now()` or `Date.now()`).
   */
  public sample(nowMs: number): InterpolatedSnowRushFrame | null {
    if (this.buffer.length === 0) {
      return null;
    }

    if (this.buffer.length === 1) {
      const single = this.buffer[0].snapshot;
      return {
        serverTick: single.serverTick,
        elapsedRaceMs: single.elapsedRaceMs,
        trackSeed: single.trackSeed,
        racePhase: single.racePhase,
        countdownRemainingSec: single.countdownRemainingSec,
        racers: single.racers,
        racerOrder: single.racerOrder,
        avalanche: single.avalanche,
        activeProjectiles: single.activeProjectiles,
        activeTraps: single.activeTraps,
        itemBoxStatuses: single.itemBoxStatuses,
        raceStandings: single.raceStandings,
        finishState: single.finishState,
        interpolationAlpha: 1,
      };
    }

    const renderTimeMs = nowMs - this.interpolationDelayMs;
    const first = this.buffer[0];
    const last = this.buffer[this.buffer.length - 1];

    if (renderTimeMs <= first.receivedAtMs) {
      const snap = first.snapshot;
      return {
        serverTick: snap.serverTick,
        elapsedRaceMs: snap.elapsedRaceMs,
        trackSeed: snap.trackSeed,
        racePhase: snap.racePhase,
        countdownRemainingSec: snap.countdownRemainingSec,
        racers: snap.racers,
        racerOrder: snap.racerOrder,
        avalanche: snap.avalanche,
        activeProjectiles: snap.activeProjectiles,
        activeTraps: snap.activeTraps,
        itemBoxStatuses: snap.itemBoxStatuses,
        raceStandings: snap.raceStandings,
        finishState: snap.finishState,
        interpolationAlpha: 0,
      };
    }

    if (renderTimeMs >= last.receivedAtMs) {
      const snap = last.snapshot;
      return {
        serverTick: snap.serverTick,
        elapsedRaceMs: snap.elapsedRaceMs,
        trackSeed: snap.trackSeed,
        racePhase: snap.racePhase,
        countdownRemainingSec: snap.countdownRemainingSec,
        racers: snap.racers,
        racerOrder: snap.racerOrder,
        avalanche: snap.avalanche,
        activeProjectiles: snap.activeProjectiles,
        activeTraps: snap.activeTraps,
        itemBoxStatuses: snap.itemBoxStatuses,
        raceStandings: snap.raceStandings,
        finishState: snap.finishState,
        interpolationAlpha: 1,
      };
    }

    let olderEntry = first;
    let newerEntry = last;
    for (let i = 0; i < this.buffer.length - 1; i += 1) {
      const a = this.buffer[i];
      const b = this.buffer[i + 1];
      if (renderTimeMs >= a.receivedAtMs && renderTimeMs <= b.receivedAtMs) {
        olderEntry = a;
        newerEntry = b;
        break;
      }
    }

    const spanMs = Math.max(1, newerEntry.receivedAtMs - olderEntry.receivedAtMs);
    const alpha = clamp01((renderTimeMs - olderEntry.receivedAtMs) / spanMs);
    const olderSnap = olderEntry.snapshot;
    const newerSnap = newerEntry.snapshot;

    const interpolatedRacers: Record<string, MultiplayerRacerSnapshot> = {};
    for (let i = 0; i < newerSnap.racerOrder.length; i += 1) {
      const uid = newerSnap.racerOrder[i];
      const newerRacer = newerSnap.racers[uid];
      if (!newerRacer) continue;
      interpolatedRacers[uid] = interpolateRacer(olderSnap.racers[uid], newerRacer, alpha);
    }

    return {
      serverTick: newerSnap.serverTick,
      elapsedRaceMs: lerp(olderSnap.elapsedRaceMs, newerSnap.elapsedRaceMs, alpha),
      trackSeed: newerSnap.trackSeed,
      racePhase: newerSnap.racePhase,
      countdownRemainingSec: lerp(
        olderSnap.countdownRemainingSec,
        newerSnap.countdownRemainingSec,
        alpha
      ),
      racers: interpolatedRacers,
      racerOrder: newerSnap.racerOrder,
      avalanche: interpolateAvalanche(olderSnap.avalanche, newerSnap.avalanche, alpha),
      activeProjectiles: interpolateProjectiles(
        olderSnap.activeProjectiles,
        newerSnap.activeProjectiles,
        alpha
      ),
      activeTraps: newerSnap.activeTraps,
      itemBoxStatuses: newerSnap.itemBoxStatuses,
      raceStandings: newerSnap.raceStandings,
      finishState: newerSnap.finishState,
      interpolationAlpha: alpha,
    };
  }
}
