import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { sounds } from '../../lib/sound';
import { SHOP_CATALOG } from '../../config/gameRules';
import {
  Home,
  Gamepad2,
  Users,
  Trophy,
  ShoppingBag,
  User,
  Coins,
  Shield,
  Volume2,
  VolumeX,
} from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onOpenCreateOrJoinRoom?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, onSelectTab }) => {
  const { userProfile } = useAuth();
  const [isMuted, setIsMuted] = useState(!sounds.enabled);

  const toggleSound = () => {
    sounds.enabled = !sounds.enabled;
    setIsMuted(!sounds.enabled);
    if (sounds.enabled) {
      sounds.playClick();
    }
  };

  const navItems = [
    { id: 'home', label: 'ပင်မစာမျက်နှာ', icon: Home },
    { id: 'games', label: 'ဂိမ်းများ', icon: Gamepad2 },
    { id: 'rooms', label: 'အခန်းများ', icon: Users },
    { id: 'leaderboard', label: 'ဦးဆောင်သူများ', icon: Trophy },
    { id: 'shop', label: 'ဆိုင်', icon: ShoppingBag },
    { id: 'profile', label: 'ကျွန်ုပ်၏ Profile', icon: User },
  ];

  const activeFrameItem = SHOP_CATALOG.find((i) => i.id === userProfile?.activeFrame);

  return (
    <>
      {/* Top Header Desktop & Mobile */}
      <header className="sticky top-0 z-40 w-full bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 md:px-8 py-3 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Logo */}
          <div
            onClick={() => {
              sounds.playClick();
              onSelectTab('home');
            }}
            className="flex items-center gap-2.5 cursor-pointer group select-none"
          >
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-400 to-yellow-300 flex items-center justify-center shadow-md shadow-amber-400/20 group-hover:scale-105 transition-transform">
              <span className="text-xl">🎲</span>
            </div>
            <div>
              <div className="font-black text-slate-900 text-base md:text-lg tracking-tight flex items-center gap-1.5">
                <span>Child Vibes</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-amber-400 text-slate-950 font-black">
                  PRO
                </span>
              </div>
              <div className="text-[10px] text-slate-500 font-medium hidden sm:block">
                Online Mini Game Platform
              </div>
            </div>
          </div>

          {/* Desktop Nav Items */}
          <nav className="hidden lg:flex items-center gap-1 bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200/80">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    sounds.playClick();
                    onSelectTab(item.id);
                  }}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                    isActive
                      ? 'bg-amber-400 text-slate-950 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* User Right Status Bar */}
          <div className="flex items-center gap-3">
            {/* Sound Toggle */}
            <button
              onClick={toggleSound}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200/70 border border-slate-200 text-slate-600 hover:text-slate-900 transition cursor-pointer"
              title={isMuted ? 'အသံဖွင့်မည်' : 'အသံပိတ်မည်'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-500" /> : <Volume2 className="w-4 h-4 text-amber-600" />}
            </button>

            {userProfile && (
              <>
                {/* Points Chip */}
                <button
                  onClick={() => {
                    sounds.playClick();
                    onSelectTab('shop');
                  }}
                  className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100/80 border border-amber-300 px-3 py-1.5 rounded-xl transition cursor-pointer shadow-xs"
                  title="ရွှေဒင်္ဂါးလက်ကျန် (ဆိုင်သို့သွားရန် နှိပ်ပါ)"
                >
                  <Coins className="w-4 h-4 text-amber-600" />
                  <span className="font-mono font-black text-amber-900 text-xs md:text-sm">
                    {userProfile.points.toLocaleString()}
                  </span>
                </button>

                {/* Mini Profile Trigger */}
                <button
                  onClick={() => {
                    sounds.playClick();
                    onSelectTab('profile');
                  }}
                  className="flex items-center gap-2 group cursor-pointer"
                >
                  <div
                    className={`w-9 h-9 rounded-xl overflow-hidden p-0.5 border ${
                      activeFrameItem?.previewBorder || 'border-amber-400/50'
                    }`}
                  >
                    <img
                      src={userProfile.photoURL}
                      alt={userProfile.displayName}
                      className="w-full h-full object-cover rounded-lg bg-slate-100"
                    />
                  </div>
                  <div className="text-left hidden sm:block">
                    <div className="text-xs font-bold text-slate-800 group-hover:text-amber-600 transition truncate max-w-[100px]">
                      {userProfile.displayName}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      Lvl {userProfile.level}
                    </div>
                  </div>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-slate-200 px-2 py-1.5 shadow-lg">
        <div className="flex items-center justify-around">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  sounds.playClick();
                  onSelectTab(item.id);
                }}
                className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl transition cursor-pointer ${
                  isActive ? 'text-amber-600 font-bold' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'scale-110' : ''}`} />
                <span className="text-[10px] mt-0.5 whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
