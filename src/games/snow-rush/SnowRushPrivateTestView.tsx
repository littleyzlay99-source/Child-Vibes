import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  LogIn,
  PlusCircle,
  ShieldCheck,
  Users,
  WifiOff,
  Wrench,
} from 'lucide-react';
import { LoginScreen } from '../../components/Auth/LoginScreen';
import { SharedRoomLobby } from '../../components/Multiplayer/SharedRoomLobby';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import { sounds } from '../../lib/sound';
import { deriveLevelProgress } from '../../services/progressionService';
import { deduplicateRoomPlayers, normalizeMaxPlayers } from '../../services/roomStateHelpers';
import type { GameRoom, MatchRewardResult } from '../../types';
import { getGameById } from '../registry';
import type { RoomStateCommitPayload } from '../types';
import { resolveSnowRushWorkerHealthUrl } from './network/protocol';
import {
  checkSnowRushWorkerHealth,
  clampPrivateSnowRushMaxPlayers,
  createPrivateSnowRushRoom,
  joinPrivateSnowRushRoomByCode,
  leavePrivateSnowRushRoom,
  startPrivateSnowRushRace,
  togglePrivateSnowRushReady,
  type SnowRushWorkerHealthCheckResult,
} from '../../services/snowRushPrivateRoomService';
import { SnowRushModuleTitleFallback, snowRushModule } from './SnowRushPrivateMeta';
import { SnowRushMultiplayerView } from './SnowRushMultiplayerView';

export interface SnowRushPrivateTestViewProps {
  readonly onExitPrivateTest?: () => void;
}

const NOOP_COMMIT_ROOM_STATE = (_payload: RoomStateCommitPayload): void => {
  // Authoritative race state lives in SnowRushRoomDO; zero Firestore room commits during race.
};

const NOOP_ASYNC = async (): Promise<void> => {
  // Reward settlement and room reset remain strictly disabled in Step 4.9.
};

/**
 * Snow Rush: Avalanche Escape — Step 4.9 Opt-In Private Multiplayer Test Host (`?privateSnowRush=1`)
 *
 * Strict Safety Guarantees:
 * - Reachable ONLY when explicitly opened via `?privateSnowRush=1`.
 * - Keeps `snow_rush` as `coming_soon` in `registry.ts` for all public users.
 * - Performs ZERO automatic Firestore writes on page load or invite link open.
 * - Blocks room creation when `VITE_SNOW_RUSH_WS_URL` is unconfigured so Firestore stays clean.
 * - Never calls `claimMatchReward()` and never writes `winnerId`, `status: 'finished'`, XP, or Points.
 */
