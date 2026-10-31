import { SHIELD_BREAK_ANIM_DURATION_SEC } from '../constants';
import { computeSpinAngleRad, computeTumbleProgress } from './drawObstacles';

export interface ChibiRacerPalette {
  jacketColor: string;
  hatColor: string;
  scarfColor: string;
  boardColor: string;
  pomColor?: string;
  goggleLensStart?: string;
  goggleLensEnd?: string;
}

export interface DrawChibiRacerParams {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number; // Ground contact Y on slope
  scale: number;
  carveTilt: number; // -1 (left) to +1 (right)
  jumpHeightPx: number;
  isJumping: boolean;
  speedMps: number;
  scarfPhase: number;
  label: string;
  isLocalPlayer: boolean;
  isOfflineBot?: boolean;
  palette: ChibiRacerPalette;
  reducedMotion?: boolean;
  // Step 4.3 Visual Status States
  tumbleTimerSec?: number;
  spinTimerSec?: number;
  invulnerableTimerSec?: number;
  iceSlipTimerSec?: number;
  landingBoostTimerSec?: number;
  // Step 4.4 Battle Item Visual States
  nitroTimerSec?: number;
  shieldTimerSec?: number;
  shieldBreakAnimTimerSec?: number;
  mercyInvulnTimerSec?: number;
}

export const PLAYER_DEFAULT_PALETTE: ChibiRacerPalette = {
  jacketColor: '#F43F5E', // Vibrant coral-crimson winter parka
  hatColor: '#E11D48',
  scarfColor: '#FACC15', // Warm golden scarf
  boardColor: '#0284C7', // Alpine sky snowboard
  pomColor: '#FFFBEB',
  goggleLensStart: '#38BDF8',
  goggleLensEnd: '#1D4ED8',
};

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Draws a cute front-3/4 2D Chibi Winter Racer gliding down the mountain slope
 * using pure HTML5 2D Canvas vector primitives (zero external image dependencies).
 */
