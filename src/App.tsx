/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginScreen } from './components/Auth/LoginScreen';
import { Navbar } from './components/Navigation/Navbar';
import { GameShell } from './components/GameShell/GameShell';
import { HomeView } from './components/Home/HomeView';
import { RoomsBrowseView } from './components/Multiplayer/RoomsBrowseView';
import { RoomView, RoomMetaSummary } from './components/Multiplayer/RoomView';
import { GamesListView } from './components/Games/GamesListView';
import { ShopView } from './components/Shop/ShopView';
import { ProfileView } from './components/Profile/ProfileView';
import { LeaderboardView } from './components/Leaderboard/LeaderboardView';
import { joinGameRoomByCode, leaveGameRoom } from './services/roomService';
import {
  getCandidateSessionRoomId,
  getLocalActiveGameSession,
  getMiniGameTitle,
  isRoomExplicitlyExited,
  markGameSessionExited,
  saveActiveGameSession,
  verifyAndRecoverGameSession,
} from './services/gameSessionService';
import { isGameModulePlayable } from './games';
import { GameRoom } from './types';

function MainApp() {
  const { currentUser, userProfile, loading } = useAuth();
  const [currentTab, setCurrentTab] = useState<string>('home');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [initialRoomData, setInitialRoomData] = useState<GameRoom | null>(null);
  const [activeRoomMeta, setActiveRoomMeta] = useState<RoomMetaSummary | null>(null);
  const [isRecoveringSession, setIsRecoveringSession] = useState<boolean>(true);
  const [inviteJoinError, setInviteJoinError] = useState<string | null>(null);

  const recoveredUidRef = useRef<string | null>(null);
  const urlJoinAttemptedRef = useRef<boolean>(false);

  const handleEnterRoom = useCallback(
    (roomId: string, room?: GameRoom | null) => {
      setInviteJoinError(null);
      setInitialRoomData(room ?? null);
      if (room) {
        setActiveRoomMeta({
          roomCode: room.roomCode,
          gameType: room.gameType ?? '',
          status: room.status,
        });
      } else {
        setActiveRoomMeta(null);
      }
      setActiveRoomId(roomId);

      if (currentUser?.uid && (!room || isGameModulePlayable(room.gameType))) {
        saveActiveGameSession(
          currentUser.uid,
          roomId,
          room?.roomCode,
          room?.gameType || 'snakes_and_ladders',
          true
        );
      }
    },
    [currentUser?.uid]
  );

  // Clean state unlock when server confirms room closed or after post-finish exit
  const handleRoomClosedOrExited = useCallback(() => {
    if (currentUser?.uid && activeRoomId) {
      markGameSessionExited(currentUser.uid, activeRoomId, true);
    }
    if (typeof window !== 'undefined' && window.history.state?.__childVibesGameLock) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    setInitialRoomData(null);
    setActiveRoomMeta(null);
    setActiveRoomId(null);
    setCurrentTab('rooms');
  }, [currentUser?.uid, activeRoomId]);

  // Intentional Game Exit Process triggered ONLY after confirming "ဂိမ်းမှ ထွက်မည်"
  const handleConfirmGameExit = useCallback(async () => {
    const uid = currentUser?.uid;
    const roomToExit = activeRoomId;

    if (uid && roomToExit) {
      try {
        await leaveGameRoom(roomToExit, uid);
      } catch (err) {
        console.warn('Exit room cleanup warning:', err);
        await markGameSessionExited(uid, roomToExit, true);
      }
    }

    setInitialRoomData(null);
    setActiveRoomMeta(null);
    setActiveRoomId(null);
    setCurrentTab('rooms');
  }, [currentUser?.uid, activeRoomId]);

  const handleRoomMetaChange = useCallback((meta: RoomMetaSummary) => {
    setActiveRoomMeta((prev) => {
      if (
        prev &&
        prev.roomCode === meta.roomCode &&
        prev.gameType === meta.gameType &&
        prev.status === meta.status
      ) {
        return prev;
      }
      return meta;
    });
  }, []);

  // Reset session recovery tracker if user logs out or switches account
  useEffect(() => {
    if (!currentUser) {
      recoveredUidRef.current = null;
      setActiveRoomId(null);
      setInitialRoomData(null);
      setActiveRoomMeta(null);
      setIsRecoveringSession(false);
    }
  }, [currentUser]);

  // Boot-time URL Invite Check & Active Game Session Recovery (Refresh / Tab Close / Mobile Unlock)
  useEffect(() => {
    if (loading) return;
    if (!currentUser || !userProfile) {
      setIsRecoveringSession(false);
      return;
    }

    const uid = currentUser.uid;
    if (recoveredUidRef.current === uid) {
      return;
    }
    recoveredUidRef.current = uid;

    let cancelled = false;

    const runBootSessionCheck = async () => {
      // 1. Check URL query parameter for room invitation link (?room=SG8K29)
      if (!urlJoinAttemptedRef.current) {
        const urlParams = new URLSearchParams(window.location.search);
        const roomCodeParam = urlParams.get('room');
        if (roomCodeParam) {
          urlJoinAttemptedRef.current = true;
          window.history.replaceState({}, document.title, window.location.pathname);
          setIsRecoveringSession(true);
          try {
            const result = await joinGameRoomByCode(roomCodeParam, userProfile);
            if (!cancelled) {
              handleEnterRoom(result.roomId, result.room);
            }
          } catch (err: any) {
            if (!cancelled) {
              console.warn('Auto-join from link failed:', err);
              setInviteJoinError(err?.message || 'ဖိတ်ခေါ်ထားသော အခန်းသို့ ဝင်ရောက်၍ မရနိုင်ပါ။');
              setCurrentTab('rooms');
            }
          } finally {
            if (!cancelled) {
              setIsRecoveringSession(false);
            }
          }
          return;
        }
      }

      // 2. Check persisted active game session (localStorage / sessionStorage / Firestore profile)
      const candidateRoomId = getCandidateSessionRoomId(uid, userProfile.activeRoomId);
      if (!candidateRoomId) {
        if (!cancelled) {
          setIsRecoveringSession(false);
        }
        return;
      }

      setIsRecoveringSession(true);
      const localCached = getLocalActiveGameSession(uid);
      const outcome = await verifyAndRecoverGameSession(uid, candidateRoomId);

      if (cancelled) return;

      if (outcome.status === 'recovered') {
        setInitialRoomData(outcome.room);
        setActiveRoomMeta({
          roomCode: outcome.room.roomCode,
          gameType: outcome.room.gameType ?? '',
          status: outcome.room.status,
        });
        setActiveRoomId(outcome.roomId);
      } else if (outcome.status === 'offline_keep') {
        setInitialRoomData(null);
        setActiveRoomMeta(
          localCached
            ? {
                roomCode: localCached.roomCode,
                gameType: localCached.gameType,
                status: 'playing',
              }
            : null
        );
        setActiveRoomId(outcome.roomId);
      } else {
        setActiveRoomId(null);
        setInitialRoomData(null);
        setActiveRoomMeta(null);
      }

      setIsRecoveringSession(false);
    };

    runBootSessionCheck();

    return () => {
      cancelled = true;
    };
  }, [loading, currentUser, userProfile, handleEnterRoom]);

  // Shared Mini-Game Room Controller inside GameShell (delegates gameplay via GameModuleRenderer)
  const renderActiveMiniGame = (roomId: string) => (
    <RoomView
      roomId={roomId}
      initialRoom={initialRoomData}
      onExitRoom={handleRoomClosedOrExited}
      onRoomMetaChange={handleRoomMetaChange}
    />
  );

  if (loading || (currentUser && userProfile && isRecoveringSession)) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-amber-50/40 via-sky-50/20 to-slate-100/50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-full border-4 border-amber-500 border-t-transparent animate-spin mb-4" />
        <div className="text-slate-800 font-bold text-lg">
          {loading
            ? 'Child Vibes ပလက်ဖောင်း ဖွင့်လှစ်နေပါသည်...'
            : 'ကစားလက်စ ဂိမ်းအခန်းသို့ ပြန်လည်ချိတ်ဆက်နေပါသည်...'}
        </div>
        <div className="text-slate-500 text-xs mt-1">ကျေးဇူးပြု၍ ခဏစောင့်ဆိုင်းပေးပါ</div>
      </div>
    );
  }

  // If user is not logged in, show Myanmar Login Screen
  if (!currentUser || !userProfile) {
    return <LoginScreen />;
  }

  // DEDICATED GAME MODE: Hide Main Header & Bottom Navigation Bar completely while in an active room
  if (activeRoomId) {
    const effectiveGameType = activeRoomMeta
      ? activeRoomMeta.gameType
      : initialRoomData
      ? (initialRoomData.gameType ?? '')
      : undefined;
    const effectiveRoomCode =
      activeRoomMeta?.roomCode ||
      initialRoomData?.roomCode ||
      activeRoomId.replace(/^room_/, '');
    const effectiveStatus = activeRoomMeta?.status || initialRoomData?.status || 'loading';

    return (
      <GameShell
        roomId={activeRoomId}
        roomCode={effectiveRoomCode}
        gameTitle={getMiniGameTitle(effectiveGameType)}
        gameStatus={effectiveStatus}
        onConfirmExit={handleConfirmGameExit}
      >
        {renderActiveMiniGame(activeRoomId)}
      </GameShell>
    );
  }

  // Fallback recovery prompt if userProfile syncs an un-exited active room from another tab/device
  const unexitedProfileRoomId =
    userProfile.activeRoomId && !isRoomExplicitlyExited(currentUser.uid, userProfile.activeRoomId)
      ? userProfile.activeRoomId
      : null;

  const handleManualRejoinActiveSession = async () => {
    if (!unexitedProfileRoomId) return;
    setIsRecoveringSession(true);
    const outcome = await verifyAndRecoverGameSession(currentUser.uid, unexitedProfileRoomId);
    setIsRecoveringSession(false);
    if (outcome.status === 'recovered') {
      handleEnterRoom(outcome.roomId, outcome.room);
    } else if (outcome.status === 'offline_keep') {
      handleEnterRoom(outcome.roomId, null);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-amber-50/40 via-sky-50/20 to-slate-100/50 text-slate-800 flex flex-col justify-between pb-22 lg:pb-8">
      <div>
        {/* Main Platform Navigation Bar (Visible ONLY outside Dedicated Game Mode) */}
        <Navbar currentTab={currentTab} onSelectTab={(tab) => setCurrentTab(tab)} />

        {/* Active Session Rejoin Banner (if user has an ongoing un-exited session) */}
        {unexitedProfileRoomId && (
          <div className="max-w-5xl mx-auto px-4 md:px-6 pt-4">
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-slate-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div>
                <div className="font-black text-sm text-slate-900">
                  သင့်တွင် ကစားလက်စ ဂိမ်းအခန်း (#
                  {userProfile.activeRoomCode || unexitedProfileRoomId.replace(/^room_/, '')})
                  ရှိနေပါသည်
                </div>
                <div className="text-slate-600 mt-0.5">
                  လက်ရှိပွဲစဉ်သို့ ပြန်လည်ဝင်ရောက်ပြီး ဆက်လက်ကစားနိုင်ပါသည်။
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleManualRejoinActiveSession}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>ပြန်ဝင်မည်</span>
                </button>
                <button
                  type="button"
                  onClick={() => leaveGameRoom(unexitedProfileRoomId, currentUser.uid)}
                  className="min-h-[40px] px-3 py-2 rounded-xl bg-white hover:bg-rose-50 border border-slate-200 text-rose-700 font-bold text-xs cursor-pointer whitespace-nowrap"
                >
                  ထွက်မည်
                </button>
              </div>
            </div>
          </div>
        )}

        {inviteJoinError && (
          <div className="max-w-5xl mx-auto px-4 md:px-6 pt-4">
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center justify-between gap-3">
              <span>{inviteJoinError}</span>
              <button
                type="button"
                onClick={() => setInviteJoinError(null)}
                className="px-2.5 py-1 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-900 text-[11px] cursor-pointer whitespace-nowrap"
              >
                ပိတ်မည်
              </button>
            </div>
          </div>
        )}

        {/* Tab Content */}
        <main className="container mx-auto py-6">
          {currentTab === 'home' && (
            <HomeView
              onEnterRoom={handleEnterRoom}
              onNavigateToShop={() => setCurrentTab('shop')}
              onNavigateToLeaderboard={() => setCurrentTab('leaderboard')}
            />
          )}

          {currentTab === 'games' && <GamesListView onEnterRoom={handleEnterRoom} />}

          {currentTab === 'rooms' && <RoomsBrowseView onEnterRoom={handleEnterRoom} />}

          {currentTab === 'leaderboard' && <LeaderboardView />}

          {currentTab === 'shop' && <ShopView />}

          {currentTab === 'profile' && <ProfileView />}
        </main>
      </div>

      {/* Desktop Footer */}
      <footer className="hidden lg:block border-t border-slate-200/80 bg-white/40 py-6 text-center text-xs text-slate-500">
        © 2026 Child Vibes. All Rights Reserved. မြန်မာ့အွန်လိုင်း မီနီဂိမ်း ပလက်ဖောင်း
      </footer>
    </div>
  );
}