export const SnowRushPrivateTestView: React.FC<SnowRushPrivateTestViewProps> = ({
  onExitPrivateTest,
}) => {
  const { currentUser, userProfile, loading } = useAuth();
  const registryEntry = getGameById('snow_rush');

  const initialUrlRoomCode = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const raw = new URLSearchParams(window.location.search).get('room') || '';
    return raw.replace(/^#/, '').trim().toUpperCase().slice(0, 8);
  }, []);

  const configuredHealthUrl = useMemo(() => resolveSnowRushWorkerHealthUrl(), []);
  const isWsConfigured = configuredHealthUrl !== null;

  const configuredWorkerHostLabel = useMemo(() => {
    if (!configuredHealthUrl) return null;
    try {
      const parsed = new URL(configuredHealthUrl);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return null;
    }
  }, [configuredHealthUrl]);

  const [maxPlayersSelection, setMaxPlayersSelection] = useState<2 | 3 | 4>(4);
  const [joinCodeInput, setJoinCodeInput] = useState<string>(initialUrlRoomCode);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [roomLoading, setRoomLoading] = useState<boolean>(false);

  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [isExitingRoom, setIsExitingRoom] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const [healthLoading, setHealthLoading] = useState<boolean>(false);
  const [healthResult, setHealthResult] = useState<SnowRushWorkerHealthCheckResult | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const prevRoomStatusRef = useRef<string | null>(null);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Subscribe to the active Private Test Room ONLY after explicit Create / Join
  useEffect(() => {
    if (!activeRoomId || !currentUser?.uid) {
      return;
    }

    let subscribed = true;
    setRoomLoading(true);
    const roomRef = doc(db, 'rooms', activeRoomId);

    const unsubscribe = onSnapshot(
      roomRef,
      (snap) => {
        if (!subscribed) return;
        if (!snap.exists()) {
          if (!snap.metadata.fromCache) {
            setActiveRoomId(null);
            setRoom(null);
            setRoomLoading(false);
          }
          return;
        }

        const data = snap.data() as GameRoom;
        const uniquePlayers = deduplicateRoomPlayers(data.players, data.playerPositions);
        const maxCap = normalizeMaxPlayers(data.maxPlayers);
        const stillMember = uniquePlayers.some((p) => p.uid === currentUser.uid);

        if (!stillMember && !snap.metadata.fromCache) {
          setActiveRoomId(null);
          setRoom(null);
          setRoomLoading(false);
          return;
        }

        if (prevRoomStatusRef.current === 'playing' && data.status === 'waiting') {
          setInfoMessage(
            'အခြားကစားသမား ထွက်ခွာသွားသဖြင့် Private Waiting Lobby သို့ ပြန်လည်ရောက်ရှိပါသည်။'
          );
        }
        prevRoomStatusRef.current = data.status;

        setRoom({
          ...data,
          id: data.id || snap.id,
          maxPlayers: maxCap,
          playerCount: uniquePlayers.length,
          players: uniquePlayers,
        });
        setRoomLoading(false);
      },
      (err) => {
        console.error('Private Snow Rush room listener error:', err);
        if (subscribed) {
          setRoomLoading(false);
        }
      }
    );

    return () => {
      subscribed = false;
      unsubscribe();
    };
  }, [activeRoomId, currentUser?.uid]);

  const handleRunHealthCheck = useCallback(async () => {
    if (healthLoading) return;
    sounds.playClick();
    setHealthLoading(true);
    try {
      const res = await checkSnowRushWorkerHealth();
      setHealthResult(res);
    } finally {
      setHealthLoading(false);
    }
  }, [healthLoading]);

  const handleCreatePrivateRoom = async () => {
    if (!userProfile || !isWsConfigured || isBusy) return;
    sounds.playClick();
    setIsBusy(true);
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      const result = await createPrivateSnowRushRoom(
        userProfile,
        clampPrivateSnowRushMaxPlayers(maxPlayersSelection)
      );
      prevRoomStatusRef.current = result.room.status;
      setRoom(result.room);
      setActiveRoomId(result.roomId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Private Room ဖန်တီးခြင်း မအောင်မြင်ပါ။';
      setErrorMessage(msg);
    } finally {
      setIsBusy(false);
    }
  };

  const handleJoinPrivateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !isWsConfigured || isBusy || !joinCodeInput.trim()) return;
    sounds.playClick();
    setIsBusy(true);
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      const result = await joinPrivateSnowRushRoomByCode(joinCodeInput, userProfile);
      prevRoomStatusRef.current = result.room.status;
      setRoom(result.room);
      setActiveRoomId(result.roomId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Private Room သို့ ဝင်ရောက်ခြင်း မအောင်မြင်ပါ။';
      setErrorMessage(msg);
    } finally {
      setIsBusy(false);
    }
  };

  const handleLeaveCurrentRoom = useCallback(async () => {
    const uid = currentUser?.uid;
    const roomToLeave = activeRoomId;
    if (!uid || !roomToLeave || isExitingRoom) {
      setActiveRoomId(null);
      setRoom(null);
      return;
    }

    sounds.playClick();
    setIsExitingRoom(true);
    try {
      await leavePrivateSnowRushRoom(roomToLeave, uid);
    } catch (err) {
      console.warn('Private Snow Rush room exit notice:', err);
    } finally {
      prevRoomStatusRef.current = null;
      setRoom(null);
      setActiveRoomId(null);
      setIsExitingRoom(false);
    }
  }, [activeRoomId, currentUser?.uid, isExitingRoom]);

  const handleExitBackToPlatform = async () => {
    if (activeRoomId && currentUser?.uid) {
      await handleLeaveCurrentRoom();
    }
    if (onExitPrivateTest) {
      onExitPrivateTest();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign(window.location.pathname || '/');
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-10 h-10 rounded-full border-4 border-amber-400 border-t-transparent animate-spin mb-3" />
        <div className="text-sm font-bold">Snow Rush Private Test စစ်ဆေးနေပါသည်...</div>
      </div>
    );
  }

  if (!currentUser || !userProfile) {
    return <LoginScreen />;
  }

  // Active Race Surface (`status === 'playing'`)
  if (activeRoomId && room && room.status === 'playing') {
    const currentPlayer = room.players.find((p) => p.uid === currentUser.uid);
    const nullReward: MatchRewardResult | null = null;

    return (
      <div className="h-[100dvh] w-full flex flex-col overflow-hidden bg-slate-950 text-white">
        <div className="bg-slate-950 border-b border-slate-800 px-3 sm:px-5 py-2 flex items-center justify-between gap-2 shrink-0 z-30">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-wider shrink-0">
              <Wrench className="w-3 h-3" />
              <span>PRIVATE MP TEST</span>
            </span>
            <span className="text-xs font-bold text-slate-100 truncate">
              #{room.roomCode} · {registryEntry?.shortTitle || SnowRushModuleTitleFallback}
            </span>
            <span className="hidden md:inline-block text-[11px] text-slate-400 truncate">
              · No XP/Points · Registry: coming_soon
            </span>
          </div>

          <button
            type="button"
            disabled={isExitingRoom}
            onClick={() => void handleLeaveCurrentRoom()}
            className="min-h-[34px] px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{isExitingRoom ? 'ထွက်နေသည်...' : 'အခန်းမှ ထွက်မည်'}</span>
          </button>
        </div>

        <SnowRushMultiplayerView
          room={room}
          currentUserId={currentUser.uid}
          currentUserDisplayName={userProfile.displayName}
          currentPlayer={currentPlayer}
          isHost={room.hostId === currentUser.uid}
          isOnline={isOnline}
          reconnectCountdown={60}
          cosmetics={{
            activeBoardSkin: userProfile.activeBoardSkin || 'board_classic',
            activeDiceSkin: userProfile.activeDiceSkin || 'dice_classic',
            activeTokenSkin: userProfile.activeTokenSkin || 'token_crown',
            activeFrame: userProfile.activeFrame || 'frame_gold',
          }}
          rewardOutcome={nullReward}
          fallbackProgress={deriveLevelProgress(userProfile.totalXp ?? 0)}
          isClaimingReward={false}
          isExiting={isExitingRoom}
          onCommitRoomState={NOOP_COMMIT_ROOM_STATE}
          onTurnTimeout={NOOP_ASYNC}
          onPlayAgain={NOOP_ASYNC}
          onRequestExit={() => {
            void handleLeaveCurrentRoom();
          }}
          onLeaveAfterFinish={handleLeaveCurrentRoom}
        />
      </div>
    );
  }

  // Active Private Waiting Lobby (`status === 'waiting' | 'full'`)
  if (activeRoomId && (roomLoading || room)) {
    if (!room) {
      return (
        <div className="min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-10 h-10 rounded-full border-4 border-amber-500 border-t-transparent animate-spin mb-3" />
          <div className="text-slate-800 font-bold text-sm">
            Private Test အခန်း ချိတ်ဆက်နေပါသည်...
          </div>
        </div>
      );
    }

    const isHost = room.hostId === currentUser.uid;
    const currentPlayer = room.players.find((p) => p.uid === currentUser.uid);
    const canStart =
      isWsConfigured &&
      room.players.length >= 2 &&
      room.players.length <= 4 &&
      room.players.every((p) => (p.uid === room.hostId ? true : p.isReady));

    const handleCopyPrivateCode = () => {
      sounds.playClick();
      navigator.clipboard.writeText(room.roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    };

    const handleCopyPrivateInviteLink = () => {
      sounds.playClick();
      const inviteUrl = `${window.location.origin}${window.location.pathname}?privateSnowRush=1&room=${room.roomCode}`;
      navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    };

    const handleToggleReady = async () => {
      if (!currentPlayer || isBusy) return;
      sounds.playClick();
      setIsBusy(true);
      try {
        await togglePrivateSnowRushReady(activeRoomId, currentUser.uid, !currentPlayer.isReady);
      } finally {
        setIsBusy(false);
      }
    };

    const handleStartRace = async () => {
      if (!isHost || !canStart || isBusy) return;
      sounds.playClick();
      setIsBusy(true);
      try {
        await startPrivateSnowRushRace(activeRoomId, currentUser.uid);
      } finally {
        setIsBusy(false);
      }
    };

    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-sky-50 via-white to-slate-100 text-slate-900">
        <div className="bg-slate-950 text-white px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold truncate">
            <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[10px] font-black uppercase">
              PRIVATE TEST
            </span>
            <span className="truncate">
              Snow Rush Multiplayer Lobby · သူငယ်ချင်းများကို Private Link ဖြင့် ဖိတ်ခေါ်ပါ
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleExitBackToPlatform()}
            className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold cursor-pointer whitespace-nowrap"
          >
            Platform သို့ ပြန်မည်
          </button>
        </div>

        {infoMessage && (
          <div className="max-w-4xl mx-auto px-4 pt-4">
            <div className="p-3 rounded-2xl bg-sky-50 border border-sky-200 text-sky-900 text-xs font-bold">
              {infoMessage}
            </div>
          </div>
        )}

        <SharedRoomLobby
          roomCode={room.roomCode}
          roomStatus={room.status === 'full' ? 'full' : 'waiting'}
          gameTitle={`${registryEntry?.shortTitle || SnowRushModuleTitleFallback} (Private Test)`}
          gameIcon={registryEntry?.icon || '🏂'}
          ruleSummary="Private Test · XP / Points မတွက်ပါ"
          instructionsText={snowRushModule.instructionsMm}
          hostId={room.hostId}
          hostName={room.hostName}
          currentUserId={currentUser.uid}
          players={room.players}
          minPlayers={2}
          maxPlayers={normalizeMaxPlayers(room.maxPlayers)}
          isHost={isHost}
          canStartGame={canStart}
          isOnline={isOnline}
          isTogglingReady={isBusy}
          isStartingGame={isBusy}
          isExiting={isExitingRoom}
          copiedCode={copiedCode}
          copiedLink={copiedLink}
          onCopyCode={handleCopyPrivateCode}
          onCopyLink={handleCopyPrivateInviteLink}
          onToggleReady={handleToggleReady}
          onStartGame={handleStartRace}
          onLeaveRoom={() => {
            void handleLeaveCurrentRoom();
          }}
        />
      </div>
    );
  }

  // Default Opt-in Private Test Readiness & Entry Screen (Zero automatic Firestore writes)
  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Top Bar */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 text-[11px] font-black uppercase tracking-wider">
              <Wrench className="w-3.5 h-3.5" />
              <span>PRIVATE MULTIPLAYER TEST</span>
            </span>
            <span className="text-xs text-slate-400 hidden sm:inline">
              Public Status: coming_soon · Zero Reward Settlement
            </span>
          </div>

          <button
            type="button"
            onClick={() => void handleExitBackToPlatform()}
            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Child Vibes သို့ ပြန်သွားမည်</span>
          </button>
        </div>

        {/* Header Card */}
        <div className="rounded-3xl bg-slate-900/90 border border-slate-800 p-5 sm:p-6 space-y-2 shadow-xl">
          <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
            <span>🏂</span>
            <span>Snow Rush: Avalanche Escape (Private 2–4P Test)</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            ဤစာမျက်နှာသည် သူငယ်ချင်း ၂–၄ ဦး သီးသန့် Multiplayer စမ်းသပ်ရန် Opt-in Private Test Mode
            ဖြစ်ပါသည်။ Public Room List တွင် မပေါ်ပါ၊ XP / Points မတွက်ချက်ပါ။
          </p>
          <div className="pt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            <span className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-emerald-300 font-semibold inline-flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>အကောင့်ဝင်ထားသူ: {userProfile.displayName}</span>
            </span>
          </div>
        </div>

        {/* Companion Worker Readiness & Health Check Card */}
        <div className="rounded-3xl bg-slate-900/90 border border-slate-800 p-5 sm:p-6 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-sky-400" />
                <span>Multiplayer Worker ချိတ်ဆက်မှု အခြေအနေ</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {isWsConfigured
                  ? `VITE_SNOW_RUSH_WS_URL သတ်မှတ်ထားပြီး (${configuredWorkerHostLabel})`
                  : 'VITE_SNOW_RUSH_WS_URL အလွတ်ဖြစ်နေပါသည် (Worker Deploy ပြီး Build-time Env ထည့်သွင်းရန် လိုအပ်ပါသည်)'}
              </p>
            </div>

            <button
              type="button"
              disabled={!isWsConfigured || healthLoading}
              onClick={() => void handleRunHealthCheck()}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black text-xs cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
            >
              {healthLoading ? 'စစ်ဆေးနေသည်...' : 'Worker /health စမ်းသပ်မည်'}
            </button>
          </div>

          {!isWsConfigured && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-400/30 text-amber-200 text-xs flex items-start gap-2.5 leading-relaxed">
              <WifiOff className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
              <div>
                <div className="font-black text-amber-100">
                  Multiplayer Server မသတ်မှတ်ရသေးပါ (Unconfigured)
                </div>
                <div className="mt-0.5 text-amber-200/90">
                  `workers/snow-rush-server` ကို Cloudflare သို့ Deploy လုပ်ပြီး ရရှိလာသော Worker URL
                  ကို `VITE_SNOW_RUSH_WS_URL` တွင် သတ်မှတ်၍ Frontend ပြန် Build လုပ်ပြီးမှ Private
                  Test Room ဖွင့်နိုင်ပါမည်။
                </div>
              </div>
            </div>
          )}

          {healthResult && (
            <div
              className={`p-3.5 rounded-2xl border text-xs space-y-1.5 ${
                healthResult.ok
                  ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200'
                  : 'bg-rose-500/10 border-rose-400/30 text-rose-200'
              }`}
            >
              <div className="font-black flex items-center gap-1.5">
                {healthResult.ok ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>
                      Worker အသင့်ဖြစ်နေပါသည် (HTTP {healthResult.statusCode} ·{' '}
                      {healthResult.latencyMs ?? 0} ms)
                    </span>
                  </>
                ) : (
                  <span>{healthResult.errorMessageMm || 'Health စစ်ဆေးမှု မအောင်မြင်ပါ'}</span>
                )}
              </div>
              {healthResult.ok && (
                <div className="text-[11px] text-slate-300 flex flex-wrap gap-x-4 gap-y-1">
                  <span>Protocol v{healthResult.protocolVersion}</span>
                  <span>Snapshot: {healthResult.snapshotBroadcastHz ?? 10} Hz</span>
                  <span>
                    DO SQLite: {healthResult.durableObjectBindingReady ? 'Ready' : 'Missing'}
                  </span>
                  <span>
                    Named Firestore DB:{' '}
                    {healthResult.firestoreNamedDbConfigured ? 'Ready' : 'Check Config'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-400/40 text-rose-200 text-xs font-bold">
            {errorMessage}
          </div>
        )}

        {/* Explicit Manual Create / Join Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-3xl bg-slate-900/90 border border-slate-800 p-5 space-y-4 shadow-xl flex flex-col justify-between">
            <div className="space-y-3">
              <div className="text-sm font-black text-white flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-amber-400" />
                <span>Private Test Room အသစ်ဖွင့်မည်</span>
              </div>
              <p className="text-xs text-slate-400">
                အခန်းဖွင့်ပြီးပါက Private Link သို့မဟုတ် 6-လုံးပါ Room Code ဖြင့် သူငယ်ချင်းများကို
                ဖိတ်ခေါ်ပါ။
              </p>

              <div>
                <div className="text-[11px] font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-amber-400" />
                  <span>အများဆုံး ကစားသမားဦးရေ</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([2, 3, 4] as const).map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      disabled={!isWsConfigured || isBusy}
                      onClick={() => {
                        sounds.playClick();
                        setMaxPlayersSelection(cnt);
                      }}
                      className={`min-h-[40px] rounded-xl text-xs font-black transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                        maxPlayersSelection === cnt
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {cnt} ဦး
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={!isWsConfigured || isBusy}
              onClick={() => void handleCreatePrivateRoom()}
              className="w-full min-h-[44px] py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black text-xs sm:text-sm transition cursor-pointer disabled:cursor-not-allowed"
            >
              {isBusy ? 'ဆောင်ရွက်နေသည်...' : 'Private Test Room ဖန်တီးမည်'}
            </button>
          </div>

          <form
            onSubmit={(e) => void handleJoinPrivateRoom(e)}
            className="rounded-3xl bg-slate-900/90 border border-slate-800 p-5 space-y-4 shadow-xl flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="text-sm font-black text-white flex items-center gap-2">
                <LogIn className="w-4 h-4 text-emerald-400" />
                <span>Private Room Code ဖြင့် ဝင်မည်</span>
              </div>
              <p className="text-xs text-slate-400">
                သူငယ်ချင်းပေးပို့သော 6-လုံးပါ Private Room Code ကို ရိုက်ထည့်ပြီး ဝင်ရောက်ပါ။
              </p>

              <input
                type="text"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                placeholder="ဥပမာ - SG8K29"
                maxLength={8}
                disabled={!isWsConfigured || isBusy}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-emerald-400 focus:outline-hidden font-mono text-sm font-black text-amber-300 tracking-wider disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={!isWsConfigured || isBusy || !joinCodeInput.trim()}
              className="w-full min-h-[44px] py-2.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black text-xs sm:text-sm transition cursor-pointer disabled:cursor-not-allowed"
            >
              {isBusy ? 'ချိတ်ဆက်နေသည်...' : 'Private Room သို့ ဝင်မည်'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default SnowRushPrivateTestView;