export function drawChibiRacer(params: DrawChibiRacerParams): void {
  const {
    ctx,
    x,
    y,
    scale,
    carveTilt,
    jumpHeightPx,
    isJumping,
    speedMps,
    scarfPhase,
    label,
    isLocalPlayer,
    isOfflineBot = false,
    palette,
    reducedMotion = false,
    tumbleTimerSec = 0,
    spinTimerSec = 0,
    invulnerableTimerSec = 0,
    iceSlipTimerSec = 0,
    landingBoostTimerSec = 0,
    nitroTimerSec = 0,
    shieldTimerSec = 0,
    shieldBreakAnimTimerSec = 0,
    mercyInvulnTimerSec = 0,
  } = params;

  ctx.save();
  ctx.translate(x, y);

  // Special State: Active Snow Tumble (1.3s rolling snowball knockdown)
  if (tumbleTimerSec > 0) {
    const tumbleProg = computeTumbleProgress(tumbleTimerSec);
    const rollAngle = reducedMotion ? 0.35 : tumbleProg * Math.PI * 5;

    ctx.save();
    ctx.scale(scale, scale);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 14, 27, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(0, -10);
    ctx.rotate(rollAngle);

    ctx.fillStyle = palette.boardColor;
    drawRoundedRectPath(ctx, -26, -5, 52, 10, 5);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#93C5FD';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = palette.jacketColor;
    ctx.beginPath();
    ctx.arc(6, -12, 8.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#F8FAFC';
    ctx.beginPath();
    ctx.arc(-12, -9, 9, 0, Math.PI * 2);
    ctx.arc(11, 10, 8.5, 0, Math.PI * 2);
    ctx.arc(-9, 11, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();

    if (label) {
      ctx.save();
      const badgeY = -56 * scale;
      ctx.font = '700 11px system-ui, -apple-system, sans-serif';
      const tumbleLabel = isLocalPlayer ? '❄️ နှင်းလုံးပိနေသည်!' : label;
      const textMetrics = ctx.measureText(tumbleLabel);
      const badgeW = Math.ceil(textMetrics.width + 16);
      ctx.fillStyle = 'rgba(153, 27, 27, 0.9)';
      drawRoundedRectPath(ctx, -badgeW / 2, badgeY - 10, badgeW, 20, 10);
      ctx.fill();
      ctx.fillStyle = '#FEF2F2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tumbleLabel, 0, badgeY + 0.5);
      ctx.restore();
    }

    ctx.restore();
    return;
  }

  // 1. Ground contact oval shadow + Invulnerability / Mercy / Nitro / Ice Slip aura rings
  const jumpRatio = Math.min(1, Math.max(0, jumpHeightPx / 48));
  const shadowScale = 1 - jumpRatio * 0.36;
  ctx.save();
  ctx.scale(scale * shadowScale, scale * shadowScale);
  ctx.fillStyle = isLocalPlayer ? 'rgba(15, 23, 42, 0.24)' : 'rgba(15, 23, 42, 0.17)';
  ctx.beginPath();
  ctx.ellipse(0, 14, 24, 9, carveTilt * 0.22, 0, Math.PI * 2);
  ctx.fill();

  if (invulnerableTimerSec > 0) {
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.92)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.ellipse(0, 12, 30, 12.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (mercyInvulnTimerSec > 0) {
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.95)';
    ctx.lineWidth = 2.4;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.ellipse(0, 12, 29, 12, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (nitroTimerSec > 0 || landingBoostTimerSec > 0) {
    ctx.strokeStyle = nitroTimerSec > 0 ? 'rgba(250, 204, 21, 0.95)' : 'rgba(249, 115, 22, 0.85)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-14, -4);
    ctx.lineTo(-19, -28);
    ctx.moveTo(0, -6);
    ctx.lineTo(0, -34);
    ctx.moveTo(14, -4);
    ctx.lineTo(19, -28);
    ctx.stroke();
  } else if (iceSlipTimerSec > 0) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(0, 13, 27, 10.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // 2. Nitro Twin Plasma Exhaust Trail behind snowboard (-Y = up-slope behind racer)
  if (nitroTimerSec > 0) {
    ctx.save();
    ctx.translate(0, -jumpHeightPx * scale);
    ctx.scale(scale, scale);
    const flicker = reducedMotion ? 1 : 0.88 + Math.sin(scarfPhase * 3.8) * 0.16;
    const flameLen = 38 * flicker;

    [-10, 10].forEach((offsetX) => {
      const outerGrad = ctx.createLinearGradient(offsetX, 4, offsetX, -flameLen);
      outerGrad.addColorStop(0, 'rgba(250, 204, 21, 0.95)');
      outerGrad.addColorStop(0.55, 'rgba(249, 115, 22, 0.78)');
      outerGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');

      ctx.fillStyle = outerGrad;
      ctx.beginPath();
      ctx.moveTo(offsetX - 6.5, 6);
      ctx.lineTo(offsetX - carveTilt * 6, -flameLen);
      ctx.lineTo(offsetX + 6.5, 6);
      ctx.closePath();
      ctx.fill();

      // White-cyan hot core
      ctx.fillStyle = 'rgba(224, 242, 254, 0.92)';
      ctx.beginPath();
      ctx.moveTo(offsetX - 3, 5);
      ctx.lineTo(offsetX - carveTilt * 3, -flameLen * 0.55);
      ctx.lineTo(offsetX + 3, 5);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  }

  // 2B. Ground snow powder spray when carving left/right at speed
  if (!isJumping && !reducedMotion && speedMps > 6 && Math.abs(carveTilt) > 0.16) {
    const sprayDir = carveTilt > 0 ? -1 : 1;
    const intensity = Math.min(1, Math.abs(carveTilt));
    ctx.save();
    ctx.scale(scale, scale);
    ctx.fillStyle = `rgba(255, 255, 255, ${(0.55 + intensity * 0.35).toFixed(2)})`;
    for (let i = 0; i < 4; i += 1) {
      const puffX = sprayDir * (14 + i * 6.5) - carveTilt * 3;
      const puffY = 8 - i * 4.5 + Math.sin(scarfPhase + i) * 1.8;
      const puffR = (4.8 - i * 0.7) * (0.7 + intensity * 0.45);
      ctx.beginPath();
      ctx.arc(puffX, puffY, Math.max(1.5, puffR), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 3. Elevate racer body by jumpHeightPx and apply carve lean + optional Rock/Trap spin
  ctx.save();
  if ((invulnerableTimerSec > 0 || mercyInvulnTimerSec > 0) && !reducedMotion) {
    const timerVal = Math.max(invulnerableTimerSec, mercyInvulnTimerSec);
    ctx.globalAlpha = 0.74 + Math.sin(timerVal * 26) * 0.22;
  }
  ctx.translate(0, -jumpHeightPx * scale);
  ctx.scale(scale, scale);
  const spinRad = reducedMotion ? (spinTimerSec > 0 ? 0.45 : 0) : computeSpinAngleRad(spinTimerSec);
  const bodyAngleRad = carveTilt * 0.26 + spinRad;
  ctx.rotate(bodyAngleRad);

  // 3A. Flapping winter scarf
  const scarfWaveAmp = reducedMotion ? 1.8 : 4.6 + Math.min(4, speedMps * 0.12);
  ctx.save();
  ctx.strokeStyle = palette.scarfColor;
  ctx.lineWidth = 6.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const tailSwing = -carveTilt * 11;
  const wave1 = Math.sin(scarfPhase) * scarfWaveAmp;
  const wave2 = Math.cos(scarfPhase * 1.15) * (scarfWaveAmp * 1.2);
  ctx.moveTo(4, -14);
  ctx.quadraticCurveTo(10 + tailSwing * 0.5 + wave1, -26, 13 + tailSwing + wave2, -37);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(5, -16);
  ctx.quadraticCurveTo(10 + tailSwing * 0.5 + wave1, -26, 13 + tailSwing + wave2, -35);
  ctx.stroke();
  ctx.restore();

  // 3B. Twin-tip Snowboard / Ski Board under boots
  ctx.save();
  ctx.translate(0, 10);
  ctx.rotate(carveTilt * 0.34);

  ctx.fillStyle = '#0F172A';
  drawRoundedRectPath(ctx, -22, -6.5, 44, 14, 7);
  ctx.fill();

  ctx.fillStyle =
    nitroTimerSec > 0
      ? '#FACC15'
      : landingBoostTimerSec > 0
      ? '#F59E0B'
      : palette.boardColor;
  drawRoundedRectPath(ctx, -21, -7.5, 42, 13, 6.5);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  drawRoundedRectPath(ctx, -15, -2.2, 30, 4.4, 2.2);
  ctx.fill();

  ctx.fillStyle = '#1E293B';
  drawRoundedRectPath(ctx, -11, -5, 7, 7.5, 2.5);
  ctx.fill();
  drawRoundedRectPath(ctx, 4, -5, 7, 7.5, 2.5);
  ctx.fill();
  ctx.restore();

  // 3C. Chibi Winter Parka Torso & Mitten Arms
  const armLift = isJumping || spinTimerSec > 0 || nitroTimerSec > 0 ? -7 : 0;

  ctx.strokeStyle = palette.jacketColor;
  ctx.lineWidth = 7.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-10, -8);
  ctx.lineTo(-19, -2 + armLift - carveTilt * 2.5);
  ctx.moveTo(10, -8);
  ctx.lineTo(19, -2 + armLift + carveTilt * 2.5);
  ctx.stroke();

  ctx.fillStyle = '#1E293B';
  ctx.beginPath();
  ctx.arc(-19.5, -2 + armLift - carveTilt * 2.5, 4.2, 0, Math.PI * 2);
  ctx.arc(19.5, -2 + armLift + carveTilt * 2.5, 4.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = palette.jacketColor;
  drawRoundedRectPath(ctx, -13, -15, 26, 21, 9);
  ctx.fill();
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.lineTo(0, 4);
  ctx.stroke();

  ctx.fillStyle = palette.scarfColor;
  drawRoundedRectPath(ctx, -11.5, -17.5, 23, 6.5, 3.2);
  ctx.fill();

  // 3D. Big Cute Chibi Head
  ctx.save();
  ctx.translate(0, -27);

  ctx.fillStyle = '#FFE4C4';
  ctx.beginPath();
  ctx.arc(0, 0, 14.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.fillStyle = 'rgba(251, 113, 133, 0.55)';
  ctx.beginPath();
  ctx.ellipse(-8.2, 4.2, 3.2, 2.0, 0, 0, Math.PI * 2);
  ctx.ellipse(8.2, 4.2, 3.2, 2.0, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#0F172A';
  ctx.beginPath();
  ctx.arc(-4.8, 1.5, 1.7, 0, Math.PI * 2);
  ctx.arc(4.8, 1.5, 1.7, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  if (isJumping || spinTimerSec > 0) {
    ctx.fillStyle = '#FB7185';
    ctx.beginPath();
    ctx.arc(0, 6.2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(0, 4.8, 3.4, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  ctx.fillStyle = palette.hatColor;
  ctx.beginPath();
  ctx.arc(0, -3.5, 15, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = palette.pomColor || '#FFFBEB';
  ctx.beginPath();
  ctx.arc(0, -20, 5.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  drawRoundedRectPath(ctx, -15.5, -7.5, 31, 6.2, 3);
  ctx.fill();
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 1.3;
  ctx.stroke();

  const goggleGrad = ctx.createLinearGradient(-12, -12, 12, -4);
  goggleGrad.addColorStop(0, palette.goggleLensStart || '#38BDF8');
  goggleGrad.addColorStop(1, palette.goggleLensEnd || '#1D4ED8');

  ctx.fillStyle = '#0F172A';
  drawRoundedRectPath(ctx, -13, -12.8, 26, 9.2, 4.5);
  ctx.fill();

  ctx.fillStyle = goggleGrad;
  drawRoundedRectPath(ctx, -11.4, -11.5, 10.4, 6.6, 3);
  ctx.fill();
  drawRoundedRectPath(ctx, 1.0, -11.5, 10.4, 6.6, 3);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-9.2, -9.8);
  ctx.lineTo(-5.2, -9.8);
  ctx.moveTo(3.2, -9.8);
  ctx.lineTo(7.2, -9.8);
  ctx.stroke();

  ctx.restore();
  ctx.restore();

  // 3E. Step 4.4 Active Ice Shield Blue Protective Sphere OR Shield Break Shatter Ring
  if (shieldTimerSec > 0) {
    ctx.save();
    ctx.translate(0, (-14 - jumpHeightPx) * scale);
    const shieldRadius = 33 * scale;
    const shieldGrad = ctx.createRadialGradient(
      -shieldRadius * 0.28,
      -shieldRadius * 0.28,
      shieldRadius * 0.15,
      0,
      0,
      shieldRadius
    );
    shieldGrad.addColorStop(0, 'rgba(224, 242, 254, 0.14)');
    shieldGrad.addColorStop(0.72, 'rgba(56, 189, 248, 0.24)');
    shieldGrad.addColorStop(1, 'rgba(2, 132, 199, 0.52)');

    ctx.fillStyle = shieldGrad;
    ctx.strokeStyle =
      shieldTimerSec < 1.1 && !reducedMotion
        ? `rgba(125, 211, 252, ${(0.55 + Math.sin(shieldTimerSec * 24) * 0.35).toFixed(2)})`
        : 'rgba(56, 189, 248, 0.92)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(0, 0, shieldRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Specular frost arc on top-left of Ice Shield bubble
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, shieldRadius * 0.82, Math.PI * 1.12, Math.PI * 1.48);
    ctx.stroke();
    ctx.restore();
  } else if (shieldBreakAnimTimerSec > 0) {
    const breakProg =
      1 - Math.max(0, Math.min(1, shieldBreakAnimTimerSec / SHIELD_BREAK_ANIM_DURATION_SEC));
    ctx.save();
    ctx.translate(0, (-14 - jumpHeightPx) * scale);
    ctx.globalAlpha = 1 - breakProg;
    const ringR = (33 + breakProg * 18) * scale;
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 4. Crisp Nameplate Badge above Chibi Racer
  if (label) {
    ctx.save();
    const badgeY = (-59 - jumpHeightPx) * scale;
    ctx.font = '700 11px system-ui, -apple-system, sans-serif';
    const textMetrics = ctx.measureText(label);
    const padX = 8;
    const badgeW = Math.ceil(textMetrics.width + padX * 2);
    const badgeH = 20;

    ctx.fillStyle = isLocalPlayer
      ? 'rgba(15, 23, 42, 0.88)'
      : isOfflineBot
      ? 'rgba(30, 41, 59, 0.78)'
      : 'rgba(15, 23, 42, 0.8)';
    drawRoundedRectPath(ctx, -badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH, 10);
    ctx.fill();

    ctx.strokeStyle =
      shieldTimerSec > 0
        ? '#38BDF8'
        : nitroTimerSec > 0
        ? '#FACC15'
        : invulnerableTimerSec > 0 || mercyInvulnTimerSec > 0
        ? '#7DD3FC'
        : isLocalPlayer
        ? '#FACC15'
        : 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = isLocalPlayer ? 1.5 : 1;
    ctx.stroke();

    ctx.fillStyle = isLocalPlayer ? '#FEF08A' : '#F8FAFC';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, badgeY + 0.5);
    ctx.restore();
  }

  ctx.restore();
}
