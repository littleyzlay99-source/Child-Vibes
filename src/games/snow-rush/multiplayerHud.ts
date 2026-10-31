import {
  AVALANCHE_CAUTION_GAP_M,
  AVALANCHE_DANGER_GAP_M,
  COURSE_LENGTH_KM_TEXT,
  COURSE_LENGTH_M,
  COUNTDOWN_BEAT_SEC,
  MAX_VISUAL_BURSTS,
} from './constants';
import type {
  MultiplayerRaceEvent,
  MultiplayerRacePhase,
  MultiplayerRacerSnapshot,
  RaceFinishReason,
  SnowRushSnapshot,
} from './engine/multiplayerTypes';
import { getItemMetadata } from './items';
import type { InterpolatedSnowRushFrame } from './network/snapshotInterpolation';
import type { ChibiRacerPalette } from './renderer/drawChibiRacer';
import { PLAYER_DEFAULT_PALETTE } from './renderer/drawChibiRacer';
import {
  formatDistanceKm,
  formatRaceTimeSec,
  formatSpeedKmh,
  getCourseProgressPercent,
} from './simulation';
import { generateSnowRushTrack } from './track';
import type {
  AvalancheState,
  AvalancheWarningLevel,
  RacePhase,
  SnowRushHudSnapshot,
  SnowRushItemBox,
  SnowRushObstacleKind,
  SnowRushTrackLayout,
  SnowRushVisualBurst,
  SnowRushVisualBurstKind,
} from './types';

/**
 * Snow Rush: Avalanche Escape — Step 4.8 Pure Multiplayer Render, HUD & Event Adapter
 *
 * Pure TypeScript (zero DOM / Canvas / React / Firebase dependencies).
 * Maps authoritative server snapshots (`SnowRushSnapshot` / `InterpolatedSnowRushFrame`)
 * into local HUD readouts, player-colored Chibi palettes, deterministic track layouts,
 * and client-side visual/audio event cues — with ZERO Offline Demo Bots and ZERO local simulation.
 */

export interface MultiplayerProgressDotEntry {
  readonly uid: string;
  readonly displayName: string;
  readonly color: string;
  readonly progressPercent: number;
  readonly isTumbling: boolean;
  readonly isConnected: boolean;
  readonly finished: boolean;
  readonly rank: number;
}

export interface MultiplayerHudExtras {
  readonly racePhase: MultiplayerRacePhase;
  readonly finishWindowRemainingSec: number | null;
  readonly liveRank: number | null;
  readonly localFinished: boolean;
  readonly connectedCount: number;
  readonly remoteRacers: readonly MultiplayerProgressDotEntry[];
}

export type MultiplayerSoundCue =
  | { readonly kind: 'jump'; readonly isRamp: boolean }
  | { readonly kind: 'ramp_boost' }
  | { readonly kind: 'obstacle_hit'; readonly obstacleKind: SnowRushObstacleKind }
  | { readonly kind: 'avalanche_warning' }
  | { readonly kind: 'snow_tumble' }
  | { readonly kind: 'recovery' }
  | { readonly kind: 'item_pickup' }
  | { readonly kind: 'item_empty' }
  | { readonly kind: 'nitro_activate' }
  | { readonly kind: 'snowball_launch' }
  | { readonly kind: 'snowball_hit' }
  | { readonly kind: 'snowball_miss' }
  | { readonly kind: 'trap_place' }
  | { readonly kind: 'trap_hit' }
  | { readonly kind: 'shield_activate' }
  | { readonly kind: 'shield_break' }
  | { readonly kind: 'racer_finished'; readonly isLocal: boolean }
  | { readonly kind: 'race_finalized' };

export interface TranslatedMultiplayerClientEvents {
  readonly bursts: SnowRushVisualBurst[];
  readonly nextBurstSerial: number;
  readonly soundCues: readonly MultiplayerSoundCue[];
}

export interface ReconstructedMultiplayerScene {
  readonly track: SnowRushTrackLayout;
  readonly itemBoxes: readonly SnowRushItemBox[];
  readonly cameraRacer: MultiplayerRacerSnapshot | null;
  readonly resolvedLocalUid: string | null;
  readonly localAvalanche: AvalancheState;
}

