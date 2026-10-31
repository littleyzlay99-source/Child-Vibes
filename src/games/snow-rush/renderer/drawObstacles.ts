import { ROCK_SPIN_PENALTY_SEC, SNOW_TUMBLE_DURATION_SEC } from '../constants';
import type { AvalancheState, SnowRushObstacle } from '../types';

export interface ObstacleRenderMetrics {
  ctx: CanvasRenderingContext2D;
  trackLeft: number;
  trackRight: number;
  trackCenterX: number;
  trackHalfUsable: number;
  horizonY: number;
  canvasWidth: number;
  canvasHeight: number;
  playerAnchorY: number;
  playerDistM: number;
  pixelsPerMeter: number;
  scale: number;
  nowMs: number;
  reducedMotion: boolean;
}

/**
 * Renders surface-level track features (`ice_patch` and `jump_ramp`) directly onto the snow slope
 * beneath racers and upright obstacles, aligned 1:1 with their world collision coordinates.
 */
export function drawSurfaceObstacle(
  obs: SnowRushObstacle,
  metrics: ObstacleRenderMetrics
): void {
  const {
    ctx,
    trackCenterX,
    trackHalfUsable,
    playerAnchorY,
    playerDistM,
    pixelsPerMeter,
  } = metrics;

  const x = trackCenterX + obs.laneOffset * trackHalfUsable;
  const y = playerAnchorY + (obs.distanceM - playerDistM) * pixelsPerMeter;
  const halfW = Math.max(16, obs.halfWidthLane * trackHalfUsable);
  const halfH = Math.max(14, obs.halfLengthM * pixelsPerMeter);

  if (obs.kind === 'ice_patch') {
    ctx.save();
    ctx.translate(x, y);

    const iceGrad = ctx.createLinearGradient(-halfW, -halfH, halfW, halfH);
    iceGrad.addColorStop(0, 'rgba(125, 211, 252, 0.78)');
    iceGrad.addColorStop(0.5, 'rgba(186, 230, 253, 0.92)');
    iceGrad.addColorStop(1, 'rgba(56, 189, 248, 0.76)');

    ctx.fillStyle = iceGrad;
    ctx.strokeStyle = 'rgba(2, 132, 199, 0.68)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, halfW, halfH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Specular glare streaks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.48, -halfH * 0.35);
    ctx.lineTo(halfW * 0.22, halfH * 0.42);
    ctx.moveTo(-halfW * 0.08, -halfH * 0.52);
    ctx.lineTo(halfW * 0.48, halfH * 0.08);
    ctx.stroke();

    ctx.restore();
    return;
  }

  if (obs.kind === 'jump_ramp') {
    ctx.save();
    ctx.translate(x, y);

    // Soft drop shadow at launch lip (bottom edge = down-slope)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.2)';
    ctx.beginPath();
    ctx.roundRect(-halfW - 2, -halfH + 4, halfW * 2 + 4, halfH * 2, 7);
    ctx.fill();

    // Angled wooden/alpine kicker deck
    const rampGrad = ctx.createLinearGradient(0, -halfH, 0, halfH);
    rampGrad.addColorStop(0, '#FEF3C7');
    rampGrad.addColorStop(0.55, '#F59E0B');
    rampGrad.addColorStop(1, '#EA580C');

    ctx.fillStyle = rampGrad;
    ctx.strokeStyle = '#7C2D12';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.86, -halfH);
    ctx.lineTo(halfW * 0.86, -halfH);
    ctx.lineTo(halfW, halfH);
    ctx.lineTo(-halfW, halfH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Crisp side rails
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-halfW + 1.5, -halfH + 2, 3.5, halfH * 2 - 4);
    ctx.fillRect(halfW - 5, -halfH + 2, 3.5, halfH * 2 - 4);

    // Downhill launch chevrons (pointing downward = direction of travel)
    ctx.strokeStyle = '#FFFBEB';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    [-0.28, 0.22].forEach((offsetRatio) => {
      const cy = halfH * offsetRatio;
      ctx.beginPath();
      ctx.moveTo(-halfW * 0.42, cy - 5);
      ctx.lineTo(0, cy + 4);
      ctx.lineTo(halfW * 0.42, cy - 5);
      ctx.stroke();
    });

    ctx.restore();
  }
}

/**
 * Renders upright obstacles (`pine_tree`, `rock`, `snow_mound`, `slalom_gate`)
 * sorted back-to-front by screen Y alongside Chibi racers.
 */