let LazySnowRushDevPreview: React.LazyExoticComponent<
  React.ComponentType<{ onExitPreview?: () => void }>
> | null = null;

if (import.meta.env.DEV) {
  LazySnowRushDevPreview = React.lazy(() => import('./games/snow-rush/SnowRushDevPreview'));
}

export default function App() {
  const [showDevSnowRush, setShowDevSnowRush] = useState<boolean>(() => {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('devSnowRush') === '1';
    }
    return false;
  });

  // Step 10.5: ?privateSnowRush=1 Private Test entry is disabled in production/public builds.
  // Strip any stale ?privateSnowRush query param so old links land cleanly on the Public Lobby.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('privateSnowRush')) {
      params.delete('privateSnowRush');
      const nextQuery = params.toString();
      const nextUrl = nextQuery
        ? `${window.location.pathname}?${nextQuery}`
        : window.location.pathname;
      window.history.replaceState({}, document.title, nextUrl);
    }
  }, []);

  if (import.meta.env.DEV && showDevSnowRush && LazySnowRushDevPreview) {
    const DevPreviewComponent = LazySnowRushDevPreview;
    return (
      <React.Suspense
        fallback={
          <div className="min-h-[100dvh] bg-slate-950 text-slate-100 flex items-center justify-center text-sm font-bold">
            Snow Rush Local Dev Preview ဖွင့်လှစ်နေပါသည်...
          </div>
        }
      >
        <DevPreviewComponent
          onExitPreview={() => {
            if (typeof window !== 'undefined') {
              const params = new URLSearchParams(window.location.search);
              params.delete('devSnowRush');
              const nextQuery = params.toString();
              const nextUrl = nextQuery
                ? `${window.location.pathname}?${nextQuery}`
                : window.location.pathname;
              window.history.replaceState({}, document.title, nextUrl);
            }
            setShowDevSnowRush(false);
          }}
        />
      </React.Suspense>
    );
  }

  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
