import React from 'react';
import {
  AlertTriangle,
  Flag,
  Gauge,
  LogOut,
  Package,
  RotateCcw,
  Shield,
  Snowflake,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { COURSE_CHECKPOINT_METERS, COURSE_LENGTH_M } from '../constants';
import type { MultiplayerHudExtras } from '../multiplayerHud';
import type { RacePhase, SnowRushHudSnapshot } from '../types';

export interface RaceProgressBarProps {
  hud: SnowRushHudSnapshot;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onRestartDemo?: () => void;
  onUseItemClick?: () => void;
  isMultiplayer?: boolean;
  multiplayerExtras?: MultiplayerHudExtras;
  onRequestExit?: () => void;
}

function getPhaseBadgeConfig(
  phase: RacePhase,
  multiplayerExtras?: MultiplayerHudExtras
): {
  labelMm: string;
  labelEn: string;
  badgeClass: string;
} {
  if (multiplayerExtras?.racePhase === 'finish_window') {
    const remSec =
      multiplayerExtras.finishWindowRemainingSec !== null
        ? Math.max(1, Math.ceil(multiplayerExtras.finishWindowRemainingSec))
        : 15;
    return {
      labelMm: `ပန်းဝင်ချိန် ${remSec}s`,
      labelEn: 'Finish Window',
      badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
    };
  }

  switch (phase) {
    case 'ready':
      return {
        labelMm: 'အသင့်',
        labelEn: 'Ready',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
      };
    case 'countdown':
      return {
        labelMm: 'တာထွက်နေသည်',
        labelEn: 'Countdown',
        badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
      };
    case 'racing':
      return {
        labelMm: 'ပြိုင်နေသည်',
        labelEn: 'Racing',
        badgeClass: 'bg-sky-100 text-sky-900 border-sky-300',
      };
    case 'finished':
      return {
        labelMm: 'ပန်းဝင်ပြီ',
        labelEn: 'Finished',
        badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-300',
      };
  }
}

export const RaceProgressBar: React.FC<RaceProgressBarProps> = ({
  hud,
  soundEnabled,
  onToggleSound,
  onRestartDemo,
  onUseItemClick,
  isMultiplayer = false,
  multiplayerExtras,
  onRequestExit,
}) => {
  const statusInfo = getPhaseBadgeConfig(hud.phase, multiplayerExtras);
  const clampedPercent = Math.max(0, Math.min(100, hud.progressPercent));
  const clampedAvalanchePercent =
    hud.avalancheDistanceM > 0
      ? Math.max(0, Math.min(98, hud.avalancheProgressPercent))
      : 0;

  const renderAvalancheOrEffectBadge = () => {
    if (hud.phase !== 'racing') return null;

    if (hud.playerStatus === 'tumble' || hud.avalancheWarning === 'tumble') {
      return (
        <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-black tabular-nums whitespace-nowrap shadow-2xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>နှင်းလုံးပိနေသည်!</span>
        </div>
      );
    }

    if (hud.nitroRemainingSec > 0) {
      return (
        <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-400 border border-amber-500 text-slate-950 text-[11px] font-black font-mono tabular-nums whitespace-nowrap">
          <Zap className="w-3.5 h-3.5 shrink-0 fill-current" />
          <span>Nitro {hud.nitroRemainingSec.toFixed(1)}s</span>
        </div>
      );
    }

    if (hud.shieldRemainingSec > 0) {
      return (
        <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-100 border border-sky-400 text-sky-950 text-[11px] font-black font-mono tabular-nums whitespace-nowrap">
          <Shield className="w-3.5 h-3.5 text-sky-600 shrink-0" />
          <span>Shield {hud.shieldRemainingSec.toFixed(1)}s</span>
        </div>
      );
    }

    if (hud.mercyInvulnRemainingSec > 0) {
      return (
        <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-50 border border-cyan-300 text-cyan-950 text-[11px] font-black font-mono tabular-nums whitespace-nowrap">
          <Shield className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
          <span>Mercy {hud.mercyInvulnRemainingSec.toFixed(1)}s</span>
        </div>
      );
    }

    if (hud.playerStatus === 'invulnerable') {
      return (
        <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-950 text-[11px] font-black tabular-nums whitespace-nowrap">
          <Shield className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>ကာကွယ်ထားသည် · {hud.avalancheGapM}m</span>
        </div>
      );
    }

    if (hud.playerStatus === 'ramp_boost') {
      return (
        <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-950 text-[11px] font-black tabular-nums whitespace-nowrap">
          <Zap className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>+15% Boost · {hud.avalancheGapM}m</span>
        </div>
      );
    }

    if (hud.avalancheGraceSec > 0) {
      return (
        <div className="hidden lg:flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-bold font-mono tabular-nums whitespace-nowrap">
          <Snowflake className="w-3.5 h-3.5 text-sky-600 shrink-0" />
          <span>နှင်းလှိုင်းစရန် {hud.avalancheGraceSec.toFixed(1)}s</span>
        </div>
      );
    }

    if (hud.avalancheWarning === 'danger') {
      return (
        <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-100 border border-rose-300 text-rose-900 text-[11px] font-black font-mono tabular-nums whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
          <span>အန္တရာယ်! {hud.avalancheGapM}m</span>
        </div>
      );
    }

    if (hud.avalancheWarning === 'caution') {
      return (
        <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-bold font-mono tabular-nums whitespace-nowrap">
          <Snowflake className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>နှင်းလှိုင်း {hud.avalancheGapM}m</span>
        </div>
      );
    }

    return (
      <div className="hidden lg:flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-bold font-mono tabular-nums whitespace-nowrap">
        <Snowflake className="w-3.5 h-3.5 text-sky-600 shrink-0" />
        <span>နှင်းလှိုင်း {hud.avalancheGapM}m</span>
      </div>
    );
  };

  const canUseHeldItem =
    hud.phase === 'racing' &&
    !multiplayerExtras?.localFinished &&
    hud.playerStatus !== 'tumble' &&
    hud.heldItem !== null &&
    hud.isItemReady;

  return (
    <header className="w-full bg-white/95 backdrop-blur-md border-b border-slate-200/90 px-3 sm:px-5 py-2 shadow-2xs shrink-0 z-20">
      <div className="max-w-5xl mx-auto flex flex-col gap-1.5">
        {/* Top Metrics, Held Item Slot & Actions Row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-black tracking-tight whitespace-nowrap ${statusInfo.badgeClass}`}
            >
              {statusInfo.labelMm} · {statusInfo.labelEn}
            </span>

            {isMultiplayer &&
              multiplayerExtras?.liveRank !== null &&
              multiplayerExtras?.liveRank !== undefined &&
              hud.totalRacers > 0 && (
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 text-xs font-mono font-black tabular-nums whitespace-nowrap">
                  <Trophy className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>
                    #{multiplayerExtras.liveRank}/{hud.totalRacers}
                  </span>
                </div>
              )}

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-mono font-bold tabular-nums whitespace-nowrap">
              <span>{hud.distanceKmText} km</span>
              <span className="text-slate-400">/</span>
              <span className="text-amber-300">{hud.courseLengthKmText} km</span>
            </div>

            <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sky-900 text-xs font-mono font-bold tabular-nums whitespace-nowrap">
              <Gauge className="w-3.5 h-3.5 text-sky-600 shrink-0" />
              <span>{hud.speedKmh} km/h</span>
            </div>

            {/* Step 4.4 / 4.8 Held Item 1-Slot HUD Readout & Desktop Use Trigger */}
            <button
              type="button"
              disabled={!canUseHeldItem}
              onClick={(e) => {
                e.currentTarget.blur();
                if (canUseHeldItem && onUseItemClick) {
                  onUseItemClick();
                }
              }}
              aria-label={
                hud.heldItemName
                  ? `Held Item: ${hud.heldItemName}`
                  : 'Held Item Slot Empty'
              }
              className={`min-h-[34px] px-2.5 py-1 rounded-lg border text-[11px] font-black flex items-center gap-1.5 transition whitespace-nowrap ${
                hud.heldItem !== null
                  ? hud.isItemReady && !multiplayerExtras?.localFinished
                    ? 'bg-amber-50 hover:bg-amber-100 border-amber-400 text-slate-900 shadow-2xs cursor-pointer'
                    : 'bg-slate-100 border-slate-300 text-slate-700 cursor-not-allowed'
                  : 'bg-slate-50 border-dashed border-slate-300 text-slate-400 cursor-not-allowed'
              }`}
            >
              {hud.heldItemIcon ? (
                <span className="text-sm leading-none">{hud.heldItemIcon}</span>
              ) : (
                <Package className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <span>{hud.heldItemName || 'Empty Slot'}</span>
              {hud.heldItem !== null && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums ${
                    hud.isItemReady
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {hud.isItemReady ? 'USE [E]' : `${hud.itemArmingSec.toFixed(1)}s`}
                </span>
              )}
            </button>

            {renderAvalancheOrEffectBadge()}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <div className="sm:hidden flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sky-900 text-[11px] font-mono font-bold tabular-nums">
              <Gauge className="w-3 h-3 text-sky-600 shrink-0" />
              <span>{hud.speedKmh} km/h</span>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleSound();
              }}
              aria-label={soundEnabled ? 'အသံပိတ်မည်' : 'အသံဖွင့်မည်'}
              title={soundEnabled ? 'အသံပိတ်မည်' : 'အသံဖွင့်မည်'}
              className="min-h-[38px] min-w-[38px] p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition cursor-pointer"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {!isMultiplayer && onRestartDemo && (
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onRestartDemo();
                }}
                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 active:scale-95 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-2xs transition cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restart Demo</span>
              </button>
            )}

            {isMultiplayer && onRequestExit && (
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onRequestExit();
                }}
                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xs transition cursor-pointer whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>ထွက်မည်</span>
              </button>
            )}
          </div>
        </div>

        {/* Course Progress Track (0.00 km -> 1.50 km Finish Line + Quarter-KM Checkpoints + Avalanche Wave Front) */}
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-mono font-bold text-slate-500 tabular-nums shrink-0">
            0.00 km
          </span>

          <div
            className="relative flex-1 h-3.5 rounded-full bg-slate-200/90 border border-slate-300/80 overflow-visible"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={COURSE_LENGTH_M}
            aria-valuenow={Math.round(hud.distanceM)}
            aria-label="ပြိုင်ပွဲ အကွာအဝေး ပြပြား"
          >
            {/* Filled Snow-Sky Player Progress */}
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-amber-400 transition-[width] duration-75"
              style={{ width: `${clampedPercent.toFixed(1)}%` }}
            />

            {/* Quarter-Kilometer Checkpoint Ticks (0.25, 0.50, 0.75, 1.00, 1.25 km) */}
            {COURSE_CHECKPOINT_METERS.map((checkpointM) => {
              const checkpointPct = (checkpointM / COURSE_LENGTH_M) * 100;
              return (
                <span
                  key={checkpointM}
                  title={`${(checkpointM / 1000).toFixed(2)} km (${checkpointM} m)`}
                  aria-hidden="true"
                  className="absolute inset-y-0.5 w-px bg-slate-600/35 pointer-events-none"
                  style={{ left: `${checkpointPct.toFixed(2)}%` }}
                />
              );
            })}

            {/* Trailing Avalanche Zone Overlay on Track Bar */}
            {clampedAvalanchePercent > 0 && (
              <div
                title={`Avalanche: ${Math.round(hud.avalancheDistanceM)} m`}
                className="absolute inset-y-0 left-0 rounded-l-full bg-slate-900/45 border-r-2 border-white pointer-events-none"
                style={{ width: `${clampedAvalanchePercent.toFixed(1)}%` }}
              />
            )}

            {/* Local Mode ONLY: Offline Demo Bot Progress Dots */}
            {!isMultiplayer &&
              hud.showOfflineBots &&
              hud.bots.map((bot) => (
                <span
                  key={bot.id}
                  title={`${bot.displayNameMm}: ${bot.progressPercent.toFixed(0)}%`}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full border border-white shadow-2xs pointer-events-none"
                  style={{
                    left: `${Math.max(2, Math.min(98, bot.progressPercent)).toFixed(1)}%`,
                    backgroundColor: bot.isTumbling ? '#EF4444' : bot.jacketColor,
                  }}
                />
              ))}

            {/* Online Multiplayer Mode ONLY: Human Rival Progress Dots */}
            {isMultiplayer &&
              multiplayerExtras?.remoteRacers.map((rival) => (
                <span
                  key={rival.uid}
                  title={`${rival.displayName}: ${rival.progressPercent.toFixed(0)}%`}
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border border-white shadow-2xs pointer-events-none ${
                    rival.isConnected ? '' : 'opacity-55'
                  }`}
                  style={{
                    left: `${Math.max(2, Math.min(98, rival.progressPercent)).toFixed(1)}%`,
                    backgroundColor: rival.isTumbling ? '#EF4444' : rival.color || '#0EA5E9',
                  }}
                />
              ))}

            {/* Local Player Marker Pin */}
            <span
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-rose-500 border-2 border-white shadow-sm pointer-events-none"
              style={{ left: `${Math.max(2, Math.min(98, clampedPercent)).toFixed(1)}%` }}
            />
          </div>

          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-black text-slate-800 tabular-nums shrink-0">
            <Flag className="w-3 h-3 text-amber-600 fill-amber-400" />
            <span>{hud.courseLengthKmText} km</span>
          </span>
        </div>
      </div>
    </header>
  );
};