const KNOWN_ROOM_PALETTES: Readonly<Record<string, ChibiRacerPalette>> = {
  '#EF4444': {
    jacketColor: '#EF4444',
    hatColor: '#DC2626',
    scarfColor: '#FACC15',
    boardColor: '#0284C7',
    pomColor: '#FFFBEB',
    goggleLensStart: '#38BDF8',
    goggleLensEnd: '#1D4ED8',
  },
  '#F43F5E': PLAYER_DEFAULT_PALETTE,
  '#3B82F6': {
    jacketColor: '#2563EB',
    hatColor: '#1D4ED8',
    scarfColor: '#FDE047',
    boardColor: '#F97316',
    pomColor: '#F8FAFC',
    goggleLensStart: '#67E8F9',
    goggleLensEnd: '#0284C7',
  },
  '#0EA5E9': {
    jacketColor: '#0EA5E9',
    hatColor: '#0284C7',
    scarfColor: '#FDE047',
    boardColor: '#F97316',
    pomColor: '#F8FAFC',
    goggleLensStart: '#BAE6FD',
    goggleLensEnd: '#0369A1',
  },
  '#10B981': {
    jacketColor: '#10B981',
    hatColor: '#059669',
    scarfColor: '#FDE047',
    boardColor: '#6366F1',
    pomColor: '#FFFBEB',
    goggleLensStart: '#38BDF8',
    goggleLensEnd: '#1E40AF',
  },
  '#22C55E': {
    jacketColor: '#16A34A',
    hatColor: '#15803D',
    scarfColor: '#FEF08A',
    boardColor: '#0284C7',
    pomColor: '#FFFBEB',
    goggleLensStart: '#38BDF8',
    goggleLensEnd: '#1D4ED8',
  },
  '#F59E0B': {
    jacketColor: '#F59E0B',
    hatColor: '#D97706',
    scarfColor: '#0EA5E9',
    boardColor: '#E11D48',
    pomColor: '#FFFBEB',
    goggleLensStart: '#38BDF8',
    goggleLensEnd: '#1E3A8A',
  },
  '#EAB308': {
    jacketColor: '#EAB308',
    hatColor: '#CA8A04',
    scarfColor: '#0284C7',
    boardColor: '#E11D48',
    pomColor: '#FFFFFF',
    goggleLensStart: '#38BDF8',
    goggleLensEnd: '#1E3A8A',
  },
  '#8B5CF6': {
    jacketColor: '#8B5CF6',
    hatColor: '#6D28D9',
    scarfColor: '#FACC15',
    boardColor: '#06B6D4',
    pomColor: '#FFFBEB',
    goggleLensStart: '#67E8F9',
    goggleLensEnd: '#1D4ED8',
  },
  '#EC4899': {
    jacketColor: '#EC4899',
    hatColor: '#DB2777',
    scarfColor: '#FDE047',
    boardColor: '#0EA5E9',
    pomColor: '#FFFBEB',
    goggleLensStart: '#38BDF8',
    goggleLensEnd: '#1D4ED8',
  },
};

