import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Flag, LogOut, WifiOff } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { sounds } from '../../lib/sound';
import type { GameRoom } from '../../types';
import type { GameModuleGameplayProps } from '../types';
import { COURSE_LENGTH_KM_TEXT, MAX_VISUAL_BURSTS } from './constants';
import { RaceProgressBar } from './components/RaceProgressBar';
import { SnowRushMultiplayerPodium } from './components/SnowRushMultiplayerPodium';
import { SnowRushNetworkStatusBanner } from './components/SnowRushNetworkStatusBanner';
import { TouchControlsOverlay } from './components/TouchControlsOverlay';
import type {
  MultiplayerRaceEvent,
  RaceFinishState,
  SnowRushSnapshot,
} from './engine/multiplayerTypes';
import {
  buildMultiplayerHudSnapshot,
  getMonotonicClientNowMs,
  translateMultiplayerEventsForClient,
  type MultiplayerHudExtras,
} from './multiplayerHud';
import {
  isValidSnowRushRoomId,
  resolveSnowRushWorkerWsUrl,
  type SnowRushNetworkErrorCode,
} from './network/protocol';
import { SnowRushSnapshotInterpolator } from './network/snapshotInterpolation';
import {
  SnowRushSocketClient,
  type SnowRushConnectionStatus,
  type SnowRushWebSocketFactory,
} from './network/SnowRushSocketClient';
import { SnowRushOnlineInputController } from './onlineInputController';
import { SnowRushCanvas } from './renderer/SnowRushCanvas';
import type { SnowRushHudSnapshot, SnowRushVisualBurst } from './types';

export interface SnowRushMultiplayerViewProps extends GameModuleGameplayProps {
  readonly workerBaseUrlOverride?: string | null;
  readonly createWebSocketOverride?: SnowRushWebSocketFactory;
  readonly getIdTokenOverride?: (forceRefresh?: boolean) => Promise<string>;
}

interface AuthoritativeFinishRecord {
  readonly finishState: RaceFinishState;
  readonly snapshot: SnowRushSnapshot;
  readonly gameRound: number;
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

export function evaluateMultiplayerRoomGuard(
  room: GameRoom | null | undefined,
  currentUserId: string | null
): SnowRushNetworkErrorCode | null {
  if (!room || !isValidSnowRushRoomId(room.id)) {
    return 'ROOM_NOT_FOUND';
  }
  if (room.gameType !== 'snow_rush') {
    return 'WRONG_GAME_TYPE';
  }
  const playersList = Array.isArray(room.players) ? room.players : [];
  if (!currentUserId || !playersList.some((p) => p.uid === currentUserId)) {
    return 'NOT_ROOM_MEMBER';
  }
  if (room.status === 'finished') {
    return 'ROOM_ALREADY_FINISHED';
  }
  if (room.status !== 'playing') {
    return 'ROOM_NOT_PLAYING';
  }
  if (playersList.length < 2 || playersList.length > 4) {
    return 'ROOM_CAPACITY_INVALID';
  }
  return null;
}

/**
 * Snow Rush: Avalanche Escape — Step 4.8 Online Multiplayer Gameplay View
 *
 * - Strictly separates Online Multiplayer Mode from Local Prototype Mode (`?devSnowRush=1`).
 * - Never shows Offline Demo Bots, never runs `stepSnowRushSimulation`, and never trusts local state.
 * - Safely handles empty `VITE_SNOW_RUSH_WS_URL` without opening a WebSocket or looping.
 * - Performs ZERO Firestore writes, ZERO reward settlement calls, and ZERO room resets.
 */
export const SnowRushMultiplayerView: React.FC<SnowRushMultiplayerViewProps> = ({
  room,
  currentUserId,
  isOnline,
  isExiting,
  onRequestExit,
  workerBaseUrlOverride,
  createWebSocketOverride,
  getIdTokenOverride,
}) => {
  const initialHudBundle = useMemo(
    () => buildMultiplayerHudSnapshot(null, currentUserId),
    [currentUserId]
  );

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => sounds.enabled);
  const [hud, setHud] = useState<SnowRushHudSnapshot>(initialHudBundle.hud);
  const [hudExtras, setHudExtras] = useState<MultiplayerHudExtras>(initialHudBundle.extras);

