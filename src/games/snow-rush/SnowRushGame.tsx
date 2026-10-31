import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  Flag,
  Gauge,
  Keyboard,
  Package,
  Play,
  RotateCcw,
  Smartphone,
  Snowflake,
  Trophy,
} from 'lucide-react';
import { sounds } from '../../lib/sound';
import type { GameModuleGameplayProps } from '../types';
import { COURSE_LENGTH_KM_TEXT, COURSE_LENGTH_M } from './constants';
import { RaceProgressBar } from './components/RaceProgressBar';
import { TouchControlsOverlay } from './components/TouchControlsOverlay';
import { SnowRushMultiplayerView } from './SnowRushMultiplayerView';
import { SnowRushCanvas } from './renderer/SnowRushCanvas';
import {
  buildHudSnapshot,
  createInitialSnowRushState,
  startCountdownState,
} from './simulation';
import type {
  RacePhase,
  SnowRushHudSnapshot,
  SnowRushInputState,
  SnowRushPrototypeState,
  SnowRushStepEvent,
} from './types';

export interface SnowRushPrototypeViewProps {
  playerDisplayName?: string | null;
  instructionsMm?: string;
}

function isInteractiveTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return target.isContentEditable;
}

/**
 * Standalone Local 2D Playable Prototype for Snow Rush: Avalanche Escape (Step 4.4).
 * Features Deterministic Obstacles, Avalanche Chase, Snow Tumble Recovery,
 * World-Coordinate Item Boxes, 4 Battle Items (⚡ Nitro, ❄️ Snowball, 🍌 Snow Trap, 🛡️ Ice Shield),
 * Manual Item Control, Mercy Invulnerability, and Offline Demo Bots.
 * Zero Firebase / Firestore / Room / Reward side effects.
 */
