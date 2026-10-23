/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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

function MainApp() {
  const { currentUser, userProfile, loading } = useAuth();
  const [currentTab, setCurrentTab] = useState<string>('home');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  // Check URL query parameters for room invitation links e.g. ?room=SG8K29
  useEffect(() => {
    if (userProfile && !activeRoomId) {
      const urlParams = new URLSearchParams(window.location.search);
      const roomCodeParam = urlParams.get('room');
      if (roomCodeParam) {
        joinGameRoomByCode(roomCodeParam, userProfile)
          .then((roomId) => {
            setActiveRoomId(roomId);
            // Clean URL query
            window.history.replaceState({}, document.title, window.location.pathname);
          })
          .catch((err) => {
            console.warn('Auto-join from link failed:', err);
          });
      }
    }
  }, [userProfile, activeRoomId]);

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
            if (window.confirm('ဂိမ်းအခန်းမှ ထွက်ခွာလိုပါသလား?')) {
              setActiveRoomId(null);
              setCurrentTab(tab);
            }
          }}
        />
        <main className="container mx-auto py-4">
          <RoomView
            roomId={activeRoomId}
            onExitRoom={() => {
              setActiveRoomId(null);
              setCurrentTab('rooms');
            }}
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

        {/* Tab Content */}
        <main className="container mx-auto py-6">
          {currentTab === 'home' && (
            <HomeView
              onEnterRoom={(roomId) => setActiveRoomId(roomId)}
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
            <RoomsBrowseView onEnterRoom={(roomId) => setActiveRoomId(roomId)} />
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