  const [connectionStatus, setConnectionStatus] = useState<SnowRushConnectionStatus>('idle');
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState<number>(0);
  const [errorCode, setErrorCode] = useState<
    SnowRushNetworkErrorCode | 'WS_UNCONFIGURED' | 'CONNECTION_FAILED' | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authenticatedUid, setAuthenticatedUid] = useState<string | null>(currentUserId);
  const [authoritativeFinish, setAuthoritativeFinish] =
    useState<AuthoritativeFinishRecord | null>(null);

  const socketClientRef = useRef<SnowRushSocketClient | null>(null);
  const interpolatorRef = useRef<SnowRushSnapshotInterpolator>(
    new SnowRushSnapshotInterpolator()
  );
  const visualBurstsRef = useRef<SnowRushVisualBurst[]>([]);
  const nextBurstSerialRef = useRef<number>(1);
  const prevCountdownStepRef = useRef<number | null>(null);
  const victorySoundPlayedRef = useRef<boolean>(false);
  const lastWarningSoundMsRef = useRef<number>(0);
  const lastNitroTrailSoundMsRef = useRef<number>(0);
  const lastCarveSoundMsRef = useRef<number>(0);

  const roomGuardError = evaluateMultiplayerRoomGuard(room, currentUserId);
  const resolvedWsUrl = useMemo(() => {
    if (roomGuardError !== null) {
      return null;
    }
    return resolveSnowRushWorkerWsUrl(room.id, workerBaseUrlOverride);
  }, [room.id, roomGuardError, workerBaseUrlOverride]);

  const isWsUnconfigured = roomGuardError === null && resolvedWsUrl === null;

  const inputControllerRef = useRef<SnowRushOnlineInputController | null>(null);
  if (inputControllerRef.current === null) {
    inputControllerRef.current = new SnowRushOnlineInputController((intent) => {
      socketClientRef.current?.sendInput(intent);
    });
  }

  // Keep input controller gate synchronized with connection status, racePhase, and finish state
  useEffect(() => {
    inputControllerRef.current?.updateGate({
      connectionStatus,
      racePhase: hudExtras.racePhase,
      localFinished: hudExtras.localFinished || authoritativeFinish !== null,
    });
  }, [connectionStatus, hudExtras.racePhase, hudExtras.localFinished, authoritativeFinish]);

  const clearAllTransientInputs = useCallback(() => {
    inputControllerRef.current?.resetAllInputs();
  }, []);

  const handleServerEvents = useCallback(
    (
      events: readonly MultiplayerRaceEvent[],
      snapshot: SnowRushSnapshot,
      effectiveUid: string | null
    ) => {
      if (events.length === 0) return;

      const translated = translateMultiplayerEventsForClient(
        events,
        snapshot,
        effectiveUid,
        nextBurstSerialRef.current
      );
      nextBurstSerialRef.current = translated.nextBurstSerial;

      if (translated.bursts.length > 0) {
        const merged = [...visualBurstsRef.current, ...translated.bursts];
        visualBurstsRef.current =
          merged.length > MAX_VISUAL_BURSTS
            ? merged.slice(merged.length - MAX_VISUAL_BURSTS)
            : merged;
      }

      const nowMs = getMonotonicClientNowMs();
      for (let i = 0; i < translated.soundCues.length; i += 1) {
        const cue = translated.soundCues[i];
        switch (cue.kind) {
          case 'jump':
            sounds.playSnowJump(cue.isRamp);
            break;
          case 'ramp_boost':
          case 'recovery':
            sounds.playSnowRecovery();
            break;
          case 'obstacle_hit':
            sounds.playObstacleHit(cue.obstacleKind);
            break;
          case 'avalanche_warning':
            if (nowMs - lastWarningSoundMsRef.current >= 2200) {
              lastWarningSoundMsRef.current = nowMs;
              sounds.playAvalancheWarning();
            }
            break;
          case 'snow_tumble':
            sounds.playSnowTumble();
            break;
          case 'item_pickup':
            sounds.playItemPickup();
            break;
          case 'item_empty':
            sounds.playItemEmpty();
            break;
          case 'nitro_activate':
            sounds.playNitroActivate();
            break;
          case 'snowball_launch':
            sounds.playSnowballLaunch();
            break;
          case 'snowball_hit':
            sounds.playSnowballHit();
            break;
          case 'snowball_miss':
            sounds.playSnowballMiss();
            break;
          case 'trap_place':
            sounds.playTrapPlace();
            break;
          case 'trap_hit':
            sounds.playTrapHit();
            break;
          case 'shield_activate':
            sounds.playShieldActivate();
            break;
          case 'shield_break':
            sounds.playShieldBreak();
            break;
          case 'racer_finished':
            if (cue.isLocal && !victorySoundPlayedRef.current) {
              victorySoundPlayedRef.current = true;
              sounds.playVictory();
            }
            break;
          case 'race_finalized':
            if (!victorySoundPlayedRef.current) {
              victorySoundPlayedRef.current = true;
              sounds.playVictory();
            }
            break;
        }
      }
    },
    []
  );

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

  // Single Room-Scoped WebSocket Connection Lifecycle
  useEffect(() => {
    if (roomGuardError !== null || resolvedWsUrl === null) {
      socketClientRef.current?.dispose();
      socketClientRef.current = null;
      interpolatorRef.current.reset();
      visualBurstsRef.current = [];
      return;
    }

    const interpolator = interpolatorRef.current;
    interpolator.reset();
    visualBurstsRef.current = [];
    victorySoundPlayedRef.current = false;
    setAuthoritativeFinish(null);
    setErrorCode(null);
    setErrorMessage(null);
    setRttMs(null);

    const resolveFirebaseToken = async (forceRefresh?: boolean): Promise<string> => {
      if (getIdTokenOverride) {
        return getIdTokenOverride(forceRefresh);
      }
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Firebase user is not signed in.');
      }
      return user.getIdToken(Boolean(forceRefresh));
    };

    const client = new SnowRushSocketClient({
      roomId: room.id,
      getIdToken: resolveFirebaseToken,
      workerBaseUrl: workerBaseUrlOverride,
      createWebSocket: createWebSocketOverride,
      onStatusChange: (nextStatus) => {
        setConnectionStatus(nextStatus);
        setReconnectAttempt(client.getReconnectAttempt());
        if (nextStatus !== 'connected') {
          inputControllerRef.current?.resetAllInputs();
        }
      },
      onWelcome: (welcome) => {
        setAuthenticatedUid(welcome.uid);
        setErrorCode(null);
        setErrorMessage(null);
        interpolator.reset();
        interpolator.pushSnapshot(welcome.snapshot, getMonotonicClientNowMs());

        const synced = buildMultiplayerHudSnapshot(welcome.snapshot, welcome.uid);
        setHud(synced.hud);
        setHudExtras(synced.extras);

        if (welcome.snapshot.finishState.finalized) {
          setAuthoritativeFinish({
            finishState: welcome.snapshot.finishState,
            snapshot: welcome.snapshot,
            gameRound: welcome.gameRound,
          });
        }
      },
      onSnapshot: (snapshot, _serverTimeMs, events) => {
        const effectiveUid = client.getAuthenticatedUid() || currentUserId;
        interpolator.pushSnapshot(snapshot, getMonotonicClientNowMs());
        handleServerEvents(events, snapshot, effectiveUid);

        if (snapshot.finishState.finalized) {
          setAuthoritativeFinish((prev) =>
            prev ?? {
              finishState: snapshot.finishState,
              snapshot,
              gameRound: client.getAuthenticatedGameRound() ?? room.gameRound ?? 1,
            }
          );
        }
      },
      onRaceFinished: (finishState, snapshot, gameRound) => {
        interpolator.pushSnapshot(snapshot, getMonotonicClientNowMs());
        inputControllerRef.current?.resetAllInputs();

        const effectiveUid = client.getAuthenticatedUid() || currentUserId;
        const synced = buildMultiplayerHudSnapshot(snapshot, effectiveUid);
        setHud(synced.hud);
        setHudExtras(synced.extras);

        setAuthoritativeFinish({
          finishState,
          snapshot,
          gameRound,
        });

        if (!victorySoundPlayedRef.current) {
          victorySoundPlayedRef.current = true;
          sounds.playVictory();
        }
      },
      onRttUpdate: (nextRttMs) => {
        setRttMs(nextRttMs);
      },
      onError: (code, msg) => {
        setErrorCode(code);
        setErrorMessage(msg);
      },
    });

    socketClientRef.current = client;
    client.connect();

    return () => {
      inputControllerRef.current?.resetAllInputs();
      client.dispose();
      if (socketClientRef.current === client) {
        socketClientRef.current = null;
      }
      interpolator.reset();
      visualBurstsRef.current = [];
    };
  }, [
    room.id,
    room.gameRound,
    roomGuardError,
    resolvedWsUrl,
    currentUserId,
    workerBaseUrlOverride,
    createWebSocketOverride,
    getIdTokenOverride,
    handleServerEvents,
  ]);

  // Desktop Keyboard Controls (Steer: ArrowLeft/A, ArrowRight/D | Jump: Space/W/ArrowUp | Item: E/Shift/Enter)
  useEffect(() => {
    if (roomGuardError !== null || resolvedWsUrl === null) {
      return;
    }

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

      const controller = inputControllerRef.current;
      if (!controller) return;

      const code = e.code;
      const keyLower = e.key.toLowerCase();

      if (code === 'ArrowLeft' || code === 'KeyA' || keyLower === 'a') {
        e.preventDefault();
        controller.setKeySteerLeft(true);
      } else if (code === 'ArrowRight' || code === 'KeyD' || keyLower === 'd') {
        e.preventDefault();
        controller.setKeySteerRight(true);
      } else if (
        code === 'Space' ||
        e.key === ' ' ||
        code === 'KeyW' ||
        keyLower === 'w' ||
        code === 'ArrowUp'
      ) {
        e.preventDefault();
        controller.setKeyJump(true);
      } else if (
        code === 'KeyE' ||
        keyLower === 'e' ||
        code === 'ShiftLeft' ||
        code === 'ShiftRight' ||
        e.key === 'Shift' ||
        code === 'Enter' ||
        e.key === 'Enter'
      ) {
        if (controller.isInputAllowed()) {
          e.preventDefault();
          controller.triggerManualItem({ isRepeat: e.repeat, fromKeyboard: true });
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const controller = inputControllerRef.current;
      if (!controller) return;

      const code = e.code;
      const keyLower = e.key.toLowerCase();

      if (code === 'ArrowLeft' || code === 'KeyA' || keyLower === 'a') {
        controller.setKeySteerLeft(false);
      } else if (code === 'ArrowRight' || code === 'KeyD' || keyLower === 'd') {
        controller.setKeySteerRight(false);
      } else if (
        code === 'Space' ||
        e.key === ' ' ||
        code === 'KeyW' ||
        keyLower === 'w' ||
        code === 'ArrowUp'
      ) {
        controller.setKeyJump(false);
      } else if (
        code === 'KeyE' ||
        keyLower === 'e' ||
        code === 'ShiftLeft' ||
        code === 'ShiftRight' ||
        e.key === 'Shift' ||
        code === 'Enter' ||
        e.key === 'Enter'
      ) {
        controller.releaseItemKey();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      inputControllerRef.current?.resetAllInputs();
    };
  }, [roomGuardError, resolvedWsUrl]);

  const handleToggleSound = useCallback(() => {
    const next = !sounds.enabled;
    sounds.enabled = next;
    setSoundEnabled(next);
    if (next) {
      sounds.playClick();
    }
  }, []);

  const handleManualItemTrigger = useCallback(() => {
    inputControllerRef.current?.triggerManualItem({ isRepeat: false, fromKeyboard: false });
  }, []);

  const handleTouchLeft = useCallback((pressed: boolean) => {
    inputControllerRef.current?.setTouchSteerLeft(pressed);
  }, []);

  const handleTouchRight = useCallback((pressed: boolean) => {
    inputControllerRef.current?.setTouchSteerRight(pressed);
  }, []);

  const handleTouchJump = useCallback((pressed: boolean) => {
    inputControllerRef.current?.setTouchJump(pressed);
  }, []);

  const handleHudSync = useCallback(
    (nextHud: SnowRushHudSnapshot, nextExtras: MultiplayerHudExtras) => {
      setHud(nextHud);
      setHudExtras(nextExtras);
    },
    []
  );

  const handleAmbientMotionSound = useCallback(
    ({
      nitroActive,
      carvingActive,
      nowMs,
    }: {
      readonly nitroActive: boolean;
      readonly carvingActive: boolean;
      readonly nowMs: number;
    }) => {
      if (nitroActive && nowMs - lastNitroTrailSoundMsRef.current >= 260) {
        lastNitroTrailSoundMsRef.current = nowMs;
        sounds.playNitroTrail();
      }
      if (carvingActive && nowMs - lastCarveSoundMsRef.current >= 290) {
        lastCarveSoundMsRef.current = nowMs;
        sounds.playSnowCarve();
      }
    },
    []
  );

  const handleManualRetry = useCallback(() => {
    if (roomGuardError !== null || resolvedWsUrl === null) return;
    socketClientRef.current?.connect();
  }, [roomGuardError, resolvedWsUrl]);

  // --------------------------------------------------------------------------
  // State A: `VITE_SNOW_RUSH_WS_URL` Unconfigured (Zero Socket, Zero Loop)
  // --------------------------------------------------------------------------
  if (isWsUnconfigured) {
    return (
      <div className="relative flex-1 w-full h-full min-h-[460px] flex flex-col overflow-hidden bg-sky-100 text-slate-900">
        <div className="p-3 sm:p-4 shrink-0">
          <SnowRushNetworkStatusBanner status="error" errorCode="WS_UNCONFIGURED" />
        </div>

        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 shadow-xl space-y-4 text-center">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700">
              <WifiOff className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-lg sm:text-xl font-black text-slate-900">
                Online Multiplayer မချိတ်ဆက်ရသေးပါ
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Multiplayer Server မသတ်မှတ်ရသေးပါ — ဤပတ်ဝန်းကျင်တွင် Snow Rush WebSocket ဆာဗာလိပ်စာ
                ချိတ်ဆက်မထားသေးသဖြင့် အွန်လိုင်းပြိုင်ပွဲကို ယာယီပိတ်ထားပါသည်။
              </p>
            </div>

            <button
              type="button"
              disabled={isExiting}
              onClick={(e) => {
                e.currentTarget.blur();
                onRequestExit();
              }}
              className="w-full min-h-[46px] py-2.5 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer whitespace-nowrap"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>{isExiting ? 'အခန်းမှ ထွက်နေသည်...' : 'အခန်းမှ ထွက်မည်'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // State B: Invalid Room / Membership Guard (Zero Socket, Zero Loop)
  // --------------------------------------------------------------------------
  if (roomGuardError !== null) {
    const isExited = roomGuardError === 'NOT_ROOM_MEMBER';
    return (
      <div className="relative flex-1 w-full h-full min-h-[460px] flex flex-col overflow-hidden bg-sky-100 text-slate-900">
        <div className="p-3 sm:p-4 shrink-0">
          <SnowRushNetworkStatusBanner
            status="rejected"
            errorCode={roomGuardError}
            isRoomExited={isExited}
          />
        </div>

        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 shadow-xl space-y-4 text-center">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-100 border border-rose-300 flex items-center justify-center text-rose-700">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-lg sm:text-xl font-black text-slate-900">
                {isExited ? 'အခန်းမှ ထွက်သွားရပြီ' : 'Room မမှန်ကန်ပါ'}
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                {isExited
                  ? 'သင်သည် ဤပြိုင်ပွဲအခန်းမှ ထွက်ခွာပြီး ဖြစ်ပါသည်။'
                  : 'ပြိုင်ပွဲအခန်း အခြေအနေ မမှန်ကန်တော့သဖြင့် ချိတ်ဆက်၍ မရနိုင်ပါ။'}
              </p>
            </div>

            <button
              type="button"
              disabled={isExiting}
              onClick={(e) => {
                e.currentTarget.blur();
                onRequestExit();
              }}
              className="w-full min-h-[46px] py-2.5 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer whitespace-nowrap"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>{isExiting ? 'အခန်းမှ ထွက်နေသည်...' : 'အခန်းမှ ထွက်မည်'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // State C: Active Online Multiplayer Gameplay + Authoritative HUD + Podium
  // --------------------------------------------------------------------------
  const effectiveLocalUid = authenticatedUid || currentUserId;
  const isRaceFinalized = authoritativeFinish !== null;
  const controlsDisabled =
    connectionStatus !== 'connected' ||
    isRaceFinalized ||
    hudExtras.localFinished ||
    (hudExtras.racePhase !== 'racing' && hudExtras.racePhase !== 'finish_window') ||
    hud.playerStatus === 'tumble';

  return (
    <div className="relative flex-1 w-full h-full min-h-[460px] flex flex-col overflow-hidden bg-sky-100 text-slate-900">
      <RaceProgressBar
        hud={hud}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        onUseItemClick={handleManualItemTrigger}
        isMultiplayer
        multiplayerExtras={hudExtras}
        onRequestExit={onRequestExit}
      />

      <div className="relative flex-1 w-full overflow-hidden">
        <SnowRushCanvas
          mode="multiplayer"
          interpolatorRef={interpolatorRef}
          visualBurstsRef={visualBurstsRef}
          localUid={effectiveLocalUid}
          onClearTransientInputs={clearAllTransientInputs}
          onHudSync={handleHudSync}
          onAmbientMotionSound={handleAmbientMotionSound}
        />

        {/* Floating Network Status & RTT Banner */}
        <div className="pointer-events-none absolute top-3 left-3 right-3 z-20 flex justify-center sm:justify-start">
          <div className="pointer-events-auto max-w-xl">
            <SnowRushNetworkStatusBanner
              status={connectionStatus}
              rttMs={rttMs}
              reconnectAttempt={reconnectAttempt}
              errorCode={errorCode}
              errorMessage={errorMessage}
              isBrowserOffline={!isOnline}
              isRaceCompleted={isRaceFinalized}
              onRetryConnect={handleManualRetry}
            />
          </div>
        </div>

        {/* Countdown Center Callout (3 -> 2 -> 1 -> GO!) */}
        {hud.countdownStep !== null && !isRaceFinalized && (
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

        {/* Early Local Finish Banner while waiting for remaining players in 15s Finish Window */}
        {hudExtras.localFinished && !isRaceFinalized && (
          <div className="pointer-events-none absolute top-16 inset-x-4 z-20 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-emerald-300/60 bg-slate-950/85 px-4 py-2 text-xs font-bold text-emerald-200 shadow-lg backdrop-blur-md">
              <Flag className="w-4 h-4 text-amber-300 shrink-0" />
              <span>
                {COURSE_LENGTH_KM_TEXT} km ပန်းဝင်ပြီး! အခြားကစားသမားများ ပန်းဝင်ရန် စောင့်ဆိုင်းနေသည်
                {hudExtras.finishWindowRemainingSec !== null
                  ? ` (${Math.max(1, Math.ceil(hudExtras.finishWindowRemainingSec))}s)`
                  : '...'}
              </span>
            </div>
          </div>
        )}

        {/* Display-Only Authoritative Match Finished Podium */}
        {authoritativeFinish !== null && (
          <SnowRushMultiplayerPodium
            finishState={authoritativeFinish.finishState}
            snapshot={authoritativeFinish.snapshot}
            currentUserId={effectiveLocalUid}
            connectionStatus={connectionStatus}
            rttMs={rttMs}
            isExiting={isExiting}
            onExitRoom={onRequestExit}
          />
        )}

        {/* Mobile & Pointer Multi-Touch Controls (Steer + Jump + ITEM) */}
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
          onUseItemTrigger={handleManualItemTrigger}
        />
      </div>
    </div>
  );
};