export const SnowRushPrototypeView: React.FC<SnowRushPrototypeViewProps> = ({
  playerDisplayName,
  instructionsMm,
}) => {
  const effectivePlayerName =
    playerDisplayName && playerDisplayName.trim() ? playerDisplayName.trim() : 'သင် (You)';

  const [showOfflineBots, setShowOfflineBots] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => sounds.enabled);

  const simStateRef = useRef<SnowRushPrototypeState>(
    createInitialSnowRushState({
      playerName: effectivePlayerName,
      showOfflineBots: true,
    })
  );

  const keyboardInputRef = useRef<SnowRushInputState>({
    steerLeft: false,
    steerRight: false,
    jumpPressed: false,
    useItemPressed: false,
  });
  const touchInputRef = useRef<SnowRushInputState>({
    steerLeft: false,
    steerRight: false,
    jumpPressed: false,
    useItemPressed: false,
  });
  const pendingItemUseLatchRef = useRef<boolean>(false);
  const combinedInputRef = useRef<SnowRushInputState>({
    steerLeft: false,
    steerRight: false,
    jumpPressed: false,
    useItemPressed: false,
  });

  const [hud, setHud] = useState<SnowRushHudSnapshot>(() =>
    buildHudSnapshot(simStateRef.current)
  );
  const prevCountdownStepRef = useRef<number | null>(null);
  const lastCarveSoundMsRef = useRef<number>(0);
  const lastNitroTrailSoundMsRef = useRef<number>(0);
  const lastWarningSoundMsRef = useRef<number>(0);

  const syncCombinedInput = useCallback(() => {
    combinedInputRef.current = {
      steerLeft: keyboardInputRef.current.steerLeft || touchInputRef.current.steerLeft,
      steerRight: keyboardInputRef.current.steerRight || touchInputRef.current.steerRight,
      jumpPressed:
        keyboardInputRef.current.jumpPressed || touchInputRef.current.jumpPressed,
      useItemPressed: pendingItemUseLatchRef.current,
    };
  }, []);

  const triggerManualItemUse = useCallback(() => {
    if (simStateRef.current.phase !== 'racing') return;
    pendingItemUseLatchRef.current = true;
    syncCombinedInput();
  }, [syncCombinedInput]);

  const consumeOneShotInputs = useCallback(() => {
    if (pendingItemUseLatchRef.current) {
      pendingItemUseLatchRef.current = false;
      combinedInputRef.current = {
        ...combinedInputRef.current,
        useItemPressed: false,
      };
    }
  }, []);

  const clearAllTransientInputs = useCallback(() => {
    pendingItemUseLatchRef.current = false;
    keyboardInputRef.current = {
      steerLeft: false,
      steerRight: false,
      jumpPressed: false,
      useItemPressed: false,
    };
    touchInputRef.current = {
      steerLeft: false,
      steerRight: false,
      jumpPressed: false,
      useItemPressed: false,
    };
    combinedInputRef.current = {
      steerLeft: false,
      steerRight: false,
      jumpPressed: false,
      useItemPressed: false,
    };
  }, []);

  // Keep player display name synced if prop updates while in 'ready' phase
  useEffect(() => {
    if (simStateRef.current.phase === 'ready') {
      simStateRef.current = {
        ...simStateRef.current,
        player: {
          ...simStateRef.current.player,
          displayName: effectivePlayerName,
        },
      };
      setHud(buildHudSnapshot(simStateRef.current));
    }
  }, [effectivePlayerName]);

  // Desktop Keyboard Controls (Steer: ArrowLeft/A, ArrowRight/D | Jump: Space/W/ArrowUp | Item: E/Shift/Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isInteractiveTextTarget(e.target)) return;

      if (
        (e.key === ' ' || e.code === 'Space' || e.key === 'Enter' || e.code === 'Enter') &&
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'BUTTON' || e.target.tagName === 'A')
      ) {
        return;
      }

      const code = e.code;
      const keyLower = e.key.toLowerCase();

      if (code === 'ArrowLeft' || code === 'KeyA' || keyLower === 'a') {
        e.preventDefault();
        keyboardInputRef.current.steerLeft = true;
        syncCombinedInput();
      } else if (code === 'ArrowRight' || code === 'KeyD' || keyLower === 'd') {
        e.preventDefault();
        keyboardInputRef.current.steerRight = true;
        syncCombinedInput();
      } else if (
        code === 'Space' ||
        e.key === ' ' ||
        code === 'KeyW' ||
        keyLower === 'w' ||
        code === 'ArrowUp'
      ) {
        e.preventDefault();
        keyboardInputRef.current.jumpPressed = true;
        syncCombinedInput();
      } else if (
        code === 'KeyE' ||
        keyLower === 'e' ||
        code === 'ShiftLeft' ||
        code === 'ShiftRight' ||
        e.key === 'Shift' ||
        code === 'Enter' ||
        e.key === 'Enter'
      ) {
        if (simStateRef.current.phase === 'racing') {
          e.preventDefault();
          if (!e.repeat) {
            triggerManualItemUse();
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const code = e.code;
      const keyLower = e.key.toLowerCase();

      if (code === 'ArrowLeft' || code === 'KeyA' || keyLower === 'a') {
        keyboardInputRef.current.steerLeft = false;
        syncCombinedInput();
      } else if (code === 'ArrowRight' || code === 'KeyD' || keyLower === 'd') {
        keyboardInputRef.current.steerRight = false;
        syncCombinedInput();
      } else if (
        code === 'Space' ||
        e.key === ' ' ||
        code === 'KeyW' ||
        keyLower === 'w' ||
        code === 'ArrowUp'
      ) {
        keyboardInputRef.current.jumpPressed = false;
        syncCombinedInput();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearAllTransientInputs();
    };
  }, [syncCombinedInput, triggerManualItemUse, clearAllTransientInputs]);

  // Subtle audio cue on countdown beats (3, 2, 1, GO!)
  useEffect(() => {
    if (
      hud.countdownStep !== null &&
      hud.countdownStep !== prevCountdownStepRef.current
    ) {
      sounds.playClick();
    }
    prevCountdownStepRef.current = hud.countdownStep;
  }, [hud.countdownStep]);

  const handleSimulationEvents = useCallback(
    (events: SnowRushStepEvent[], state: SnowRushPrototypeState, nowMs: number) => {
      const playerId = state.player.id;

      for (let i = 0; i < events.length; i += 1) {
        const ev = events[i];
        switch (ev.type) {
          case 'player_jump':
            sounds.playSnowJump(ev.origin === 'ramp');
            break;
          case 'player_ramp_boost':
            sounds.playSnowRecovery();
            break;
          case 'player_obstacle_hit':
            sounds.playObstacleHit(ev.kind);
            break;
          case 'avalanche_warning':
            if (nowMs - lastWarningSoundMsRef.current >= 2200) {
              lastWarningSoundMsRef.current = nowMs;
              sounds.playAvalancheWarning();
            }
            break;
          case 'player_snow_tumble':
            sounds.playSnowTumble();
            break;
          case 'player_recovery':
            sounds.playSnowRecovery();
            break;
          case 'item_pickup':
            if (ev.racerId === playerId) {
              sounds.playItemPickup();
            }
            break;
          case 'player_item_empty':
            sounds.playItemEmpty();
            break;
          case 'nitro_activate':
            if (ev.racerId === playerId) {
              sounds.playNitroActivate();
            }
            break;
          case 'snowball_launch':
            if (ev.racerId === playerId) {
              sounds.playSnowballLaunch();
            }
            break;
          case 'snowball_hit':
            if (ev.attackerId === playerId || ev.targetId === playerId) {
              sounds.playSnowballHit();
            }
            break;
          case 'snowball_miss':
            if (ev.ownerId === playerId) {
              sounds.playSnowballMiss();
            }
            break;
          case 'trap_place':
            if (ev.racerId === playerId) {
              sounds.playTrapPlace();
            }
            break;
          case 'trap_hit':
            if (ev.ownerId === playerId || ev.targetId === playerId) {
              sounds.playTrapHit();
            }
            break;
          case 'shield_activate':
            if (ev.racerId === playerId) {
              sounds.playShieldActivate();
            }
            break;
          case 'shield_break':
            if (ev.racerId === playerId) {
              sounds.playShieldBreak();
            }
            break;
        }
      }

      // Throttled Nitro Trail whoosh while local player's Nitro Boost is active
      if (
        state.phase === 'racing' &&
        state.player.nitroTimerSec > 0 &&
        nowMs - lastNitroTrailSoundMsRef.current >= 260
      ) {
        lastNitroTrailSoundMsRef.current = nowMs;
        sounds.playNitroTrail();
      }

      // Throttled snow carve swish while grounded and actively carving left/right
      if (
        state.phase === 'racing' &&
        !state.player.isJumping &&
        state.player.tumbleTimerSec <= 0 &&
        Math.abs(state.player.carveTilt) > 0.42 &&
        state.player.speedMps > 9 &&
        nowMs - lastCarveSoundMsRef.current >= 290
      ) {
        lastCarveSoundMsRef.current = nowMs;
        sounds.playSnowCarve();
      }
    },
    []
  );

  const handlePhaseChange = useCallback(
    (nextPhase: RacePhase, prevPhase: RacePhase) => {
      if (nextPhase === 'finished' && prevPhase === 'racing') {
        sounds.playVictory();
      }
    },
    []
  );

  const handleStartRace = useCallback(() => {
    sounds.playClick();
    clearAllTransientInputs();
    const next = startCountdownState(simStateRef.current, {
      playerName: effectivePlayerName,
      showOfflineBots,
    });
    simStateRef.current = next;
    prevCountdownStepRef.current = null;
    lastWarningSoundMsRef.current = 0;
    setHud(buildHudSnapshot(next));
  }, [clearAllTransientInputs, effectivePlayerName, showOfflineBots]);

  const handleRestartDemo = useCallback(() => {
    sounds.playClick();
    clearAllTransientInputs();
    const next = startCountdownState(simStateRef.current, {
      playerName: effectivePlayerName,
      showOfflineBots,
    });
    simStateRef.current = next;
    prevCountdownStepRef.current = null;
    lastWarningSoundMsRef.current = 0;
    setHud(buildHudSnapshot(next));
  }, [clearAllTransientInputs, effectivePlayerName, showOfflineBots]);

  const handleReturnToStartScreen = useCallback(() => {
    sounds.playClick();
    clearAllTransientInputs();
    const fresh = createInitialSnowRushState({
      playerName: effectivePlayerName,
      showOfflineBots,
    });
    simStateRef.current = fresh;
    prevCountdownStepRef.current = null;
    lastWarningSoundMsRef.current = 0;
    setHud(buildHudSnapshot(fresh));
  }, [clearAllTransientInputs, effectivePlayerName, showOfflineBots]);

  const handleToggleOfflineBots = useCallback((checked: boolean) => {
    sounds.playClick();
    setShowOfflineBots(checked);
    simStateRef.current = {
      ...simStateRef.current,
      showOfflineBots: checked,
    };
    setHud(buildHudSnapshot(simStateRef.current));
  }, []);

  const handleToggleSound = useCallback(() => {
    const next = !sounds.enabled;
    sounds.enabled = next;
    setSoundEnabled(next);
    if (next) {
      sounds.playClick();
    }
  }, []);

  const handleTouchLeft = useCallback(
    (pressed: boolean) => {
      touchInputRef.current.steerLeft = pressed;
      syncCombinedInput();
    },
    [syncCombinedInput]
  );

  const handleTouchRight = useCallback(
    (pressed: boolean) => {
      touchInputRef.current.steerRight = pressed;
      syncCombinedInput();
    },
    [syncCombinedInput]
  );

  const handleTouchJump = useCallback(
    (pressed: boolean) => {
      touchInputRef.current.jumpPressed = pressed;
      syncCombinedInput();
    },
    [syncCombinedInput]
  );

  const controlsDisabled =
    hud.phase === 'ready' || hud.phase === 'finished' || hud.playerStatus === 'tumble';

  return (
    <div className="relative flex-1 w-full h-full min-h-[460px] flex flex-col overflow-hidden bg-sky-100 text-slate-900">
      {/* Top Progress HUD (0.00 km / 1.50 km + Held Item Slot + Avalanche Proximity + Speed + Restart Demo) */}
      <RaceProgressBar
        hud={hud}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        onRestartDemo={handleRestartDemo}
        onUseItemClick={triggerManualItemUse}
      />

      {/* Main 2D Canvas Downhill Course Stage */}
      <div className="relative flex-1 w-full overflow-hidden">
        <SnowRushCanvas
          simStateRef={simStateRef}
          inputStateRef={combinedInputRef}
          onConsumeOneShotInputs={consumeOneShotInputs}
          onClearTransientInputs={clearAllTransientInputs}
          onHudSync={setHud}
          onPhaseChange={handlePhaseChange}
          onSimulationEvents={handleSimulationEvents}
        />

        {/* Countdown Center Callout (3 -> 2 -> 1 -> GO!) */}
        {hud.countdownStep !== null && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
            <div className="px-8 py-4 rounded-3xl bg-slate-950/85 border-2 border-amber-300 shadow-2xl text-center backdrop-blur-xs">
              <div className="text-4xl sm:text-5xl font-black text-amber-300 tracking-tight tabular-nums">
                {hud.countdownStep === 0 ? 'GO!' : hud.countdownStep}
              </div>
              <div className="text-xs font-bold text-sky-200 mt-1">
                {hud.countdownStep === 0 ? 'အမြန်ဆင်းပြိုင်ပါ!' : 'အသင့်ပြင်ပါ...'}
              </div>
            </div>
          </div>
        )}

        {/* Phase 1: Start Screen Overlay */}
        {hud.phase === 'ready' && (
          <div className="absolute inset-0 z-30 flex items-center justify-center p-3 sm:p-6 bg-slate-950/35 backdrop-blur-[2px] overflow-y-auto">
            <div className="w-full max-w-md bg-white/95 border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-3.5 my-auto">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="inline-block px-2.5 py-0.5 rounded-md bg-sky-100 border border-sky-300 text-sky-900 text-[11px] font-black">
                    Local 2D Prototype · Offline Demo
                  </span>
                  <h2 className="text-xl sm:text-2xl font-black text-slate-900 mt-1.5 leading-snug">
                    နှင်းတောင်ဆင်းပြိုင်ပွဲ
                  </h2>
                  <p className="text-xs font-bold text-slate-500">
                    Snow Rush: Avalanche Escape · {COURSE_LENGTH_KM_TEXT} km (
                    {COURSE_LENGTH_M.toLocaleString('en-US')} m)
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-sky-50 border border-sky-200 flex items-center justify-center text-2xl shrink-0">
                  🏂
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                {instructionsMm ||
                  `အတားအဆီးများကို ရှောင်တိမ်း၊ Item Box များကောက်ယူပြီး နှင်းပြိုလှိုင်း (Avalanche) မမီမီ ${COURSE_LENGTH_KM_TEXT} km ပန်းဝင်မျဉ်းသို့ အမြန်ဆုံး ဆင်းပြိုင်ပါ။`}
              </p>

              {/* Course Obstacles, Battle Items & Avalanche Guide */}
              <div className="p-3 rounded-2xl bg-sky-50/70 border border-sky-200/80 space-y-1.5 text-[11px] text-slate-700 leading-snug">
                <div className="font-black text-slate-900 flex items-center gap-1.5">
                  <Snowflake className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                  <span>အတားအဆီး၊ Battle Items နှင့် နှင်းပြိုလှိုင်း</span>
                </div>
                <div>
                  • <strong>⚡ Nitro Boost</strong> · <strong>❄️ Snowball</strong> ·{' '}
                  <strong>🍌 Snow Trap</strong> · <strong>🛡️ Ice Shield</strong> (Manual သုံးရမည်)
                </div>
                <div>
                  • <strong>သစ်ပင် / ဂိတ်တိုင်</strong> — ကွေ့ရှောင် ·{' '}
                  <strong>ကျောက်တုံး / ထောင်ချောက်</strong> — ခုန်ကျော် ·{' '}
                  <strong>နှင်းလှိုင်းကို Shield မကာနိုင်ပါ</strong>
                </div>
              </div>

              {/* Controls Guide */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <div className="font-black text-slate-800 flex items-center gap-1.5 mb-1">
                    <Smartphone className="w-3.5 h-3.5 text-sky-600" />
                    <span>ဖုန်း (Touch)</span>
                  </div>
                  <div className="text-[11px] text-slate-600 leading-snug">
                    <strong>ဘယ် / ညာ</strong> ကွေ့ပါ၊ <strong>ခုန်မည်</strong> နှိပ်ပါ၊ ညာအောက်{' '}
                    <strong>ITEM</strong> ခလုတ်ဖြင့် Item သုံးပါ။
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <div className="font-black text-slate-800 flex items-center gap-1.5 mb-1">
                    <Keyboard className="w-3.5 h-3.5 text-amber-600" />
                    <span>ကွန်ပျူတာ (Keyboard)</span>
                  </div>
                  <div className="text-[11px] text-slate-600 leading-snug">
                    <strong>A/D</strong> ကွေ့ · <strong>Space/W</strong> ခုန် ·{' '}
                    <strong>E / Shift / Enter</strong> ဖြင့် Item သုံးပါ။
                  </div>
                </div>
              </div>

              {/* Offline Demo Bots Toggle */}
              <label className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200 cursor-pointer select-none">
                <div className="min-w-0">
                  <div className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                    <Bot className="w-4 h-4 text-sky-600 shrink-0" />
                    <span>Offline Demo Bots (၂ ဦး) ထည့်သွင်းမည်</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    အွန်လိုင်းကစားသမား မဟုတ်ပါ — Offline စမ်းသပ် Bot များသာ
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={showOfflineBots}
                  onChange={(e) => handleToggleOfflineBots(e.target.checked)}
                  className="w-5 h-5 accent-sky-600 rounded cursor-pointer shrink-0"
                />
              </label>

              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  handleStartRace();
                }}
                className="w-full min-h-[48px] py-3 rounded-2xl bg-amber-400 hover:bg-amber-500 active:scale-[0.99] text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-md transition cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>စတင်စမ်းသပ်ကစားမည် (Start {COURSE_LENGTH_KM_TEXT} km Race)</span>
              </button>
            </div>
          </div>
        )}

        {/* Phase 4: Finish Summary Overlay at 1,500 m */}
        {hud.phase === 'finished' && (
          <div className="absolute inset-0 z-30 flex items-center justify-center p-3 sm:p-6 bg-slate-950/40 backdrop-blur-[2px]">
            <div className="w-full max-w-md bg-white/95 border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-600">
                <Trophy className="w-7 h-7" />
              </div>

              <div>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-100 border border-emerald-300 text-emerald-900 text-[11px] font-black">
                  <Flag className="w-3 h-3" />
                  <span>{COURSE_LENGTH_KM_TEXT} km ပန်းဝင်အောင်မြင်ပြီ!</span>
                </span>
                <h3 className="text-xl sm:text-2xl font-black text-slate-900 mt-1.5">
                  နှင်းတောင်ဆင်းပြိုင်ပွဲ ပြီးဆုံးပါပြီ
                </h3>
                {hud.showOfflineBots && hud.finishRank !== null && (
                  <p className="text-xs font-bold text-sky-800 mt-1">
                    အဆင့် #{hud.finishRank} / {hud.totalRacers} (Offline Demo စမ်းသပ်မှု)
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-left">
                <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-500">စုစုပေါင်း စံချိန်</div>
                  <div className="text-sm font-black font-mono tabular-nums text-slate-900 mt-0.5">
                    {hud.finishTimeSecText || hud.elapsedSecText}s
                  </div>
                </div>

                <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
                    <Gauge className="w-3 h-3 text-sky-600" />
                    <span>အမြင့်ဆုံးအရှိန်</span>
                  </div>
                  <div className="text-sm font-black font-mono tabular-nums text-slate-900 mt-0.5">
                    {hud.topSpeedKmh} km/h
                  </div>
                </div>

                <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
                    <Package className="w-3 h-3 text-amber-600" />
                    <span>Item / Hit</span>
                  </div>
                  <div className="text-sm font-black font-mono tabular-nums text-slate-900 mt-0.5">
                    {hud.itemsUsedCount} / {hud.attacksLandedCount}
                  </div>
                </div>

                <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-500">တိုက်မိ / နှင်းပိ</div>
                  <div className="text-sm font-black font-mono tabular-nums text-slate-900 mt-0.5">
                    {hud.obstacleHitCount} / {hud.tumbleCount}
                  </div>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-900">
                Local Prototype စမ်းသပ်မှုသာ ဖြစ်ပါသည် — XP၊ ရွှေဒင်္ဂါးနှင့် အွန်လိုင်းမှတ်တမ်းများ
                မပြောင်းလဲပါ။
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    handleReturnToStartScreen();
                  }}
                  className="flex-1 min-h-[46px] py-2.5 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs sm:text-sm transition cursor-pointer whitespace-nowrap"
                >
                  မူလစာမျက်နှာ
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    handleRestartDemo();
                  }}
                  className="flex-1 min-h-[46px] py-2.5 px-4 rounded-2xl bg-amber-400 hover:bg-amber-500 active:scale-[0.99] text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer whitespace-nowrap"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Restart Demo</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Thumb-Friendly Mobile & Pointer Multi-Touch Controls (Steer + Jump + ITEM) */}
        <TouchControlsOverlay
          disabled={controlsDisabled}
          heldItem={hud.heldItem}
          heldItemIcon={hud.heldItemIcon}
          heldItemName={hud.heldItemName}
          itemArmingSec={hud.itemArmingSec}
          isItemReady={hud.isItemReady}
          onSteerLeftChange={handleTouchLeft}
          onSteerRightChange={handleTouchRight}
          onJumpChange={handleTouchJump}
          onUseItemTrigger={triggerManualItemUse}
        />
      </div>
    </div>
  );
};

/**
 * Standardized `GameModuleGameplayProps` adapter for `SnowRushModule` (Step 4.8).
 * Renders `SnowRushMultiplayerView` for online room sessions while `SnowRushPrototypeView`
 * remains strictly isolated for local `?devSnowRush=1` preview.
 */
export const SnowRushGame: React.FC<GameModuleGameplayProps> = (props) => {
  return <SnowRushMultiplayerView {...props} />;
};