function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return null;
  }
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${clampByte(r).toString(16).padStart(2, '0')}${clampByte(g)
    .toString(16)
    .padStart(2, '0')}${clampByte(b).toString(16).padStart(2, '0')}`.toUpperCase();
}

/**
 * Derives a cohesive winter Chibi outfit palette from a RoomPlayer's hex color.
 */
export function deriveRacerPaletteFromHex(
  hexColor: string | undefined,
  isLocalPlayer: boolean
): ChibiRacerPalette {
  const normalized = typeof hexColor === 'string' ? hexColor.trim().toUpperCase() : '';
  const preset = KNOWN_ROOM_PALETTES[normalized];
  if (preset) {
    return preset;
  }

  const rgb = parseHexRgb(normalized);
  if (!rgb) {
    return isLocalPlayer
      ? PLAYER_DEFAULT_PALETTE
      : KNOWN_ROOM_PALETTES['#0EA5E9'];
  }

  const darkenedHat = rgbToHex(rgb.r * 0.78, rgb.g * 0.78, rgb.b * 0.78);
  const isWarm = rgb.r > rgb.b + 30;
  return {
    jacketColor: normalized,
    hatColor: darkenedHat,
    scarfColor: isWarm ? '#38BDF8' : '#FACC15',
    boardColor: isWarm ? '#0284C7' : '#F97316',
    pomColor: '#FFFBEB',
    goggleLensStart: '#38BDF8',
    goggleLensEnd: '#1D4ED8',
  };
}

export function getMonotonicClientNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function mapMultiplayerPhaseToHudPhase(phase: MultiplayerRacePhase): RacePhase {
  switch (phase) {
    case 'ready':
      return 'ready';
    case 'countdown':
      return 'countdown';
    case 'racing':
    case 'finish_window':
      return 'racing';
    case 'finished':
      return 'finished';
  }
}

function computeLocalAvalancheState(
  serverAvalanche: Readonly<AvalancheState>,
  racer: MultiplayerRacerSnapshot | null
): AvalancheState {
  if (!racer) {
    return { ...serverAvalanche };
  }

  const rawGap = racer.distanceM - serverAvalanche.distanceM;
  const clampedGap = Math.max(0, Math.round(rawGap));

  let warningLevel: AvalancheWarningLevel = 'safe';
  if (racer.tumbleTimerSec > 0) {
    warningLevel = 'tumble';
  } else if (serverAvalanche.isActive) {
    if (rawGap <= AVALANCHE_DANGER_GAP_M) {
      warningLevel = 'danger';
    } else if (rawGap <= AVALANCHE_CAUTION_GAP_M) {
      warningLevel = 'caution';
    }
  }

  return {
    distanceM: serverAvalanche.distanceM,
    speedMps: serverAvalanche.speedMps,
    graceRemainingSec: serverAvalanche.graceRemainingSec,
    isActive: serverAvalanche.isActive,
    warningLevel,
    gapToPlayerM: clampedGap,
  };
}

function resolveCameraRacer(
  frame: Pick<InterpolatedSnowRushFrame, 'racers' | 'racerOrder'>,
  localUid: string | null
): { racer: MultiplayerRacerSnapshot | null; resolvedUid: string | null } {
  if (localUid && frame.racers[localUid]) {
    return { racer: frame.racers[localUid], resolvedUid: localUid };
  }
  for (let i = 0; i < frame.racerOrder.length; i += 1) {
    const fallbackUid = frame.racerOrder[i];
    const candidate = frame.racers[fallbackUid];
    if (candidate) {
      return { racer: candidate, resolvedUid: fallbackUid };
    }
  }
  return { racer: null, resolvedUid: null };
}

/**
 * Builds `SnowRushHudSnapshot` + `MultiplayerHudExtras` strictly from authoritative server state.
 * Guarantees `showOfflineBots: false` and `bots: []` in all cases.
 */
export function buildMultiplayerHudSnapshot(
  frame: InterpolatedSnowRushFrame | SnowRushSnapshot | null,
  localUid: string | null
): { hud: SnowRushHudSnapshot; extras: MultiplayerHudExtras } {
  if (!frame) {
    return {
      hud: {
        phase: 'ready',
        countdownStep: null,
        trackSeed: 0,
        distanceM: 0,
        distanceKmText: '0.00',
        courseLengthKmText: COURSE_LENGTH_KM_TEXT,
        progressPercent: 0,
        speedKmh: 0,
        topSpeedKmh: 0,
        jumpCount: 0,
        obstacleHitCount: 0,
        tumbleCount: 0,
        playerStatus: 'normal',
        heldItem: null,
        heldItemName: null,
        heldItemNameMm: null,
        heldItemIcon: null,
        itemArmingSec: 0,
        isItemReady: false,
        nitroRemainingSec: 0,
        shieldRemainingSec: 0,
        mercyInvulnRemainingSec: 0,
        itemsUsedCount: 0,
        attacksLandedCount: 0,
        shieldBlocksCount: 0,
        avalancheDistanceM: -90,
        avalancheProgressPercent: 0,
        avalancheGapM: 90,
        avalancheWarning: 'safe',
        avalancheGraceSec: 4,
        elapsedSecText: '0.00',
        finishTimeSecText: null,
        finishRank: null,
        totalRacers: 0,
        showOfflineBots: false,
        bots: [],
      },
      extras: {
        racePhase: 'ready',
        finishWindowRemainingSec: null,
        liveRank: null,
        localFinished: false,
        connectedCount: 0,
        remoteRacers: [],
      },
    };
  }

  const { racer, resolvedUid } = resolveCameraRacer(frame, localUid);
  const localAvalanche = computeLocalAvalancheState(frame.avalanche, racer);

  let countdownStep: number | null = null;
  if (frame.racePhase === 'countdown') {
    const rawStep = Math.ceil(frame.countdownRemainingSec / COUNTDOWN_BEAT_SEC);
    countdownStep = Math.max(1, Math.min(3, rawStep));
  } else if (
    (frame.racePhase === 'racing' || frame.racePhase === 'finish_window') &&
    frame.elapsedRaceMs < 650
  ) {
    countdownStep = 0; // "GO!"
  }

  const rankByUid = new Map<string, number>();
  for (let i = 0; i < frame.raceStandings.length; i += 1) {
    const st = frame.raceStandings[i];
    rankByUid.set(st.uid, st.rank);
  }

  let connectedCount = 0;
  const remoteRacers: MultiplayerProgressDotEntry[] = [];
  for (let i = 0; i < frame.racerOrder.length; i += 1) {
    const uid = frame.racerOrder[i];
    const r = frame.racers[uid];
    if (!r) continue;
    if (r.isConnected) {
      connectedCount += 1;
    }
    if (uid !== resolvedUid) {
      remoteRacers.push({
        uid: r.uid,
        displayName: r.displayName,
        color: r.color,
        progressPercent: getCourseProgressPercent(r.distanceM),
        isTumbling: r.tumbleTimerSec > 0,
        isConnected: r.isConnected,
        finished: r.finishTimeMs !== null || r.distanceM >= COURSE_LENGTH_M,
        rank: rankByUid.get(r.uid) ?? i + 1,
      });
    }
  }

  const liveRank = resolvedUid ? rankByUid.get(resolvedUid) ?? null : null;
  const localFinished =
    racer !== null && (racer.finishTimeMs !== null || racer.distanceM >= COURSE_LENGTH_M);
  const heldMeta = racer ? getItemMetadata(racer.heldItem) : null;
  const isItemReady =
    racer !== null &&
    !localFinished &&
    racer.heldItem !== null &&
    racer.itemArmingTimerSec <= 0 &&
    racer.tumbleTimerSec <= 0;

  const hudPhase: RacePhase = mapMultiplayerPhaseToHudPhase(frame.racePhase);

  return {
    hud: {
      phase: hudPhase,
      countdownStep,
      trackSeed: frame.trackSeed,
      distanceM: racer ? racer.distanceM : 0,
      distanceKmText: formatDistanceKm(racer ? racer.distanceM : 0),
      courseLengthKmText: COURSE_LENGTH_KM_TEXT,
      progressPercent: getCourseProgressPercent(racer ? racer.distanceM : 0),
      speedKmh: formatSpeedKmh(racer ? racer.speedMps : 0),
      topSpeedKmh: formatSpeedKmh(racer ? racer.topSpeedMps : 0),
      jumpCount: racer ? racer.jumpCount : 0,
      obstacleHitCount: racer ? racer.obstacleHitCount : 0,
      tumbleCount: racer ? racer.tumbleCount : 0,
      playerStatus: racer ? racer.activeStatus : 'normal',
      heldItem: racer ? racer.heldItem : null,
      heldItemName: heldMeta ? heldMeta.name : null,
      heldItemNameMm: heldMeta ? heldMeta.nameMm : null,
      heldItemIcon: heldMeta ? heldMeta.icon : null,
      itemArmingSec: racer ? Math.max(0, racer.itemArmingTimerSec) : 0,
      isItemReady,
      nitroRemainingSec: racer ? Math.max(0, racer.nitroTimerSec) : 0,
      shieldRemainingSec: racer ? Math.max(0, racer.shieldTimerSec) : 0,
      mercyInvulnRemainingSec: racer ? Math.max(0, racer.mercyInvulnTimerSec) : 0,
      itemsUsedCount: racer ? racer.itemsUsedCount : 0,
      attacksLandedCount: racer ? racer.attacksLandedCount : 0,
      shieldBlocksCount: racer ? racer.shieldBlocksCount : 0,
      avalancheDistanceM: localAvalanche.distanceM,
      avalancheProgressPercent: getCourseProgressPercent(Math.max(0, localAvalanche.distanceM)),
      avalancheGapM: localAvalanche.gapToPlayerM,
      avalancheWarning: localAvalanche.warningLevel,
      avalancheGraceSec: localAvalanche.graceRemainingSec,
      elapsedSecText: formatRaceTimeSec(frame.elapsedRaceMs),
      finishTimeSecText:
        racer && racer.finishTimeMs !== null ? formatRaceTimeSec(racer.finishTimeMs) : null,
      finishRank: racer?.finishRank ?? liveRank,
      totalRacers: frame.racerOrder.length,
      showOfflineBots: false,
      bots: [],
    },
    extras: {
      racePhase: frame.racePhase,
      finishWindowRemainingSec:
        frame.racePhase === 'finish_window'
          ? frame.finishState.postWinnerRemainingSec
          : null,
      liveRank,
      localFinished,
      connectedCount,
      remoteRacers,
    },
  };
}

/**
 * Reconstructs deterministic static track obstacles + live itemBox statuses for Canvas rendering.
 * Caches `SnowRushTrackLayout` whenever `cachedTrack.seed === frame.trackSeed`.
 */
export function reconstructMultiplayerSceneData(
  frame: InterpolatedSnowRushFrame,
  cachedTrack: SnowRushTrackLayout | null,
  localUid: string | null
): ReconstructedMultiplayerScene {
  const track =
    cachedTrack && cachedTrack.seed === frame.trackSeed
      ? cachedTrack
      : generateSnowRushTrack(frame.trackSeed);

  const pickedMap = new Map<string, string | null>();
  for (let i = 0; i < frame.itemBoxStatuses.length; i += 1) {
    const st = frame.itemBoxStatuses[i];
    pickedMap.set(st.id, st.pickedUpByRacerId);
  }

  const itemBoxes: SnowRushItemBox[] = track.itemBoxes.map((box) => ({
    ...box,
    pickedUpByRacerId: pickedMap.has(box.id) ? pickedMap.get(box.id) ?? null : box.pickedUpByRacerId,
  }));

  const { racer, resolvedUid } = resolveCameraRacer(frame, localUid);
  const localAvalanche = computeLocalAvalancheState(frame.avalanche, racer);

  return {
    track,
    itemBoxes,
    cameraRacer: racer,
    resolvedLocalUid: resolvedUid,
    localAvalanche,
  };
}

function createBurst(
  serial: number,
  kind: SnowRushVisualBurstKind,
  distanceM: number,
  laneOffset: number,
  durationSec = 0.45
): SnowRushVisualBurst {
  return {
    id: `mp_burst_${serial}`,
    kind,
    distanceM,
    laneOffset,
    elapsedSec: 0,
    durationSec,
  };
}

/**
 * Advances and prunes purely visual particle bursts on the client at 60 FPS.
 */
export function decayVisualBursts(
  bursts: readonly SnowRushVisualBurst[],
  dtSec: number
): SnowRushVisualBurst[] {
  if (bursts.length === 0) {
    return [];
  }
  const clampedDt = Math.max(0, Math.min(0.1, dtSec));
  const next: SnowRushVisualBurst[] = [];
  for (let i = 0; i < bursts.length; i += 1) {
    const b = bursts[i];
    const elapsedSec = b.elapsedSec + clampedDt;
    if (elapsedSec < b.durationSec) {
      next.push({ ...b, elapsedSec });
    }
  }
  if (next.length > MAX_VISUAL_BURSTS) {
    return next.slice(next.length - MAX_VISUAL_BURSTS);
  }
  return next;
}

/**
 * Converts authoritative `MultiplayerRaceEvent[]` from a WebSocket snapshot into
 * world-coordinate visual bursts and local player sound cues.
 */
export function translateMultiplayerEventsForClient(
  events: readonly MultiplayerRaceEvent[],
  snapshot: SnowRushSnapshot,
  localUid: string | null,
  initialBurstSerial: number
): TranslatedMultiplayerClientEvents {
  if (events.length === 0) {
    return {
      bursts: [],
      nextBurstSerial: initialBurstSerial,
      soundCues: [],
    };
  }

  let serial = initialBurstSerial;
  const bursts: SnowRushVisualBurst[] = [];
  const soundCues: MultiplayerSoundCue[] = [];

  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    switch (ev.type) {
      case 'racer_jump': {
        if (ev.uid === localUid) {
          soundCues.push({ kind: 'jump', isRamp: ev.origin === 'ramp' });
        }
        break;
      }

      case 'racer_ramp_boost': {
        if (ev.uid === localUid) {
          soundCues.push({ kind: 'ramp_boost' });
        }
        break;
      }

      case 'racer_obstacle_hit': {
        if (ev.uid === localUid) {
          soundCues.push({ kind: 'obstacle_hit', obstacleKind: ev.kind });
        }
        break;
      }

      case 'avalanche_warning': {
        if (ev.uid === localUid) {
          soundCues.push({ kind: 'avalanche_warning' });
        }
        break;
      }

      case 'racer_snow_tumble': {
        if (ev.uid === localUid) {
          soundCues.push({ kind: 'snow_tumble' });
        }
        break;
      }

      case 'racer_recovery': {
        if (ev.uid === localUid) {
          soundCues.push({ kind: 'recovery' });
        }
        break;
      }

      case 'item_pickup': {
        const racer = snapshot.racers[ev.uid];
        const box = snapshot.itemBoxStatuses.find((b) => b.id === ev.boxId);
        const distM = box ? box.distanceM : racer ? racer.distanceM : 0;
        const lane = box ? box.laneOffset : racer ? racer.laneOffset : 0;
        bursts.push(createBurst(serial++, 'item_pickup', distM, lane, 0.42));
        if (ev.uid === localUid) {
          soundCues.push({ kind: 'item_pickup' });
        }
        break;
      }

      case 'item_empty': {
        if (ev.uid === localUid) {
          soundCues.push({ kind: 'item_empty' });
        }
        break;
      }

      case 'nitro_activate': {
        if (ev.uid === localUid) {
          soundCues.push({ kind: 'nitro_activate' });
        }
        break;
      }

      case 'snowball_launch': {
        if (ev.uid === localUid) {
          soundCues.push({ kind: 'snowball_launch' });
        }
        break;
      }

      case 'snowball_hit': {
        const target = snapshot.racers[ev.targetId];
        if (target) {
          bursts.push(
            createBurst(serial++, 'snowball_hit', target.distanceM, target.laneOffset, 0.5)
          );
        }
        if (ev.attackerId === localUid || ev.targetId === localUid) {
          soundCues.push({ kind: 'snowball_hit' });
        }
        break;
      }

      case 'snowball_miss': {
        const owner = snapshot.racers[ev.ownerId];
        if (owner) {
          bursts.push(
            createBurst(serial++, 'snowball_miss', owner.distanceM + 24, owner.laneOffset, 0.36)
          );
        }
        if (ev.ownerId === localUid) {
          soundCues.push({ kind: 'snowball_miss' });
        }
        break;
      }

      case 'trap_place': {
        if (ev.uid === localUid) {
          soundCues.push({ kind: 'trap_place' });
        }
        break;
      }

      case 'trap_hit': {
        const target = snapshot.racers[ev.targetId];
        if (target) {
          bursts.push(createBurst(serial++, 'trap_hit', target.distanceM, target.laneOffset, 0.5));
        }
        if (ev.ownerId === localUid || ev.targetId === localUid) {
          soundCues.push({ kind: 'trap_hit' });
        }
        break;
      }

      case 'shield_activate': {
        if (ev.uid === localUid) {
          soundCues.push({ kind: 'shield_activate' });
        }
        break;
      }

      case 'shield_break': {
        const racer = snapshot.racers[ev.uid];
        if (racer) {
          bursts.push(
            createBurst(serial++, 'shield_break', racer.distanceM, racer.laneOffset, 0.52)
          );
        }
        if (ev.uid === localUid) {
          soundCues.push({ kind: 'shield_break' });
        }
        break;
      }

      case 'racer_finished': {
        soundCues.push({ kind: 'racer_finished', isLocal: ev.uid === localUid });
        break;
      }

      case 'race_finalized': {
        soundCues.push({ kind: 'race_finalized' });
        break;
      }

      default:
        break;
    }
  }

  return {
    bursts,
    nextBurstSerial: serial,
    soundCues,
  };
}

/**
 * Formats authoritative race finish reason into natural Burmese copy for the Podium UI.
 */
export function formatMultiplayerFinishReasonMm(reason: RaceFinishReason | null): string {
  switch (reason) {
    case 'all_finished':
      return `ကစားသမားအားလုံး ${COURSE_LENGTH_KM_TEXT} km ပန်းဝင်မျဉ်းသို့ ရောက်ရှိပြီးစီးပါပြီ။`;
    case 'post_winner_timeout':
      return 'ပထမဆုရှင် ပန်းဝင်ပြီး ၁၅ စက္ကန့် အချိန်ပြည့်၍ ပြိုင်ပွဲပြီးဆုံးပါပြီ။';
    default:
      return 'အွန်လိုင်း နှင်းတောင်ဆင်းပြိုင်ပွဲ ပြီးဆုံးပါပြီ။';
  }
}
