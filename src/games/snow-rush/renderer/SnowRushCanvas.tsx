import React, { useEffect, useRef } from 'react';
import {
  CANVAS_MAX_DPR,
  COURSE_LENGTH_M,
  DISTANCE_MARKER_INTERVAL_M,
  HUD_SYNC_INTERVAL_MS,
  MAX_SCREEN_SHAKE_PX,
  MAX_TRAIL_SAMPLES,
  PIXELS_PER_METER_BASE,
  TRAIL_SAMPLE_MIN_DELTA_M,
} from '../constants';
import {
  buildMultiplayerHudSnapshot,
  decayVisualBursts,
  deriveRacerPaletteFromHex,
  getMonotonicClientNowMs,
  reconstructMultiplayerSceneData,
  type MultiplayerHudExtras,
} from '../multiplayerHud';
import type { SnowRushSnapshotInterpolator } from '../network/snapshotInterpolation';
import { buildHudSnapshot, stepSnowRushSimulation } from '../simulation';
import { DEFAULT_FALLBACK_TRACK_SEED, generateSnowRushTrack } from '../track';
import type {
  AvalancheState,
  OfflineDemoBotState,
  SnowRushHudSnapshot,
  SnowRushInputState,
  SnowRushItemBox,
  SnowRushObstacle,
  SnowRushProjectile,
  SnowRushPrototypeState,
  SnowRushStepEvent,
  SnowRushTrackLayout,
  SnowRushTrap,
  SnowRushVisualBurst,
  SnowTrailSample,
} from '../types';
import {
  drawChibiRacer,
  PLAYER_DEFAULT_PALETTE,
  type ChibiRacerPalette,
} from './drawChibiRacer';
import {
  drawItemBox,
  drawSnowballProjectile,
  drawSnowTrap,
  drawVisualBurst,
} from './drawItems';
import {
  drawAvalancheWave,
  drawSurfaceObstacle,
  drawUprightObstacle,
  type ObstacleRenderMetrics,
} from './drawObstacles';

export interface SnowRushLocalCanvasProps {
  mode?: 'local';
  simStateRef: React.MutableRefObject<SnowRushPrototypeState>;
  inputStateRef: React.MutableRefObject<SnowRushInputState>;
  onConsumeOneShotInputs?: () => void;
  onClearTransientInputs: () => void;
  onHudSync: (snapshot: SnowRushHudSnapshot) => void;
  onPhaseChange?: (
    nextPhase: SnowRushPrototypeState['phase'],
    prevPhase: SnowRushPrototypeState['phase']
  ) => void;
  onSimulationEvents?: (
    events: SnowRushStepEvent[],
    state: SnowRushPrototypeState,
    nowMs: number
  ) => void;
}

export interface SnowRushMultiplayerCanvasProps {
  mode: 'multiplayer';
  interpolatorRef: React.MutableRefObject<SnowRushSnapshotInterpolator>;
  visualBurstsRef: React.MutableRefObject<SnowRushVisualBurst[]>;
  localUid: string | null;
  onClearTransientInputs: () => void;
  onHudSync: (snapshot: SnowRushHudSnapshot, extras: MultiplayerHudExtras) => void;
  onAmbientMotionSound?: (params: {
    readonly nitroActive: boolean;
    readonly carvingActive: boolean;
    readonly nowMs: number;
  }) => void;
}

export type SnowRushCanvasProps = SnowRushLocalCanvasProps | SnowRushMultiplayerCanvasProps;

interface AmbientFlake {
  u: number; // 0..1 normalized X
  v: number; // 0..1 normalized Y
  r: number;
  speedFactor: number;
}

interface CanvasRacerDescriptor {
  readonly id: string;
  readonly distanceM: number;
  readonly laneOffset: number;
  readonly carveTilt: number;
  readonly jumpHeightPx: number;
  readonly isJumping: boolean;
  readonly speedMps: number;
  readonly scarfPhase: number;
  readonly label: string;
  readonly offscreenTag: string;
  readonly offscreenColorHex: string | null;
  readonly isLocalPlayer: boolean;
  readonly isOfflineBot: boolean;
  readonly palette: ChibiRacerPalette;
  readonly scaleMult: number;
  readonly tumbleTimerSec: number;
  readonly spinTimerSec: number;
  readonly invulnerableTimerSec: number;
  readonly iceSlipTimerSec: number;
  readonly landingBoostTimerSec: number;
  readonly nitroTimerSec: number;
  readonly shieldTimerSec: number;
  readonly shieldBreakAnimTimerSec: number;
  readonly mercyInvulnTimerSec: number;
}

interface WorldRenderFrame {
  readonly cameraDistanceM: number;
  readonly cameraSpeedMps: number;
  readonly allowDangerShake: boolean;
  readonly showOffscreenRivalBadges: boolean;
  readonly avalanche: Readonly<AvalancheState>;
  readonly obstacles: readonly SnowRushObstacle[];
  readonly interactedObstacleIds: readonly string[];
  readonly itemBoxes: readonly SnowRushItemBox[];
  readonly traps: readonly Readonly<SnowRushTrap>[];
  readonly projectiles: readonly Readonly<SnowRushProjectile>[];
  readonly trail: readonly SnowTrailSample[];
  readonly visualBursts: readonly SnowRushVisualBurst[];
  readonly racers: readonly CanvasRacerDescriptor[];
}

function createAmbientFlakes(count: number): AmbientFlake[] {
  const flakes: AmbientFlake[] = [];
  for (let i = 0; i < count; i += 1) {
    flakes.push({
      u: ((i * 37) % 100) / 100,
      v: ((i * 61) % 100) / 100,
      r: 1.4 + (i % 3) * 0.85,
      speedFactor: 0.65 + (i % 4) * 0.22,
    });
  }
  return flakes;
}

function drawStylizedPineTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  ctx.fillStyle = 'rgba(15, 23, 42, 0.12)';
  ctx.beginPath();
  ctx.ellipse(2, 10, 14, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#5C4033';
  ctx.fillRect(-3.5, 0, 7, 10);

  const tiers = [
    { topY: -34, bottomY: -14, halfW: 12 },
    { topY: -24, bottomY: -5, halfW: 16 },
    { topY: -14, bottomY: 3, halfW: 19 },
  ];

  tiers.forEach((tier) => {
    ctx.fillStyle = '#0F766E';
    ctx.beginPath();
    ctx.moveTo(0, tier.topY);
    ctx.lineTo(-tier.halfW, tier.bottomY);
    ctx.lineTo(tier.halfW, tier.bottomY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#F8FAFC';
    ctx.beginPath();
    ctx.moveTo(0, tier.topY);
    ctx.lineTo(-tier.halfW * 0.52, tier.topY + (tier.bottomY - tier.topY) * 0.46);
    ctx.lineTo(tier.halfW * 0.52, tier.topY + (tier.bottomY - tier.topY) * 0.46);
    ctx.closePath();
    ctx.fill();
  });

  ctx.restore();
}

function drawGateBanner(
  ctx: CanvasRenderingContext2D,
  trackLeft: number,
  trackRight: number,
  y: number,
  kind: 'start' | 'finish' | 'checkpoint',
  distanceM: number
): void {
  const trackWidth = trackRight - trackLeft;
  const centerX = (trackLeft + trackRight) / 2;

  if (kind === 'checkpoint') {
    ctx.save();
    ctx.strokeStyle = 'rgba(14, 165, 233, 0.35)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(trackLeft + 10, y);
    ctx.lineTo(trackRight - 10, y);
    ctx.stroke();
    ctx.setLineDash([]);

    const text = `${distanceM} m · ${(distanceM / 1000).toFixed(1)} km`;
    ctx.font = '800 11px system-ui, -apple-system, sans-serif';
    const labelW = Math.max(96, ctx.measureText(text).width + 20);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.strokeStyle = 'rgba(14, 165, 233, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(centerX - labelW / 2, y - 10, labelW, 20, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0369A1';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, centerX, y + 0.5);

    [trackLeft + 6, trackRight - 6].forEach((poleX, idx) => {
      const flagColor = (distanceM / 100 + idx) % 2 === 0 ? '#F97316' : '#0EA5E9';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(poleX, y + 4);
      ctx.lineTo(poleX, y - 20);
      ctx.stroke();

      ctx.fillStyle = flagColor;
      ctx.beginPath();
      const dir = idx === 0 ? 1 : -1;
      ctx.moveTo(poleX, y - 20);
      ctx.lineTo(poleX + dir * 13, y - 15);
      ctx.lineTo(poleX, y - 10);
      ctx.closePath();
      ctx.fill();
    });

    ctx.restore();
    return;
  }

  ctx.save();
  const squareSize = Math.max(10, Math.min(16, Math.floor(trackWidth / 22)));
  const cols = Math.floor((trackWidth - 16) / squareSize);
  const startX = centerX - (cols * squareSize) / 2;

  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const isDark = (row + col) % 2 === 0;
      ctx.fillStyle =
        kind === 'finish'
          ? isDark
            ? '#0F172A'
            : '#FACC15'
          : isDark
            ? '#0284C7'
            : '#FFFFFF';
      ctx.fillRect(
        startX + col * squareSize,
        y - squareSize + row * squareSize,
        squareSize,
        squareSize
      );
    }
  }

  const pillarH = 42;
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(trackLeft + 4, y - pillarH, 7, pillarH + 6);
  ctx.fillRect(trackRight - 11, y - pillarH, 7, pillarH + 6);

  const bannerW = Math.min(trackWidth - 8, 250);
  const bannerH = 24;
  ctx.fillStyle = kind === 'finish' ? '#0F172A' : '#0284C7';
  ctx.beginPath();
  ctx.roundRect(centerX - bannerW / 2, y - pillarH - 6, bannerW, bannerH, 8);
  ctx.fill();
  ctx.strokeStyle = kind === 'finish' ? '#FACC15' : '#BAE6FD';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = kind === 'finish' ? '#FEF08A' : '#FFFFFF';
  ctx.font = '900 12px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    kind === 'finish' ? '🏁 FINISH · 1.00 KM (ပန်းဝင်မျဉ်း)' : '🏂 START · 0.00 KM (တာထွက်မျဉ်း)',
    centerX,
    y - pillarH + bannerH / 2 - 5.5
  );

  ctx.restore();
}

