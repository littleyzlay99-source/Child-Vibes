/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginScreen } from './components/Auth/LoginScreen';
import { Navbar } from './components/Navigation/Navbar';
import { HomeView } from './components/Home/HomeView';
import { RoomsBrowseView } from './components/Multiplayer/RoomsBrowseView';
import { RoomView } from './components/Multiplayer/RoomView';
import { GamesListView } from './components/Games/GamesListView';
import { ShopView } from './components/Shop/ShopView';
import { ProfileView } from './components/Profile/ProfileView';
import { joinGameRoomByCode } from './services/roomService';
import { GameRoom } from './types';

const ACTIVE_ROOM_STORAGE_KEY = 'child_vibes_active_room_id';

function MainApp() {
  const { currentUser, userProfile, loading } = useAuth();
  const [currentTab, setCurrentTab] = useState<string>('home');
  const [initialRoomData, setInitialRoomData] = useState<GameRoom | null>(null);
  const [inviteJoinError, setInviteJoinError] = useState<string | null>(null);
  const urlJoinAttemptedRef = useRef<boolean>(false);

  const [activeRoomId, setActiveRoomIdState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(ACTIVE_ROOM_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });

  const setActiveRoomId = useCallback((roomId: string | null) => {
    setActiveRoomIdState(roomId);
    try {
      if (roomId) {
        sessionStorage.setItem(ACTIVE_ROOM_STORAGE_KEY, roomId);
      } else {
        sessionStorage.removeItem(ACTIVE_ROOM_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }, []);

  const handleEnterRoom = useCallback(
    (roomId: string, room?: GameRoom | null) => {
      setInviteJoinError(null);
      setInitialRoomData(room ?? null);
      setActiveRoomId(roomId);
    },
    [setActiveRoomId]
  );

  const handleExitRoom = useCallback(() => {
    setInitialRoomData(null);
    setActiveRoomId(null);
    setCurrentTab('rooms');
  }, [setActiveRoomId]);

  // Check URL query parameters once for room invitation links e.g. ?room=SG8K29
  useEffect(() => {
    if (userProfile && !activeRoomId && !urlJoinAttemptedRef.current) {
      const urlParams = new URLSearchParams(window.location.search);
      const roomCodeParam = urlParams.get('room');
      if (roomCodeParam) {
        urlJoinAttemptedRef.current = true;
        // Clean URL query immediately so profile updates cannot trigger duplicate joins
        window.history.replaceState({}, document.title, window.location.pathname);

        joinGameRoomByCode(roomCodeParam, userProfile)
          .then((result) => {
            handleEnterRoom(result.roomId, result.room);
          })
          .catch((err: any) => {
            console.warn('Auto-join from link failed:', err);
            setInviteJoinError(err?.message || 'ဖိတ်ခေါ်ထားသော အခန်းသို့ ဝင်ရောက်၍ မရနိုင်ပါ။');
            setCurrentTab('rooms');
          });
      }
    }
  }, [userProfile, activeRoomId, handleEnterRoom]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50/40 via-sky-50/20 to-slate-100/50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-full border-4 border-amber-500 border-t-transparent animate-spin mb-4" />
        <div className="text-slate-800 font-bold text-lg">Child Vibes ပလက်ဖောင်း ဖွင့်လှစ်နေပါသည်...</div>
        <div className="text-slate-500 text-xs mt-1">ကျေးဇူးပြု၍ ခဏစောင့်ဆိုင်းပေးပါ</div>
      </div>
    );
  }

  // If user is not logged in, show Myanmar Login Screen
  if (!currentUser || !userProfile) {
    return <LoginScreen />;
  }

  // If currently in an active game room, show RoomView directly
  if (activeRoomId) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50/40 via-sky-50/20 to-slate-100/50 text-slate-800 pb-16">
        <Navbar
          currentTab="rooms"
          onSelectTab={(tab) => {
            setInitialRoomData(null);
            setActiveRoomId(null);
            setCurrentTab(tab);
          }}
        />
        <main className="container mx-auto py-4">
          <RoomView
            roomId={activeRoomId}
            initialRoom={initialRoomData}
            onExitRoom={handleExitRoom}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50/40 via-sky-50/20 to-slate-100/50 text-slate-800 flex flex-col justify-between pb-20 lg:pb-8">
      <div>
        {/* Navigation Bar */}
        <Navbar currentTab={currentTab} onSelectTab={(tab) => setCurrentTab(tab)} />

        {inviteJoinError && (
          <div className="max-w-5xl mx-auto px-4 md:px-6 pt-4">
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center justify-between gap-3">
              <span>{inviteJoinError}</span>
              <button
                type="button"
                onClick={() => setInviteJoinError(null)}
                className="px-2.5 py-1 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-900 text-[11px] cursor-pointer"
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

          {currentTab === 'games' && (
            <GamesListView
              onPlaySnakesAndLadders={() => {
                setCurrentTab('home');
              }}
            />
          )}

          {currentTab === 'rooms' && (
            <RoomsBrowseView onEnterRoom={handleEnterRoom} />
          )}

          {currentTab === 'leaderboard' && <LeaderboardViewTab />}

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

// Lazy-loaded or direct Leaderboard component import
import { LeaderboardView } from './components/Leaderboard/LeaderboardView';
function LeaderboardViewTab() {
  return <LeaderboardView />;
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