export function drawUprightObstacle(
  obs: SnowRushObstacle,
  metrics: ObstacleRenderMetrics,
  wasHitByPlayer: boolean
): void {
  const {
    ctx,
    trackCenterX,
    trackHalfUsable,
    playerAnchorY,
    playerDistM,
    pixelsPerMeter,
    scale,
  } = metrics;

  const y = playerAnchorY + (obs.distanceM - playerDistM) * pixelsPerMeter;

  if (obs.kind === 'slalom_gate') {
    ctx.save();
    // Subtle open corridor guide chevron so player sees the clear gate well ahead
    if (obs.openCenterLane !== undefined && obs.openHalfWidthLane !== undefined) {
      const gateCenterX = trackCenterX + obs.openCenterLane * trackHalfUsable;
      const gateHalfPx = obs.openHalfWidthLane * trackHalfUsable;

      ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
      ctx.fillRect(gateCenterX - gateHalfPx + 4, y - 10, (gateHalfPx - 4) * 2, 20);

      // Left & right green/amber slalom gate flags framing the passable opening
      [gateCenterX - gateHalfPx + 3, gateCenterX + gateHalfPx - 3].forEach((poleX, idx) => {
        ctx.strokeStyle = '#0F172A';
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.moveTo(poleX, y + 4);
        ctx.lineTo(poleX, y - 28 * scale);
        ctx.stroke();

        ctx.fillStyle = idx === 0 ? '#10B981' : '#F59E0B';
        const dir = idx === 0 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(poleX, y - 28 * scale);
        ctx.lineTo(poleX + dir * 13 * scale, y - 22 * scale);
        ctx.lineTo(poleX, y - 16 * scale);
        ctx.closePath();
        ctx.fill();
      });
    }

    // Blocked safety barrier spans
    (obs.blockedSpans || []).forEach((span) => {
      const x1 = trackCenterX + span.minLane * trackHalfUsable;
      const x2 = trackCenterX + span.maxLane * trackHalfUsable;
      const spanW = Math.max(10, x2 - x1);
      const fenceH = 20 * scale;

      // Ground shadow
      ctx.fillStyle = 'rgba(15, 23, 42, 0.18)';
      ctx.fillRect(x1, y + 1, spanW, 6);

      // End posts
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(x1, y - fenceH - 3, 5, fenceH + 6);
      ctx.fillRect(x2 - 5, y - fenceH - 3, 5, fenceH + 6);

      // Striped alpine safety barrier banner
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x1 + 3, y - fenceH, Math.max(4, spanW - 6), fenceH - 4, 4);
      ctx.clip();

      ctx.fillStyle = wasHitByPlayer ? '#94A3B8' : '#EF4444';
      ctx.fillRect(x1, y - fenceH, spanW, fenceH);

      ctx.fillStyle = '#FFFFFF';
      const stripeStep = 16;
      for (let sx = x1 - 16; sx < x2 + 16; sx += stripeStep) {
        ctx.beginPath();
        ctx.moveTo(sx, y - fenceH);
        ctx.lineTo(sx + 8, y - fenceH);
        ctx.lineTo(sx + 2, y);
        ctx.lineTo(sx - 6, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(x1 + 3, y - fenceH, Math.max(4, spanW - 6), fenceH - 4, 4);
      ctx.stroke();
    });

    ctx.restore();
    return;
  }

  const x = trackCenterX + obs.laneOffset * trackHalfUsable;
  const halfW = Math.max(15, obs.halfWidthLane * trackHalfUsable);

  if (obs.kind === 'pine_tree') {
    ctx.save();
    ctx.translate(x, y);

    // Base shadow matching world collision width
    ctx.fillStyle = 'rgba(15, 23, 42, 0.24)';
    ctx.beginPath();
    ctx.ellipse(0, 5, halfW * 0.96, 8 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Sturdy trunk
    ctx.fillStyle = '#451A03';
    ctx.fillRect(-4.5 * scale, -4 * scale, 9 * scale, 12 * scale);

    // Tall 3-tier alpine spruce (clearly taller than jump height -> unjumpable)
    const tiers = [
      { topY: -48 * scale, bottomY: -22 * scale, w: halfW * 0.72 },
      { topY: -34 * scale, bottomY: -10 * scale, w: halfW * 0.92 },
      { topY: -20 * scale, bottomY: 2 * scale, w: halfW * 1.08 },
    ];

    tiers.forEach((tier) => {
      ctx.fillStyle = wasHitByPlayer ? '#115E59' : '#065F46';
      ctx.strokeStyle = '#022C22';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, tier.topY);
      ctx.lineTo(-tier.w, tier.bottomY);
      ctx.lineTo(tier.w, tier.bottomY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Crisp white snow cap
      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.moveTo(0, tier.topY);
      ctx.lineTo(-tier.w * 0.48, tier.topY + (tier.bottomY - tier.topY) * 0.42);
      ctx.lineTo(tier.w * 0.48, tier.topY + (tier.bottomY - tier.topY) * 0.42);
      ctx.closePath();
      ctx.fill();
    });

    ctx.restore();
    return;
  }

  if (obs.kind === 'rock') {
    ctx.save();
    ctx.translate(x, y);

    // Ground shadow
    ctx.fillStyle = 'rgba(15, 23, 42, 0.22)';
    ctx.beginPath();
    ctx.ellipse(0, 4, halfW * 0.96, 7 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Faceted low granite boulder (compact profile signals jumpable)
    const h = 18 * scale;
    ctx.fillStyle = '#475569';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.9, 3);
    ctx.lineTo(-halfW * 0.72, -h * 0.72);
    ctx.lineTo(-halfW * 0.15, -h);
    ctx.lineTo(halfW * 0.55, -h * 0.8);
    ctx.lineTo(halfW * 0.9, 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Sunlit rock facet + snow dusting
    ctx.fillStyle = '#94A3B8';
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.62, -h * 0.65);
    ctx.lineTo(-halfW * 0.15, -h);
    ctx.lineTo(halfW * 0.2, -h * 0.42);
    ctx.lineTo(-halfW * 0.35, -h * 0.2);
    ctx.closePath();
    ctx.fill();

    // Snow rim at base
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.85, 3.5);
    ctx.quadraticCurveTo(0, 6.5, halfW * 0.85, 3.5);
    ctx.stroke();

    ctx.restore();
    return;
  }

  if (obs.kind === 'snow_mound') {
    ctx.save();
    ctx.translate(x, y);

    // Soft cyan-blue base shadow
    ctx.fillStyle = 'rgba(56, 189, 248, 0.32)';
    ctx.beginPath();
    ctx.ellipse(0, 4, halfW, 7.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Fluffy mogul snow bump (low jumpable mound)
    const moundH = 15 * scale;
    const moundGrad = ctx.createLinearGradient(0, -moundH, 0, 5);
    moundGrad.addColorStop(0, '#FFFFFF');
    moundGrad.addColorStop(1, '#BAE6FD');

    ctx.fillStyle = moundGrad;
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.95, 3);
    ctx.quadraticCurveTo(-halfW * 0.45, -moundH * 1.15, 0, -moundH);
    ctx.quadraticCurveTo(halfW * 0.5, -moundH * 1.1, halfW * 0.95, 3);
    ctx.quadraticCurveTo(0, 6, -halfW * 0.95, 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }
}

/**
 * Draws the roaring Avalanche snow wave behind racers, driven 100% by `avalanche.distanceM`.
 */
export function drawAvalancheWave(
  avalanche: AvalancheState,
  metrics: ObstacleRenderMetrics
): void {
  const {
    ctx,
    horizonY,
    canvasWidth,
    canvasHeight,
    playerAnchorY,
    playerDistM,
    pixelsPerMeter,
    nowMs,
    reducedMotion,
  } = metrics;

  const frontY = playerAnchorY + (avalanche.distanceM - playerDistM) * pixelsPerMeter;
  const gapM = avalanche.gapToPlayerM;
  const t = reducedMotion ? 0 : nowMs * 0.006;

  // 1. Looming crest cloud over mountain horizon when Avalanche is within 75m behind
  if (avalanche.isActive && gapM <= 75) {
    const proximity = Math.max(0, Math.min(1, (75 - gapM) / 55));
    const crestDepth = 8 + proximity * 18;
    ctx.save();
    const mistGrad = ctx.createLinearGradient(0, horizonY - 10, 0, horizonY + crestDepth + 18);
    mistGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    mistGrad.addColorStop(0.65, `rgba(224, 242, 254, ${(0.55 + proximity * 0.35).toFixed(2)})`);
    mistGrad.addColorStop(1, 'rgba(186, 230, 253, 0)');
    ctx.fillStyle = mistGrad;
    ctx.fillRect(0, horizonY - 6, canvasWidth, crestDepth + 24);

    // Billowing snow puffs along the mountain crest
    const puffCount = Math.max(8, Math.floor(canvasWidth / 44));
    ctx.fillStyle = `rgba(255, 255, 255, ${(0.68 + proximity * 0.28).toFixed(2)})`;
    for (let i = 0; i <= puffCount; i += 1) {
      const px = (canvasWidth / puffCount) * i;
      const py = horizonY + Math.sin(t + i * 1.3) * (reducedMotion ? 1.5 : 4) + proximity * 6;
      const r = 16 + (i % 3) * 5 + proximity * 8;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 2. Full roaring snow wall descending down the slope once frontY crosses below horizonY
  if (frontY > horizonY - 8) {
    const clampedFrontY = Math.min(canvasHeight + 30, frontY);
    ctx.save();

    // Dense tumbling snow body from horizonY down to clampedFrontY
    const bodyGrad = ctx.createLinearGradient(0, horizonY, 0, clampedFrontY);
    bodyGrad.addColorStop(0, '#CBD5E1');
    bodyGrad.addColorStop(0.55, '#E2E8F0');
    bodyGrad.addColorStop(0.88, '#F8FAFC');
    bodyGrad.addColorStop(1, '#FFFFFF');
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(0, horizonY, canvasWidth, Math.max(0, clampedFrontY - horizonY));

    // Churning mid-wave shadow ridges
    const ridgeY = clampedFrontY - 18;
    if (ridgeY > horizonY) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.32)';
      const cols = Math.max(7, Math.floor(canvasWidth / 52));
      for (let i = 0; i <= cols; i += 1) {
        const cx = (canvasWidth / cols) * i;
        const cy = ridgeY + Math.cos(t * 1.2 + i * 0.9) * 4;
        ctx.beginPath();
        ctx.arc(cx, cy, 24 + (i % 2) * 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Leading turbulent foam surge rollers along frontY
    const lobeCount = Math.max(9, Math.floor(canvasWidth / 38));
    for (let i = 0; i <= lobeCount; i += 1) {
      const lx = (canvasWidth / lobeCount) * i;
      const waveOffset = reducedMotion ? 0 : Math.sin(t * 1.6 + i * 1.15) * 5;
      const ly = clampedFrontY + waveOffset;
      const radius = 20 + (i % 3) * 5;

      // Forward cast shadow on slope ahead of the snow wall
      ctx.fillStyle = 'rgba(15, 23, 42, 0.16)';
      ctx.beginPath();
      ctx.arc(lx, ly + 7, radius * 0.95, 0, Math.PI * 2);
      ctx.fill();

      // Bright white foam roller
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(lx, ly, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Airborne spray droplets kicked out ahead of the avalanche front
    if (!reducedMotion) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
      for (let i = 0; i < 14; i += 1) {
        const sx = (((i * 73 + nowMs * 0.08) % 1000) / 1000) * canvasWidth;
        const sy = clampedFrontY + 8 + ((i * 29 + nowMs * 0.11) % 26);
        const sr = 2.2 + (i % 3) * 1.3;
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // 3. Subtle top danger frost edge cue when Avalanche is dangerously close
  if (avalanche.warningLevel === 'danger' || avalanche.warningLevel === 'tumble') {
    ctx.save();
    const edgeGrad = ctx.createLinearGradient(0, horizonY, 0, horizonY + 42);
    edgeGrad.addColorStop(
      0,
      avalanche.warningLevel === 'tumble'
        ? 'rgba(244, 63, 94, 0.34)'
        : 'rgba(249, 115, 22, 0.26)'
    );
    edgeGrad.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = edgeGrad;
    ctx.fillRect(0, horizonY, canvasWidth, 42);
    ctx.restore();
  }
}

export function computeSpinAngleRad(spinTimerSec: number): number {
  if (spinTimerSec <= 0) return 0;
  const progress = 1 - Math.max(0, Math.min(1, spinTimerSec / ROCK_SPIN_PENALTY_SEC));
  return progress * Math.PI * 2;
}

export function computeTumbleProgress(tumbleTimerSec: number): number {
  if (tumbleTimerSec <= 0) return 0;
  return 1 - Math.max(0, Math.min(1, tumbleTimerSec / SNOW_TUMBLE_DURATION_SEC));
}
