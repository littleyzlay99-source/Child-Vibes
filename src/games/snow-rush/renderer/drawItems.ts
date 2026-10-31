import type {
  SnowRushItemBox,
  SnowRushProjectile,
  SnowRushTrap,
  SnowRushVisualBurst,
} from '../types';
import type { ObstacleRenderMetrics } from './drawObstacles';

/**
 * Renders an unpicked world-coordinate `?` Crystal Item Box floating gently above the snow slope.
 * Picked-up boxes (`pickedUpByRacerId !== null`) are omitted cleanly so visual state matches simulation 1:1.
 */
export function drawItemBox(
  box: SnowRushItemBox,
  metrics: ObstacleRenderMetrics
): void {
  if (box.pickedUpByRacerId !== null) return;

  const {
    ctx,
    trackCenterX,
    trackHalfUsable,
    playerAnchorY,
    playerDistM,
    pixelsPerMeter,
    scale,
    nowMs,
    reducedMotion,
  } = metrics;

  const x = trackCenterX + box.laneOffset * trackHalfUsable;
  const y = playerAnchorY + (box.distanceM - playerDistM) * pixelsPerMeter;
  const bobOffset = reducedMotion ? 0 : Math.sin(nowMs * 0.0055 + box.laneOffset * 4) * 3.5;
  const boxSize = 24 * scale;
  const half = boxSize / 2;

  ctx.save();
  ctx.translate(x, y);

  // Ground glow shadow
  ctx.fillStyle = 'rgba(14, 165, 233, 0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 6 * scale, half * 1.15, 5.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(0, -10 * scale + bobOffset);

  // Outer golden-cyan crystalline frame
  const cubeGrad = ctx.createLinearGradient(-half, -half, half, half);
  cubeGrad.addColorStop(0, '#38BDF8');
  cubeGrad.addColorStop(0.5, '#FACC15');
  cubeGrad.addColorStop(1, '#F97316');

  ctx.fillStyle = cubeGrad;
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-half, -half, boxSize, boxSize, 6 * scale);
  ctx.fill();
  ctx.stroke();

  // Inner frosted glass facet
  ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
  ctx.beginPath();
  ctx.roundRect(-half + 3, -half + 3, boxSize - 6, (boxSize - 6) * 0.48, 3.5 * scale);
  ctx.fill();

  // Crisp '?' emblem
  ctx.fillStyle = '#0F172A';
  ctx.font = `900 ${Math.round(14 * scale)}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 0.5, 1);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('?', 0, 0.2);

  ctx.restore();
}

/**
 * Renders a placed Snow / Banana Slip Trap on the snow slope.
 */
export function drawSnowTrap(
  trap: SnowRushTrap,
  metrics: ObstacleRenderMetrics
): void {
  if (!trap.active) return;

  const {
    ctx,
    trackCenterX,
    trackHalfUsable,
    playerAnchorY,
    playerDistM,
    pixelsPerMeter,
    scale,
  } = metrics;

  const x = trackCenterX + trap.laneOffset * trackHalfUsable;
  const y = playerAnchorY + (trap.distanceM - playerDistM) * pixelsPerMeter;

  ctx.save();
  ctx.translate(x, y);

  // Hazard warning ring on snow
  ctx.fillStyle = 'rgba(234, 179, 8, 0.22)';
  ctx.strokeStyle = 'rgba(202, 138, 4, 0.72)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(0, 2, 15 * scale, 7.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Vibrant yellow 3-petal banana / slip hazard peel
  ctx.fillStyle = '#FACC15';
  ctx.strokeStyle = '#713F12';
  ctx.lineWidth = 1.6;

  // Left peel petal
  ctx.beginPath();
  ctx.moveTo(0, -8 * scale);
  ctx.quadraticCurveTo(-11 * scale, -4 * scale, -12 * scale, 4 * scale);
  ctx.quadraticCurveTo(-5 * scale, 2 * scale, 0, -2 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Right peel petal
  ctx.beginPath();
  ctx.moveTo(0, -8 * scale);
  ctx.quadraticCurveTo(11 * scale, -4 * scale, 12 * scale, 4 * scale);
  ctx.quadraticCurveTo(5 * scale, 2 * scale, 0, -2 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Center front peel petal
  ctx.fillStyle = '#FDE047';
  ctx.beginPath();
  ctx.moveTo(0, -9 * scale);
  ctx.quadraticCurveTo(-4 * scale, 1 * scale, 0, 6 * scale);
  ctx.quadraticCurveTo(4 * scale, 1 * scale, 0, -9 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Brown stem tip
  ctx.fillStyle = '#713F12';
  ctx.beginPath();
  ctx.arc(0, -9.5 * scale, 2.2 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Renders a launched Snowball Attack projectile racing down-slope (+Y on screen)
 * with a frosty comet wake trailing up-slope (-Y behind projectile).
 */
export function drawSnowballProjectile(
  proj: SnowRushProjectile,
  metrics: ObstacleRenderMetrics
): void {
  if (!proj.active) return;

  const {
    ctx,
    trackCenterX,
    trackHalfUsable,
    playerAnchorY,
    playerDistM,
    pixelsPerMeter,
    scale,
    reducedMotion,
  } = metrics;

  const x = trackCenterX + proj.laneOffset * trackHalfUsable;
  const y = playerAnchorY + (proj.distanceM - playerDistM) * pixelsPerMeter;
  const r = 9.5 * scale;

  ctx.save();
  ctx.translate(x, y);

  // Ground shadow
  ctx.fillStyle = 'rgba(15, 23, 42, 0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 6 * scale, r * 0.9, 4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Frosty comet wake extending upward (-Y = behind forward-moving projectile)
  if (!reducedMotion) {
    const tailGrad = ctx.createLinearGradient(0, -34 * scale, 0, -2 * scale);
    tailGrad.addColorStop(0, 'rgba(56, 189, 248, 0)');
    tailGrad.addColorStop(0.55, 'rgba(125, 211, 252, 0.52)');
    tailGrad.addColorStop(1, 'rgba(255, 255, 255, 0.9)');
    ctx.fillStyle = tailGrad;
    ctx.beginPath();
    ctx.moveTo(-r * 0.78, -2 * scale);
    ctx.lineTo(0, -34 * scale);
    ctx.lineTo(r * 0.78, -2 * scale);
    ctx.closePath();
    ctx.fill();
  }

  // Snowball sphere core
  const ballGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.15, 0, 0, r);
  ballGrad.addColorStop(0, '#FFFFFF');
  ballGrad.addColorStop(0.7, '#E0F2FE');
  ballGrad.addColorStop(1, '#38BDF8');

  ctx.fillStyle = ballGrad;
  ctx.strokeStyle = '#0284C7';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -4 * scale, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

/**
 * Renders transient world-space particle bursts (item pickup, snowball hit/miss, trap slip, shield shatter).
 */
export function drawVisualBurst(
  burst: SnowRushVisualBurst,
  metrics: ObstacleRenderMetrics
): void {
  const {
    ctx,
    trackCenterX,
    trackHalfUsable,
    playerAnchorY,
    playerDistM,
    pixelsPerMeter,
    scale,
    reducedMotion,
  } = metrics;

  const progress = Math.max(0, Math.min(1, burst.elapsedSec / Math.max(0.05, burst.durationSec)));
  const alpha = 1 - progress;
  const x = trackCenterX + burst.laneOffset * trackHalfUsable;
  const y = playerAnchorY + (burst.distanceM - playerDistM) * pixelsPerMeter;

  ctx.save();
  ctx.translate(x, y - 8 * scale);
  ctx.globalAlpha = alpha;

  const baseRadius = (10 + (reducedMotion ? 8 : progress * 26)) * scale;

  if (burst.kind === 'shield_break') {
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius * 1.15, 0, Math.PI * 2);
    ctx.stroke();

    // Crystalline ice shards
    ctx.fillStyle = '#BAE6FD';
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI * 2 * i) / 6 + progress * 0.6;
      const px = Math.cos(angle) * baseRadius;
      const py = Math.sin(angle) * baseRadius;
      ctx.beginPath();
      ctx.moveTo(px, py - 4 * scale);
      ctx.lineTo(px + 4 * scale, py + 3 * scale);
      ctx.lineTo(px - 4 * scale, py + 3 * scale);
      ctx.closePath();
      ctx.fill();
    }
  } else if (burst.kind === 'item_pickup') {
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius, 0, Math.PI * 2);
    ctx.stroke();
  } else if (burst.kind === 'snowball_hit' || burst.kind === 'trap_hit') {
    ctx.fillStyle = burst.kind === 'trap_hit' ? '#FDE047' : '#FFFFFF';
    ctx.strokeStyle = burst.kind === 'trap_hit' ? '#CA8A04' : '#38BDF8';
    ctx.lineWidth = 1.5;
    const count = 7;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count;
      const px = Math.cos(angle) * baseRadius;
      const py = Math.sin(angle) * baseRadius * 0.78;
      ctx.beginPath();
      ctx.arc(px, py, (4.5 - progress * 2) * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else {
    // snowball_miss soft powder poof
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let i = 0; i < 4; i += 1) {
      const angle = (Math.PI * 2 * i) / 4 + 0.4;
      ctx.beginPath();
      ctx.arc(
        Math.cos(angle) * baseRadius * 0.6,
        Math.sin(angle) * baseRadius * 0.5,
        3.5 * scale,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  ctx.restore();
}