function renderDownhillSlopeWorld(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  currentDpr: number,
  reducedMotion: boolean,
  nowMs: number,
  flakes: readonly AmbientFlake[],
  world: WorldRenderFrame
): void {
  ctx.save();
  ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);

  if (
    !reducedMotion &&
    world.allowDangerShake &&
    (world.avalanche.warningLevel === 'danger' || world.avalanche.warningLevel === 'tumble')
  ) {
    const proximityFactor =
      world.avalanche.warningLevel === 'tumble'
        ? 1
        : Math.max(0.25, Math.min(1, (38 - world.avalanche.gapToPlayerM) / 38));
    const amp = MAX_SCREEN_SHAKE_PX * proximityFactor;
    const shakeX = Math.sin(nowMs * 0.043) * amp;
    const shakeY = Math.cos(nowMs * 0.057) * (amp * 0.75);
    ctx.translate(shakeX, shakeY);
  }

  const width = cssWidth;
  const height = cssHeight;
  const horizonY = Math.round(Math.min(76, Math.max(48, height * 0.11)));

  // 1. Alpine Sky Header Band
  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
  skyGrad.addColorStop(0, '#0284C7');
  skyGrad.addColorStop(1, '#BAE6FD');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(-6, -6, width + 12, horizonY + 10);

  // Distant Snow-Capped Mountain Peaks along Horizon
  ctx.fillStyle = '#E0F2FE';
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  const peakCount = 5;
  for (let i = 0; i <= peakCount; i += 1) {
    const px = (width / peakCount) * i;
    const py = horizonY - (i % 2 === 0 ? 18 : 30);
    ctx.lineTo(px, py);
    ctx.lineTo(px + width / (peakCount * 2), horizonY);
  }
  ctx.lineTo(width, horizonY);
  ctx.closePath();
  ctx.fill();

  // 2. Main Snowy Mountain Slope Surface
  const slopeGrad = ctx.createLinearGradient(0, horizonY, 0, height);
  slopeGrad.addColorStop(0, '#F0F9FF');
  slopeGrad.addColorStop(0.55, '#E0F2FE');
  slopeGrad.addColorStop(1, '#CFE8FF');
  ctx.fillStyle = slopeGrad;
  ctx.fillRect(-6, horizonY, width + 12, height - horizonY + 8);

  const sideMargin = Math.max(36, Math.min(130, Math.round(width * 0.13)));
  const trackLeft = sideMargin;
  const trackRight = width - sideMargin;
  const trackWidth = Math.max(180, trackRight - trackLeft);
  const trackCenterX = (trackLeft + trackRight) / 2;
  const trackHalfUsable = trackWidth * 0.46;

  const racerScale = width < 430 ? 0.92 : 1.05;
  const pixelsPerMeter = PIXELS_PER_METER_BASE * (width < 430 ? 0.92 : 1.04);
  const playerAnchorY = Math.round(horizonY + (height - horizonY) * 0.33);

  ctx.save();
  ctx.beginPath();
  ctx.rect(-6, horizonY, width + 12, height - horizonY + 8);
  ctx.clip();

  // Side powder snowbanks outside track edges
  ctx.fillStyle = '#C3E0FC';
  ctx.fillRect(-6, horizonY, trackLeft + 6, height - horizonY + 8);
  ctx.fillRect(trackRight, horizonY, width - trackRight + 6, height - horizonY + 8);

  // Groomed ski run center lane surface
  ctx.fillStyle = '#F8FBFF';
  ctx.fillRect(trackLeft, horizonY, trackWidth, height - horizonY + 8);

  // Soft powder border lines along left & right edges of ski run
  ctx.strokeStyle = '#93C5FD';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(trackLeft, horizonY);
  ctx.lineTo(trackLeft, height + 6);
  ctx.moveTo(trackRight, horizonY);
  ctx.lineTo(trackRight, height + 6);
  ctx.stroke();

  // 3. Distance-Driven World Scroll
  const playerDistM = world.cameraDistanceM;
  const visibleMetersAbove = (playerAnchorY - horizonY) / pixelsPerMeter + 12;
  const visibleMetersBelow = (height - playerAnchorY) / pixelsPerMeter + 14;
  const minVisibleM = Math.max(-20, playerDistM - visibleMetersAbove);
  const maxVisibleM = Math.min(COURSE_LENGTH_M + 35, playerDistM + visibleMetersBelow);

  const renderMetrics: ObstacleRenderMetrics = {
    ctx,
    trackLeft,
    trackRight,
    trackCenterX,
    trackHalfUsable,
    horizonY,
    canvasWidth: width,
    canvasHeight: height,
    playerAnchorY,
    playerDistM,
    pixelsPerMeter,
    scale: racerScale,
    nowMs,
    reducedMotion,
  };

  // Corduroy snow grooves every 8m
  const firstGrooveM = Math.floor(minVisibleM / 8) * 8;
  ctx.strokeStyle = 'rgba(186, 230, 253, 0.55)';
  ctx.lineWidth = 1.5;
  for (let m = firstGrooveM; m <= maxVisibleM; m += 8) {
    const grooveY = playerAnchorY + (m - playerDistM) * pixelsPerMeter;
    ctx.beginPath();
    ctx.moveTo(trackLeft + 14, grooveY);
    ctx.lineTo(trackRight - 14, grooveY);
    ctx.stroke();
  }

  // Center subtle lane guide dashes
  const firstDashM = Math.floor(minVisibleM / 12) * 12;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.lineWidth = 2;
  for (let m = firstDashM; m <= maxVisibleM; m += 12) {
    const y1 = playerAnchorY + (m - playerDistM) * pixelsPerMeter;
    const y2 = y1 + 4.5 * pixelsPerMeter;
    ctx.beginPath();
    ctx.moveTo(trackCenterX, y1);
    ctx.lineTo(trackCenterX, y2);
    ctx.stroke();
  }

  // 4. Surface Obstacles (`ice_patch` and `jump_ramp`)
  const obstacles = world.obstacles;
  for (let i = 0; i < obstacles.length; i += 1) {
    const obs = obstacles[i];
    if (obs.distanceM < minVisibleM - 5) continue;
    if (obs.distanceM > maxVisibleM + 5) break;
    if (obs.kind === 'ice_patch' || obs.kind === 'jump_ramp') {
      drawSurfaceObstacle(obs, renderMetrics);
    }
  }

  // 5. Start Gate (0 m), 100m Checkpoints, and Finish Gate (1,000 m)
  const firstMarkerM =
    Math.max(0, Math.floor(minVisibleM / DISTANCE_MARKER_INTERVAL_M)) *
    DISTANCE_MARKER_INTERVAL_M;
  for (
    let markerM = firstMarkerM;
    markerM <= Math.min(COURSE_LENGTH_M, maxVisibleM);
    markerM += DISTANCE_MARKER_INTERVAL_M
  ) {
    const markerY = playerAnchorY + (markerM - playerDistM) * pixelsPerMeter;
    if (markerM === 0) {
      drawGateBanner(ctx, trackLeft, trackRight, markerY, 'start', 0);
    } else if (markerM === COURSE_LENGTH_M) {
      drawGateBanner(ctx, trackLeft, trackRight, markerY, 'finish', COURSE_LENGTH_M);
    } else {
      drawGateBanner(ctx, trackLeft, trackRight, markerY, 'checkpoint', markerM);
    }
  }

  // 6. Decorative Sideline Alpine Pine Trees
  const treeSpacingM = 9;
  const firstTreeIdx = Math.floor(minVisibleM / treeSpacingM);
  const lastTreeIdx = Math.ceil(maxVisibleM / treeSpacingM);
  const treeScale = width < 430 ? 0.78 : 0.96;

  for (let idx = firstTreeIdx; idx <= lastTreeIdx; idx += 1) {
    const treeM = idx * treeSpacingM;
    const treeY = playerAnchorY + (treeM - playerDistM) * pixelsPerMeter;
    const jitter = ((Math.abs(idx * 29) % 10) / 10) * Math.max(4, sideMargin - 28);

    const leftTreeX = Math.max(16, trackLeft - 18 - jitter);
    const rightTreeX = Math.min(width - 16, trackRight + 18 + jitter);

    drawStylizedPineTree(ctx, leftTreeX, treeY, treeScale);
    if (idx % 2 === 0) {
      drawStylizedPineTree(ctx, rightTreeX, treeY + 14, treeScale * 0.92);
    }
  }

  // 7. Local Player Dual Snowboard Carve Track Trail
  const trail = world.trail;
  if (trail.length >= 2) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < trail.length; i += 1) {
      const prevPt = trail[i - 1];
      const currPt = trail[i];
      if (Math.abs(currPt.distanceM - prevPt.distanceM) > 8) continue;

      const x1 = trackCenterX + prevPt.laneOffset * trackHalfUsable;
      const y1 = playerAnchorY + (prevPt.distanceM - playerDistM) * pixelsPerMeter + 10;
      const x2 = trackCenterX + currPt.laneOffset * trackHalfUsable;
      const y2 = playerAnchorY + (currPt.distanceM - playerDistM) * pixelsPerMeter + 10;

      const alpha = (i / trail.length) * (0.24 + currPt.carveAmount * 0.24);
      ctx.strokeStyle = currPt.nitroActive
        ? `rgba(245, 158, 11, ${Math.min(0.85, alpha * 1.9).toFixed(2)})`
        : `rgba(56, 189, 248, ${alpha.toFixed(2)})`;
      ctx.lineWidth = (currPt.nitroActive ? 6.2 : 5) * racerScale;
      ctx.beginPath();
      ctx.moveTo(x1 - 6 * racerScale, y1);
      ctx.lineTo(x2 - 6 * racerScale, y2);
      ctx.moveTo(x1 + 6 * racerScale, y1);
      ctx.lineTo(x2 + 6 * racerScale, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 8. Depth-Sorted World Entities
  interface DepthSortedItem {
    sortY: number;
    draw: () => void;
  }
  const depthItems: DepthSortedItem[] = [];

  // 8A. Unpicked Item Boxes
  for (let i = 0; i < world.itemBoxes.length; i += 1) {
    const box = world.itemBoxes[i];
    if (box.pickedUpByRacerId !== null) continue;
    if (box.distanceM < minVisibleM - 4) continue;
    if (box.distanceM > maxVisibleM + 4) break;
    const boxY = playerAnchorY + (box.distanceM - playerDistM) * pixelsPerMeter;
    depthItems.push({
      sortY: boxY,
      draw: () => drawItemBox(box, renderMetrics),
    });
  }

  // 8B. Placed Snow Traps
  for (let i = 0; i < world.traps.length; i += 1) {
    const trap = world.traps[i];
    if (!trap.active) continue;
    if (trap.distanceM < minVisibleM - 4 || trap.distanceM > maxVisibleM + 4) continue;
    const trapY = playerAnchorY + (trap.distanceM - playerDistM) * pixelsPerMeter;
    depthItems.push({
      sortY: trapY - 2,
      draw: () => drawSnowTrap(trap as SnowRushTrap, renderMetrics),
    });
  }

  // 8C. Flying Snowball Projectiles
  for (let i = 0; i < world.projectiles.length; i += 1) {
    const proj = world.projectiles[i];
    if (!proj.active) continue;
    if (proj.distanceM < minVisibleM - 6 || proj.distanceM > maxVisibleM + 6) continue;
    const projY = playerAnchorY + (proj.distanceM - playerDistM) * pixelsPerMeter;
    depthItems.push({
      sortY: projY + 2,
      draw: () => drawSnowballProjectile(proj as SnowRushProjectile, renderMetrics),
    });
  }

  // 8D. Upright Obstacles
  for (let i = 0; i < obstacles.length; i += 1) {
    const obs = obstacles[i];
    if (obs.distanceM < minVisibleM - 5) continue;
    if (obs.distanceM > maxVisibleM + 5) break;
    if (obs.kind === 'ice_patch' || obs.kind === 'jump_ramp') continue;

    const obsY = playerAnchorY + (obs.distanceM - playerDistM) * pixelsPerMeter;
    const wasHit = world.interactedObstacleIds.includes(obs.id);
    depthItems.push({
      sortY: obsY,
      draw: () => drawUprightObstacle(obs, renderMetrics, wasHit),
    });
  }

  // 8E. Racers (Local Mode: Player + Offline Bots | Multiplayer Mode: 2–4 Human Players ONLY)
  for (let i = 0; i < world.racers.length; i += 1) {
    const r = world.racers[i];
    const racerY = r.isLocalPlayer
      ? playerAnchorY
      : playerAnchorY + (r.distanceM - playerDistM) * pixelsPerMeter;
    const racerX = trackCenterX + r.laneOffset * trackHalfUsable;

    if (r.isLocalPlayer || (racerY >= horizonY - 40 && racerY <= height + 65)) {
      depthItems.push({
        sortY: racerY,
        draw: () =>
          drawChibiRacer({
            ctx,
            x: racerX,
            y: racerY,
            scale: racerScale * r.scaleMult,
            carveTilt: r.carveTilt,
            jumpHeightPx: r.jumpHeightPx,
            isJumping: r.isJumping,
            speedMps: r.speedMps,
            scarfPhase: r.scarfPhase,
            label: r.label,
            isLocalPlayer: r.isLocalPlayer,
            isOfflineBot: r.isOfflineBot,
            palette: r.palette,
            reducedMotion,
            tumbleTimerSec: r.tumbleTimerSec,
            spinTimerSec: r.spinTimerSec,
            invulnerableTimerSec: r.invulnerableTimerSec,
            iceSlipTimerSec: r.iceSlipTimerSec,
            landingBoostTimerSec: r.landingBoostTimerSec,
            nitroTimerSec: r.nitroTimerSec,
            shieldTimerSec: r.shieldTimerSec,
            shieldBreakAnimTimerSec: r.shieldBreakAnimTimerSec,
            mercyInvulnTimerSec: r.mercyInvulnTimerSec,
          }),
      });
    } else if (world.showOffscreenRivalBadges) {
      const deltaM = Math.round(r.distanceM - playerDistM);
      const indicatorY = racerY < horizonY ? horizonY + 18 : height - 92;
      const clampedX = Math.max(trackLeft + 44, Math.min(trackRight - 44, racerX));
      const badgeText = `${r.offscreenTag} ${deltaM > 0 ? `+${deltaM}m` : `${deltaM}m`}`;

      ctx.save();
      ctx.font = '700 10px system-ui, -apple-system, sans-serif';
      const badgeW = Math.max(76, Math.min(132, ctx.measureText(badgeText).width + (r.offscreenColorHex ? 28 : 18)));
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.beginPath();
      ctx.roundRect(clampedX - badgeW / 2, indicatorY - 10, badgeW, 20, 10);
      ctx.fill();

      if (r.offscreenColorHex) {
        ctx.fillStyle = r.offscreenColorHex;
        ctx.beginPath();
        ctx.arc(clampedX - badgeW / 2 + 10, indicatorY, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#E2E8F0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, clampedX + (r.offscreenColorHex ? 4 : 0), indicatorY + 0.5);
      ctx.restore();
    }
  }

  depthItems
    .sort((a, b) => a.sortY - b.sortY)
    .forEach((item) => item.draw());

  // 8F. World Particle Bursts
  for (let i = 0; i < world.visualBursts.length; i += 1) {
    const burst = world.visualBursts[i];
    if (burst.distanceM < minVisibleM - 6 || burst.distanceM > maxVisibleM + 6) continue;
    drawVisualBurst(burst, renderMetrics);
  }

  // 9. Roaring Avalanche Snow Wave
  drawAvalancheWave(world.avalanche as AvalancheState, renderMetrics);

  // 10. Gentle Ambient Snowflakes
  if (!reducedMotion) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    const tSec = nowMs * 0.001;
    const scrollBoost = world.cameraSpeedMps * 0.018;
    flakes.forEach((flake, idx) => {
      const fx = ((flake.u + Math.sin(tSec * 0.7 + idx) * 0.03 + 1) % 1) * width;
      const fy =
        horizonY +
        (((flake.v - (tSec * 0.08 + scrollBoost * 0.04) * flake.speedFactor) % 1 + 1) % 1) *
          (height - horizonY);
      ctx.beginPath();
      ctx.arc(fx, fy, flake.r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.restore(); // End slope clip
  ctx.restore(); // End DPR & shake transform
}

export const SnowRushCanvas: React.FC<SnowRushCanvasProps> = (props) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const flakesRef = useRef<AmbientFlake[]>(createAmbientFlakes(26));
  const localUidRef = useRef<string | null>(props.mode === 'multiplayer' ? props.localUid : null);
  localUidRef.current = props.mode === 'multiplayer' ? props.localUid : null;

  const isMultiplayerMode = props.mode === 'multiplayer';
  const localSimStateRef = !isMultiplayerMode ? props.simStateRef : null;
  const localInputStateRef = !isMultiplayerMode ? props.inputStateRef : null;
  const localConsumeOneShot = !isMultiplayerMode ? props.onConsumeOneShotInputs : undefined;
  const localOnHudSync = !isMultiplayerMode ? props.onHudSync : undefined;
  const localOnPhaseChange = !isMultiplayerMode ? props.onPhaseChange : undefined;
  const localOnSimEvents = !isMultiplayerMode ? props.onSimulationEvents : undefined;

  const mpInterpolatorRef = isMultiplayerMode ? props.interpolatorRef : null;
  const mpVisualBurstsRef = isMultiplayerMode ? props.visualBurstsRef : null;
  const mpOnHudSync = isMultiplayerMode ? props.onHudSync : undefined;
  const mpOnAmbientSound = isMultiplayerMode ? props.onAmbientMotionSound : undefined;
  const { onClearTransientInputs } = props;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cssWidth = Math.max(300, container.clientWidth || 360);
    let cssHeight = Math.max(360, container.clientHeight || 520);
    let currentDpr = Math.min(window.devicePixelRatio || 1, CANVAS_MAX_DPR);

    const syncCanvasDimensions = () => {
      const rect = container.getBoundingClientRect();
      cssWidth = Math.max(280, Math.floor(rect.width || container.clientWidth || 360));
      cssHeight = Math.max(320, Math.floor(rect.height || container.clientHeight || 480));
      currentDpr = Math.min(window.devicePixelRatio || 1, CANVAS_MAX_DPR);

      const targetW = Math.floor(cssWidth * currentDpr);
      const targetH = Math.floor(cssHeight * currentDpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    };

    syncCanvasDimensions();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        syncCanvasDimensions();
      });
      resizeObserver.observe(container);
    }
    window.addEventListener('resize', syncCanvasDimensions);

    const motionMedia =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let reducedMotion = motionMedia ? motionMedia.matches : false;
    const handleMotionPrefChange = (e: MediaQueryListEvent) => {
      reducedMotion = e.matches;
    };
    if (motionMedia) {
      motionMedia.addEventListener('change', handleMotionPrefChange);
    }

    let lastTimestampMs: number | null = null;
    let lastHudSyncMs = 0;

    // Multiplayer-only cached track & purely visual local carve trail
    let cachedMpTrack: SnowRushTrackLayout | null = null;
    const standbyBackdropTrack = isMultiplayerMode
      ? generateSnowRushTrack(DEFAULT_FALLBACK_TRACK_SEED)
      : null;
    const standbyAvalanche: AvalancheState = {
      distanceM: -90,
      speedMps: 0,
      graceRemainingSec: 4,
      isActive: false,
      warningLevel: 'safe',
      gapToPlayerM: 90,
    };
    let mpLocalTrail: SnowTrailSample[] = [];
    let mpLastSyncedPhase: string | null = null;
    let mpLastSyncedHeldItem: string | null = null;
    let mpLastSyncedItemReady = false;
    let mpLastSyncedFinalized = false;

    const handleVisibilityOrBlur = () => {
      onClearTransientInputs();
      lastTimestampMs = null;
    };

    document.addEventListener('visibilitychange', handleVisibilityOrBlur);
    window.addEventListener('blur', handleVisibilityOrBlur);

    let rafId = 0;
    let cancelled = false;

    const tick = (nowMs: number) => {
      if (cancelled) return;

      if (document.hidden) {
        lastTimestampMs = null;
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      const rawDtSec =
        lastTimestampMs === null ? 1 / 60 : Math.max(0, (nowMs - lastTimestampMs) / 1000);
      lastTimestampMs = nowMs;

      if (!isMultiplayerMode) {
        if (!localSimStateRef || !localInputStateRef) {
          rafId = window.requestAnimationFrame(tick);
          return;
        }

        const prevState = localSimStateRef.current;
        const nextState = stepSnowRushSimulation(prevState, localInputStateRef.current, rawDtSec);
        localSimStateRef.current = nextState;

        if (localConsumeOneShot) {
          localConsumeOneShot();
        }

        if (localOnSimEvents) {
          localOnSimEvents(nextState.events, nextState, nowMs);
        }

        const activeBots: OfflineDemoBotState[] = nextState.showOfflineBots
          ? nextState.offlineDemoBots
          : [];

        const localRacers: CanvasRacerDescriptor[] = activeBots.map((bot) => ({
          id: bot.id,
          distanceM: bot.distanceM,
          laneOffset: bot.laneOffset,
          carveTilt: bot.carveTilt,
          jumpHeightPx: bot.jumpHeightPx,
          isJumping: bot.isJumping,
          speedMps: bot.speedMps,
          scarfPhase: bot.scarfPhase,
          label: `${bot.shortTag} · Offline`,
          offscreenTag: bot.shortTag,
          offscreenColorHex: null,
          isLocalPlayer: false,
          isOfflineBot: true,
          palette: {
            jacketColor: bot.jacketColor,
            hatColor: bot.hatColor,
            scarfColor: bot.scarfColor,
            boardColor: bot.boardColor,
          },
          scaleMult: 0.95,
          tumbleTimerSec: bot.tumbleTimerSec,
          spinTimerSec: bot.spinTimerSec,
          invulnerableTimerSec: bot.invulnerableTimerSec,
          iceSlipTimerSec: bot.iceSlipTimerSec,
          landingBoostTimerSec: bot.landingBoostTimerSec,
          nitroTimerSec: bot.nitroTimerSec,
          shieldTimerSec: bot.shieldTimerSec,
          shieldBreakAnimTimerSec: bot.shieldBreakAnimTimerSec,
          mercyInvulnTimerSec: bot.mercyInvulnTimerSec,
        }));

        localRacers.push({
          id: nextState.player.id,
          distanceM: nextState.player.distanceM,
          laneOffset: nextState.player.laneOffset,
          carveTilt: nextState.player.carveTilt,
          jumpHeightPx: nextState.player.jumpHeightPx,
          isJumping: nextState.player.isJumping,
          speedMps: nextState.player.speedMps,
          scarfPhase: nextState.player.scarfPhase,
          label: nextState.player.displayName,
          offscreenTag: nextState.player.displayName,
          offscreenColorHex: null,
          isLocalPlayer: true,
          isOfflineBot: false,
          palette: PLAYER_DEFAULT_PALETTE,
          scaleMult: 1,
          tumbleTimerSec: nextState.player.tumbleTimerSec,
          spinTimerSec: nextState.player.spinTimerSec,
          invulnerableTimerSec: nextState.player.invulnerableTimerSec,
          iceSlipTimerSec: nextState.player.iceSlipTimerSec,
          landingBoostTimerSec: nextState.player.landingBoostTimerSec,
          nitroTimerSec: nextState.player.nitroTimerSec,
          shieldTimerSec: nextState.player.shieldTimerSec,
          shieldBreakAnimTimerSec: nextState.player.shieldBreakAnimTimerSec,
          mercyInvulnTimerSec: nextState.player.mercyInvulnTimerSec,
        });

        renderDownhillSlopeWorld(
          ctx,
          cssWidth,
          cssHeight,
          currentDpr,
          reducedMotion,
          nowMs,
          flakesRef.current,
          {
            cameraDistanceM: nextState.player.distanceM,
            cameraSpeedMps: nextState.player.speedMps,
            allowDangerShake: nextState.phase === 'racing',
            showOffscreenRivalBadges: nextState.phase === 'racing',
            avalanche: nextState.avalanche,
            obstacles: nextState.track.obstacles,
            interactedObstacleIds: nextState.player.interactedObstacleIds,
            itemBoxes: nextState.itemBoxes,
            traps: nextState.traps,
            projectiles: nextState.projectiles,
            trail: nextState.player.trail,
            visualBursts: nextState.visualBursts,
            racers: localRacers,
          }
        );

        const phaseChanged = nextState.phase !== prevState.phase;
        if (phaseChanged && localOnPhaseChange) {
          localOnPhaseChange(nextState.phase, prevState.phase);
        }

        const itemStateChanged =
          nextState.player.heldItem !== prevState.player.heldItem ||
          (nextState.player.itemArmingTimerSec <= 0) !==
            (prevState.player.itemArmingTimerSec <= 0);

        if (
          phaseChanged ||
          itemStateChanged ||
          nextState.events.length > 0 ||
          nowMs - lastHudSyncMs >= HUD_SYNC_INTERVAL_MS
        ) {
          lastHudSyncMs = nowMs;
          if (localOnHudSync) {
            localOnHudSync(buildHudSnapshot(nextState));
          }
        }

        rafId = window.requestAnimationFrame(tick);
        return;
      }

      // ======================================================================
      // Online Multiplayer Mode (Zero Local Simulation, Zero Offline Demo Bots)
      // ======================================================================
      if (!mpInterpolatorRef || !mpVisualBurstsRef) {
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      const sampleClockMs = getMonotonicClientNowMs();
      const frame = mpInterpolatorRef.current.sample(sampleClockMs);
      mpVisualBurstsRef.current = decayVisualBursts(mpVisualBurstsRef.current, rawDtSec);

      if (!frame) {
        if (standbyBackdropTrack) {
          renderDownhillSlopeWorld(
            ctx,
            cssWidth,
            cssHeight,
            currentDpr,
            reducedMotion,
            nowMs,
            flakesRef.current,
            {
              cameraDistanceM: 0,
              cameraSpeedMps: 0,
              allowDangerShake: false,
              showOffscreenRivalBadges: false,
              avalanche: standbyAvalanche,
              obstacles: standbyBackdropTrack.obstacles,
              interactedObstacleIds: [],
              itemBoxes: standbyBackdropTrack.itemBoxes,
              traps: [],
              projectiles: [],
              trail: [],
              visualBursts: [],
              racers: [],
            }
          );
        }
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      const scene = reconstructMultiplayerSceneData(frame, cachedMpTrack, localUidRef.current);
      cachedMpTrack = scene.track;
      const cameraRacer = scene.cameraRacer;

      // Update purely visual local carve trail
      if (
        !cameraRacer ||
        frame.racePhase === 'ready' ||
        frame.racePhase === 'countdown'
      ) {
        mpLocalTrail = [];
      } else {
        const lastSample =
          mpLocalTrail.length > 0 ? mpLocalTrail[mpLocalTrail.length - 1] : null;
        if (lastSample && Math.abs(cameraRacer.distanceM - lastSample.distanceM) > 12) {
          mpLocalTrail = [];
        } else if (
          !cameraRacer.isJumping &&
          cameraRacer.tumbleTimerSec <= 0 &&
          (!lastSample ||
            cameraRacer.distanceM - lastSample.distanceM >= TRAIL_SAMPLE_MIN_DELTA_M)
        ) {
          mpLocalTrail.push({
            distanceM: cameraRacer.distanceM,
            laneOffset: cameraRacer.laneOffset,
            carveAmount: Math.abs(cameraRacer.carveTilt),
            nitroActive: cameraRacer.nitroTimerSec > 0,
          });
          if (mpLocalTrail.length > MAX_TRAIL_SAMPLES) {
            mpLocalTrail = mpLocalTrail.slice(mpLocalTrail.length - MAX_TRAIL_SAMPLES);
          }
        }
      }

      // Build ONLY human racers from authoritative `frame.racerOrder` (2–4 players, zero bots)
      const humanRacers: CanvasRacerDescriptor[] = [];
      for (let i = 0; i < frame.racerOrder.length; i += 1) {
        const uid = frame.racerOrder[i];
        const r = frame.racers[uid];
        if (!r) continue;
        const isLocal = uid === scene.resolvedLocalUid;
        const shortName =
          r.displayName.length > 10 ? `${r.displayName.slice(0, 9)}…` : r.displayName;

        humanRacers.push({
          id: r.uid,
          distanceM: r.distanceM,
          laneOffset: r.laneOffset,
          carveTilt: r.carveTilt,
          jumpHeightPx: r.jumpHeightPx,
          isJumping: r.isJumping,
          speedMps: r.speedMps,
          scarfPhase: r.scarfPhase,
          label: isLocal
            ? r.displayName
            : r.isConnected
              ? r.displayName
              : `${r.displayName} (လိုင်းပြတ်)`,
          offscreenTag: shortName,
          offscreenColorHex: r.color || '#0EA5E9',
          isLocalPlayer: isLocal,
          isOfflineBot: false,
          palette: deriveRacerPaletteFromHex(r.color, isLocal),
          scaleMult: isLocal ? 1 : 0.96,
          tumbleTimerSec: r.tumbleTimerSec,
          spinTimerSec: r.spinTimerSec,
          invulnerableTimerSec: r.invulnerableTimerSec,
          iceSlipTimerSec: r.iceSlipTimerSec,
          landingBoostTimerSec: r.landingBoostTimerSec,
          nitroTimerSec: r.nitroTimerSec,
          shieldTimerSec: r.shieldTimerSec,
          shieldBreakAnimTimerSec: r.shieldBreakAnimTimerSec,
          mercyInvulnTimerSec: r.mercyInvulnTimerSec,
        });
      }

      const isActiveRacePhase =
        frame.racePhase === 'racing' || frame.racePhase === 'finish_window';

      renderDownhillSlopeWorld(
        ctx,
        cssWidth,
        cssHeight,
        currentDpr,
        reducedMotion,
        nowMs,
        flakesRef.current,
        {
          cameraDistanceM: cameraRacer ? cameraRacer.distanceM : 0,
          cameraSpeedMps: cameraRacer ? cameraRacer.speedMps : 0,
          allowDangerShake: isActiveRacePhase,
          showOffscreenRivalBadges: isActiveRacePhase,
          avalanche: scene.localAvalanche,
          obstacles: scene.track.obstacles,
          interactedObstacleIds: cameraRacer ? cameraRacer.interactedObstacleIds : [],
          itemBoxes: scene.itemBoxes,
          traps: frame.activeTraps,
          projectiles: frame.activeProjectiles,
          trail: mpLocalTrail,
          visualBursts: mpVisualBurstsRef.current,
          racers: humanRacers,
        }
      );

      if (mpOnAmbientSound && cameraRacer && isActiveRacePhase) {
        mpOnAmbientSound({
          nitroActive: cameraRacer.nitroTimerSec > 0,
          carvingActive:
            !cameraRacer.isJumping &&
            cameraRacer.tumbleTimerSec <= 0 &&
            Math.abs(cameraRacer.carveTilt) > 0.42 &&
            cameraRacer.speedMps > 9,
          nowMs,
        });
      }

      const heldItemNow = cameraRacer ? cameraRacer.heldItem : null;
      const itemReadyNow = Boolean(
        cameraRacer &&
          cameraRacer.heldItem !== null &&
          cameraRacer.itemArmingTimerSec <= 0 &&
          cameraRacer.tumbleTimerSec <= 0 &&
          cameraRacer.finishTimeMs === null
      );
      const finalizedNow = frame.finishState.finalized;

      const discreteHudChange =
        frame.racePhase !== mpLastSyncedPhase ||
        heldItemNow !== mpLastSyncedHeldItem ||
        itemReadyNow !== mpLastSyncedItemReady ||
        finalizedNow !== mpLastSyncedFinalized;

      if (discreteHudChange || nowMs - lastHudSyncMs >= HUD_SYNC_INTERVAL_MS) {
        lastHudSyncMs = nowMs;
        mpLastSyncedPhase = frame.racePhase;
        mpLastSyncedHeldItem = heldItemNow;
        mpLastSyncedItemReady = itemReadyNow;
        mpLastSyncedFinalized = finalizedNow;

        if (mpOnHudSync) {
          const built = buildMultiplayerHudSnapshot(frame, localUidRef.current);
          mpOnHudSync(built.hud, built.extras);
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };

    if (!isMultiplayerMode && localSimStateRef && localOnHudSync) {
      localOnHudSync(buildHudSnapshot(localSimStateRef.current));
    }
    rafId = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', syncCanvasDimensions);
      document.removeEventListener('visibilitychange', handleVisibilityOrBlur);
      window.removeEventListener('blur', handleVisibilityOrBlur);
      if (motionMedia) {
        motionMedia.removeEventListener('change', handleMotionPrefChange);
      }
    };
  }, [
    isMultiplayerMode,
    localSimStateRef,
    localInputStateRef,
    localConsumeOneShot,
    localOnHudSync,
    localOnPhaseChange,
    localOnSimEvents,
    mpInterpolatorRef,
    mpVisualBurstsRef,
    mpOnHudSync,
    mpOnAmbientSound,
    onClearTransientInputs,
  ]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none bg-sky-100"
    >
      <canvas
        ref={canvasRef}
        aria-label="Snow Rush: Avalanche Escape 2D Downhill Course"
        className="block w-full h-full touch-none"
      />
    </div>
  );
};
