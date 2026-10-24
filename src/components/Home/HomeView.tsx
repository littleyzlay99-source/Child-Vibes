import React, { useState, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  createGameRoom,
  joinGameRoomByCode,
  RoomJoinError,
  RoomJoinErrorCode,
} from '../../services/roomService';
import { GameRoom, MiniGameCard } from '../../types';
import { sounds } from '../../lib/sound';
import {
  Gamepad2,
  Users,
  Play,
  PlusCircle,
  LogIn,
  Gift,
  Sparkles,
  Trophy,
  Flame,
  CheckCircle2,
  Clock,
  ArrowRight,
  Shield,
  WifiOff,
} from 'lucide-react';

interface HomeViewProps {
  onEnterRoom: (roomId: string, room?: GameRoom) => void;
  onNavigateToShop: () => void;
  onNavigateToLeaderboard: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onEnterRoom,
  onNavigateToShop,
  onNavigateToLeaderboard,
}) => {
  const { userProfile, claimDailyReward } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showJoinModal, setShowJoinModal] = useState<boolean>(false);
  const [maxPlayers, setMaxPlayers] = useState<number>(4);
  const [exactFinishRule, setExactFinishRule] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<RoomJoinErrorCode | null>(null);
  const [dailyMsg, setDailyMsg] = useState<string | null>(null);
  const submitLockRef = useRef<boolean>(false);

  const categories = [
    { id: 'all', label: 'အားလုံး' },
    { id: 'board', label: 'ဘုတ်ဂိမ်းများ (Board)' },
    { id: 'puzzle', label: 'ပဟေဠိ (Puzzle)' },
    { id: 'brain', label: 'ဉာဏ်စမ်း (Brain)' },
    { id: 'arcade', label: 'အာကိတ် (Arcade)' },
    { id: 'racing', label: 'အပြေးပြိုင်ပွဲ (Racing)' },
    { id: 'casual', label: 'ပေါ့ပေါ့ပါးပါး (Casual)' },
  ];

  const miniGames: MiniGameCard[] = [
    {
      id: 'snakes_and_ladders',
      title: 'မြွေနှင့်လှေကား (Snakes & Ladders)',
      category: 'board',
      description:
        'ငယ်ဘဝအမှတ်တရ မြွေနှင့်လှေကားဂိမ်းကို သူငယ်ချင်းများနှင့်အတူ အွန်လိုင်းမှ အံစာတုံးခေါက်ပြီး ယှဉ်ပြိုင်ကစားပါ။',
      icon: '🐍',
      minPlayers: 2,
      maxPlayers: 4,
      badge: 'available',
      difficulty: 'easy',
    },
    {
      id: 'ludo_king',
      title: 'ရွှေလုဒို (Shwe Ludo)',
      category: 'board',
      description: 'ကစားသမား ၄ ဦး ယှဉ်ပြိုင်နိုင်မည့် ရိုးရာ လုဒိုဘုတ်ဂိမ်း မကြာမီလာမည်။',
      icon: '🎲',
      minPlayers: 2,
      maxPlayers: 4,
      badge: 'coming_soon',
      difficulty: 'medium',
    },
    {
      id: 'burmese_chess',
      title: 'မြန်မာ့စစ်တုရင် (Myanmar Chess)',
      category: 'brain',
      description: 'ရှေးရိုးစဉ်လာ ဗျူဟာမြောက် မြန်မာ့စစ်တုရင် ယှဉ်ပြိုင်ပွဲ။',
      icon: '♟️',
      minPlayers: 2,
      maxPlayers: 2,
      badge: 'coming_soon',
      difficulty: 'hard',
    },
    {
      id: 'word_puzzle',
      title: 'မြန်မာစကားထာ ပဟေဠိ (Word Puzzle)',
      category: 'puzzle',
      description: 'စကားလုံးဆက် ဉာဏ်စမ်း ပဟေဠိများနှင့် အမှတ်ရှာဖွေမှု။',
      icon: '🧩',
      minPlayers: 1,
      maxPlayers: 4,
      badge: 'coming_soon',
      difficulty: 'medium',
    },
    {
      id: 'space_arcade',
      title: 'အာကာသစစ်သည် (Space Arcade)',
      category: 'arcade',
      description: 'လျင်မြန်သော တုံ့ပြန်မှုနှင့် ဂိုးသွင်းရယူမည့် မီနီ အာကိတ်ဂိမ်း။',
      icon: '🚀',
      minPlayers: 1,
      maxPlayers: 2,
      badge: 'coming_soon',
      difficulty: 'medium',
    },
    {
      id: 'kart_racing',
      title: 'မီနီ ကားပြိုင်ပွဲ (Mini Kart Racer)',
      category: 'racing',
      description: 'သူငယ်ချင်းများနှင့် အပြေးပြိုင်မည့် ရွှင်လန်းဖွယ် ကားပြိုင်ပွဲ။',
      icon: '🏎️',
      minPlayers: 2,
      maxPlayers: 4,
      badge: 'coming_soon',
      difficulty: 'easy',
    },
  ];

  const filteredGames =
    selectedCategory === 'all'
      ? miniGames
      : miniGames.filter((g) => g.category === selectedCategory);

  const handleCreateRoom = async () => {
    if (!userProfile || submitLockRef.current || isSubmitting) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    setErrorMsg(null);
    setErrorCode(null);
    sounds.playClick();
    try {
      const result = await createGameRoom(userProfile, maxPlayers, exactFinishRule);
      setShowCreateModal(false);
      setIsSubmitting(false);
      submitLockRef.current = false;
      onEnterRoom(result.roomId, result.room);
    } catch (err: any) {
      setErrorCode(err instanceof RoomJoinError ? err.code : 'UNKNOWN_ERROR');
      setErrorMsg(err?.message || 'အခန်းဖန်တီးခြင်း မအောင်မြင်ပါ');
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !joinCodeInput.trim() || submitLockRef.current || isSubmitting) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    setErrorMsg(null);
    setErrorCode(null);
    sounds.playClick();
    try {
      const result = await joinGameRoomByCode(joinCodeInput.trim(), userProfile);
      setShowJoinModal(false);
      setIsSubmitting(false);
      submitLockRef.current = false;
      onEnterRoom(result.roomId, result.room);
    } catch (err: any) {
      setErrorCode(err instanceof RoomJoinError ? err.code : 'UNKNOWN_ERROR');
      setErrorMsg(err?.message || 'အခန်းသို့ ဝင်ရောက်ခြင်း မအောင်မြင်ပါ');
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  };

  const handleDailyReward = async () => {
    sounds.playClick();
    const res = await claimDailyReward();
    setDailyMsg(res.message);
    setTimeout(() => setDailyMsg(null), 4000);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-8">
      {/* Hero Banner */}
      <div className="relative rounded-3xl overflow-hidden bg-gradient-to-r from-amber-600 via-amber-500 to-yellow-500 p-6 md:p-10 shadow-2xl text-slate-950">
        <div className="relative z-10 max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-950/20 text-slate-950 font-bold text-xs backdrop-blur-xs">
            <Sparkles className="w-3.5 h-3.5 fill-current" />
            <span>Child Vibes - မြန်မာ့ အွန်လိုင်း မီနီဂိမ်း ပလက်ဖောင်း</span>
          </div>

          <h1 className="text-3xl md:text-5xl font-black leading-tight tracking-tight">
            သူငယ်ချင်းများနှင့် အတူတူ အွန်လိုင်းမှ ဆော့ကစားကြမယ်!
          </h1>

          <p className="text-slate-900 text-sm md:text-base font-semibold leading-relaxed">
            အခန်းဖန်တီးပြီး Room Code သို့မဟုတ် Link မျှဝေကာ သူငယ်ချင်းများကို ဖိတ်ခေါ်ပါ။
            မြွေနှင့်လှေကားဂိမ်းကို အတူဆော့ကစားပြီး ရွှေဒင်္ဂါးဆုများနှင့် Level အဆင့်များ ရယူလိုက်ပါ။
          </p>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={() => {
                sounds.playClick();
                setErrorMsg(null);
                setErrorCode(null);
                setShowCreateModal(true);
              }}
              className="px-6 py-3.5 rounded-2xl bg-slate-950 hover:bg-slate-900 text-amber-400 font-black text-sm md:text-base flex items-center gap-2 shadow-xl hover:scale-105 active:scale-95 transition cursor-pointer"
            >
              <PlusCircle className="w-5 h-5" />
              <span>အခန်းအသစ် ဖွင့်မည်</span>
            </button>

            <button
              onClick={() => {
                sounds.playClick();
                setErrorMsg(null);
                setErrorCode(null);
                setShowJoinModal(true);
              }}
              className="px-6 py-3.5 rounded-2xl bg-white/90 hover:bg-white text-slate-950 font-bold text-sm md:text-base flex items-center gap-2 shadow-lg hover:scale-105 active:scale-95 transition cursor-pointer"
            >
              <LogIn className="w-5 h-5" />
              <span>အခန်းကုဒ်ဖြင့် ဝင်မည်</span>
            </button>

            <button
              onClick={handleDailyReward}
              className="px-4 py-3.5 rounded-2xl bg-amber-400/80 hover:bg-amber-300 text-slate-950 font-bold text-xs md:text-sm flex items-center gap-1.5 border border-slate-950/20 shadow transition cursor-pointer"
              title="နေ့စဉ်ဆုလက်ဆောင်"
            >
              <Gift className="w-4 h-4" />
              <span>နေ့စဉ်ဆု</span>
            </button>
          </div>

          {dailyMsg && (
            <div className="bg-slate-950/80 text-amber-300 px-4 py-2 rounded-xl text-xs font-bold inline-block animate-in fade-in">
              {dailyMsg}
            </div>
          )}
        </div>

        {/* Decorative Graphic Icons */}
        <div className="absolute right-4 bottom-2 text-8xl md:text-9xl opacity-20 select-none pointer-events-none">
          🎲
        </div>
        <div className="absolute right-28 top-6 text-7xl md:text-8xl opacity-15 select-none pointer-events-none">
          🐍
        </div>
      </div>

      {/* Highlights / Quick Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 flex items-center gap-3 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            <Trophy className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] text-slate-500">သင်၏ အနိုင်ပွဲ</div>
            <div className="text-lg font-black text-slate-800">{userProfile?.totalWins || 0} ပွဲ</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 flex items-center gap-3 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] text-slate-500">သင်၏ Level</div>
            <div className="text-lg font-black text-slate-800">Level {userProfile?.level || 1}</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 flex items-center gap-3 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] text-slate-500">ရွှေဒင်္ဂါး လက်ကျန်</div>
            <div className="text-lg font-black text-amber-700 font-mono">
              {userProfile?.points.toLocaleString() || 0}
            </div>
          </div>
        </div>

        <button
          onClick={onNavigateToLeaderboard}
          className="bg-white hover:bg-slate-50/80 border border-slate-200/80 hover:border-amber-300 rounded-2xl p-4 flex items-center justify-between text-left shadow-xs transition cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[11px] text-slate-500">ဦးဆောင်သူများ</div>
              <div className="text-xs font-bold text-slate-800">Ranking ကြည့်မည်</div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* Game Categories & Cards Section */}
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl md:text-2xl font-black text-slate-900 flex items-center gap-2">
              <Gamepad2 className="w-6 h-6 text-amber-600" />
              <span>မီနီဂိမ်း အမျိုးအစားများ (Mini Games)</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              သင်ကစားလိုသော မီနီဂိမ်းကို ရွေးချယ်ပြီး အခန်းဖွင့် ကစားနိုင်ပါသည်
            </p>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                sounds.playClick();
                setSelectedCategory(cat.id);
              }}
              className={`px-4 py-2 rounded-xl text-xs md:text-sm font-bold whitespace-nowrap transition cursor-pointer ${
                selectedCategory === cat.id
                  ? 'bg-amber-400 text-slate-950 shadow-xs'
                  : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200/80'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Games Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredGames.map((game) => (
            <div
              key={game.id}
              className={`bg-white border rounded-3xl p-6 flex flex-col justify-between transition-all duration-300 shadow-xs relative overflow-hidden group ${
                game.badge === 'available'
                  ? 'border-slate-200/90 hover:border-amber-400 hover:shadow-md'
                  : 'border-slate-200/70 opacity-80'
              }`}
            >
              <div>
                {/* Header Row */}
                <div className="flex items-start justify-between mb-4">
                  <div className="w-16 h-16 rounded-2xl bg-amber-50/70 border border-amber-200/60 flex items-center justify-center text-3xl shadow-inner group-hover:scale-105 transition-transform">
                    {game.icon}
                  </div>

                  {game.badge === 'available' ? (
                    <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>ကစားနိုင်သည်</span>
                    </span>
                  ) : (
                    <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200 text-[11px] font-semibold flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>မကြာမီလာမည်</span>
                    </span>
                  )}
                </div>

                {/* Title & Description */}
                <h3 className="text-lg font-black text-slate-900 mb-2">{game.title}</h3>
                <p className="text-xs text-slate-600 leading-relaxed mb-4 min-h-[48px]">
                  {game.description}
                </p>

                {/* Details */}
                <div className="flex items-center gap-3 text-xs text-slate-500 mb-6">
                  <span className="flex items-center gap-1 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200/80">
                    <Users className="w-3.5 h-3.5 text-amber-600" />
                    <span>{game.minPlayers} - {game.maxPlayers} ဦး</span>
                  </span>
                  <span className="bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200/80 text-slate-600 capitalize">
                    {game.difficulty === 'easy' ? 'အလွယ်' : game.difficulty === 'medium' ? 'အသင့်အတင့်' : 'ခက်'}
                  </span>
                </div>
              </div>

              {/* Action Button */}
              {game.badge === 'available' ? (
                <button
                  onClick={() => {
                    sounds.playClick();
                    setShowCreateModal(true);
                  }}
                  className="w-full py-3.5 rounded-2xl bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-xs hover:scale-[1.01] active:scale-95 transition cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>အခန်းဖွင့် ကစားမည်</span>
                </button>
              ) : (
                <button
                  disabled
                  className="w-full py-3.5 rounded-2xl bg-slate-100 text-slate-400 font-bold text-xs flex items-center justify-center gap-1.5 cursor-not-allowed border border-slate-200"
                >
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>မကြာမီ ထည့်သွင်းပေးပါမည်</span>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* CREATE ROOM MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl relative text-slate-800">
            <h3 className="text-xl font-black text-slate-900 mb-2">အခန်းအသစ် ဖန်တီးမည်</h3>
            <p className="text-xs text-slate-500 mb-6">
              အခန်းဖွင့်ပြီးပါက Room Code ဖြင့် သူငယ်ချင်းများကို ဖိတ်ခေါ်နိုင်ပါသည်
            </p>

            {errorMsg && (
              <div
                className={`mb-4 p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                  errorCode === 'NETWORK_ERROR'
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : 'bg-rose-50 border-rose-300 text-rose-800'
                }`}
              >
                {errorCode === 'NETWORK_ERROR' && <WifiOff className="w-4 h-4 shrink-0" />}
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="space-y-4">
              {/* Game Info */}
              <div className="bg-amber-50/70 p-3.5 rounded-2xl border border-amber-200/80 flex items-center gap-3">
                <span className="text-2xl">🐍</span>
                <div>
                  <div className="font-bold text-slate-900 text-sm">မြွေနှင့်လှေကားဂိမ်း</div>
                  <div className="text-[11px] text-slate-600">10x10 Grid (၁ မှ ၁၀၀ အကွက်)</div>
                </div>
              </div>

              {/* Max Players Choice */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  ကစားသမား အရေအတွက် ရွေးချယ်ပါ
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[2, 3, 4].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setMaxPlayers(count)}
                      className={`py-2.5 rounded-xl text-xs font-black transition cursor-pointer ${
                        maxPlayers === count
                          ? 'bg-amber-400 text-slate-950 shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 border border-slate-200'
                      }`}
                    >
                      {count} ဦး
                    </button>
                  ))}
                </div>
              </div>

              {/* Exact Finish Rule Toggle */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                <div>
                  <div className="text-xs font-bold text-slate-900">အတိအကျ ဝင်ရန် လို/မလို စည်းမျဉ်း</div>
                  <div className="text-[11px] text-slate-500">၁၀၀ သို့ရောက်ရန် အံစာတုံးနံပါတ် အတိအကျလိုအပ်သည်</div>
                </div>
                <input
                  type="checkbox"
                  checked={exactFinishRule}
                  onChange={(e) => setExactFinishRule(e.target.checked)}
                  className="w-5 h-5 accent-amber-500 rounded cursor-pointer"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
                >
                  ပယ်ဖျက်
                </button>
                <button
                  type="button"
                  onClick={handleCreateRoom}
                  disabled={isSubmitting}
                  className="flex-1 py-3 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-xs transition shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'ဖန်တီးနေသည်...' : 'အခန်းဖွင့်မည်'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* JOIN ROOM MODAL */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl relative text-slate-800">
            <h3 className="text-xl font-black text-slate-900 mb-2">အခန်းကုဒ်ဖြင့် ဝင်ရောက်မည်</h3>
            <p className="text-xs text-slate-500 mb-4">
              သူငယ်ချင်းထံမှ ရရှိထားသော ၆ လုံးပါ Room Code (ဥပမာ: SG8K29) ကို ထည့်သွင်းပါ
            </p>

            {errorMsg && (
              <div
                className={`mb-4 p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                  errorCode === 'NETWORK_ERROR'
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : 'bg-rose-50 border-rose-300 text-rose-800'
                }`}
              >
                {errorCode === 'NETWORK_ERROR' && <WifiOff className="w-4 h-4 shrink-0" />}
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleJoinRoom} className="space-y-4">
              <input
                type="text"
                placeholder="အခန်းကုဒ် ရိုက်ထည့်ပါ..."
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                maxLength={8}
                className="w-full bg-slate-50 text-slate-900 font-mono font-bold text-center text-xl tracking-widest px-4 py-3 rounded-2xl border border-slate-300 focus:border-amber-500 focus:outline-hidden"
                autoFocus
              />

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
                >
                  ပယ်ဖျက်
                </button>
                <button
                  type="submit"
                  disabled={!joinCodeInput.trim() || isSubmitting}
                  className="flex-1 py-3 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-xs transition shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'ချိတ်ဆက်နေသည်...' : 'အခန်းသို့ ဝင်မည်'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
