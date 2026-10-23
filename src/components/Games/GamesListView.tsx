import React, { useState } from 'react';
import { MiniGameCard } from '../../types';
import { sounds } from '../../lib/sound';
import {
  Gamepad2,
  Users,
  Play,
  Clock,
  CheckCircle2,
  Sparkles,
  Info,
} from 'lucide-react';

interface GamesListViewProps {
  onPlaySnakesAndLadders: () => void;
}

export const GamesListView: React.FC<GamesListViewProps> = ({ onPlaySnakesAndLadders }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const categories = [
    { id: 'all', label: 'ဂိမ်းအားလုံး' },
    { id: 'board', label: 'ဘုတ်ဂိမ်း (Board)' },
    { id: 'puzzle', label: 'ပဟေဠိ (Puzzle)' },
    { id: 'brain', label: 'ဉာဏ်စမ်း (Brain)' },
    { id: 'arcade', label: 'အာကိတ် (Arcade)' },
    { id: 'racing', label: 'အပြေးပြိုင်ပွဲ (Racing)' },
    { id: 'casual', label: 'ပေါ့ပေါ့ပါးပါး (Casual)' },
  ];

  const games: MiniGameCard[] = [
    {
      id: 'snakes_and_ladders',
      title: 'မြွေနှင့်လှေကား (Snakes & Ladders)',
      category: 'board',
      description:
        '၁ မှ ၁၀၀ အထိ အံစာတုံးခေါက်ပြီး လှေကားတက်၊ မြွေရှောင်ကာ နံပါတ် ၁၀၀ သို့ ပထမဆုံးရောက်ရှိအောင် ယှဉ်ပြိုင်ကစားရသော မြန်မာ့အွန်လိုင်း Multiplayer မီနီဂိမ်း။',
      icon: '🐍',
      minPlayers: 2,
      maxPlayers: 4,
      badge: 'available',
      difficulty: 'easy',
    },
    {
      id: 'ludo_king',
      title: 'ကလေးတို့ရဲ့ လုဒို (Child Ludo)',
      category: 'board',
      description:
        'ရိုးရာ လုဒိုဘုတ်ဂိမ်းပေါ်တွင် အံစာတုံးခေါက်ပြီး အိမ်သို့ အရုပ် ၄ ရုပ်လုံး အရင်ဆုံးပို့ဆောင်ရမည့် ပျော်ရွှင်စရာ ဘုတ်ဂိမ်း။',
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
      description:
        'ရှေးမြန်မာဘုရင်များလက်ထက်မှ ဗျူဟာမြောက် စစ်တုရင်ထိုးနည်းများဖြင့် ကစားသမား ၂ ဦး ထိပ်တိုက်ရင်ဆိုင်မည့် စစ်တုရင်ဂိမ်း။',
      icon: '♟️',
      minPlayers: 2,
      maxPlayers: 2,
      badge: 'coming_soon',
      difficulty: 'hard',
    },
    {
      id: 'word_puzzle',
      title: 'မြန်မာစကားထာ ဉာဏ်စမ်း (Myanmar Word Puzzle)',
      category: 'puzzle',
      description:
        'မြန်မာစာစကားလုံးများ၊ စကားထာများနှင့် ကဗျာဉာဏ်စမ်းများကို အချိန်မီ ဖြေဆိုပြီး အမှတ်ရယူမည့် ပဟေဠိဂိမ်း။',
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
      description:
        'အာကာသယာဉ်ငယ်ကို ထိန်းကျောင်းကာ ဂြိုဟ်သိမ်ဂြိုဟ်မွှားများကို ရှောင်ရှားပြီး ရွှေဒင်္ဂါးများ စုဆောင်းမည့် အာကိတ်ဂိမ်း။',
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
      description:
        'အကွေ့အကောက်များသော လမ်းကြောင်းများပေါ်တွင် ကားမောင်းပြိုင်ပြီး ပထမဆုရယူမည့် မီနီကားပြိုင်ဂိမ်း။',
      icon: '🏎️',
      minPlayers: 2,
      maxPlayers: 4,
      badge: 'coming_soon',
      difficulty: 'easy',
    },
    {
      id: 'bubble_shooter',
      title: 'ရောင်စုံပူဖောင်းပစ် (Bubble Pop)',
      category: 'casual',
      description:
        'အရောင်တူ ပူဖောင်း ၃ လုံးနှင့်အထက် ပစ်ပေါက်ပြီး စိတ်အပန်းဖြေနိုင်မည့် ပေါ့ပေါ့ပါးပါး ဂိမ်းငယ်။',
      icon: '🫧',
      minPlayers: 1,
      maxPlayers: 2,
      badge: 'coming_soon',
      difficulty: 'easy',
    },
  ];

  const filtered =
    selectedCategory === 'all'
      ? games
      : games.filter((g) => g.category === selectedCategory);

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="bg-white/95 border border-slate-200/90 rounded-3xl p-6 md:p-8 shadow-sm backdrop-blur-md">
        <div className="flex items-center gap-2 mb-2">
          <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-xs font-bold flex items-center gap-1.5 shadow-2xs">
            <Gamepad2 className="w-3.5 h-3.5" />
            <span>ဂိမ်းစာရင်းများ</span>
          </span>
        </div>
        <h1 className="text-2xl md:text-3xl font-black text-slate-900">
          Child Vibes မီနီဂိမ်း စုစည်းမှု
        </h1>
        <p className="text-xs md:text-sm text-slate-600 mt-1 max-w-xl">
          အမျိုးအစားအလိုက် မီနီဂိမ်းများကို ရွေးချယ်ကစားနိုင်ပါသည်။ လက်ရှိတွင် မြွေနှင့်လှေကားဂိမ်းကို အပြည့်အဝ
          ကစားနိုင်ပြီး အခြားဂိမ်းများကို မကြာမီ ဆက်တိုက်ထည့်သွင်းပေးသွားမည် ဖြစ်ပါသည်။
        </p>
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
            className={`px-4 py-2 rounded-xl text-xs md:text-sm font-bold whitespace-nowrap transition cursor-pointer shadow-2xs ${
              selectedCategory === cat.id
                ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20'
                : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((game) => (
          <div
            key={game.id}
            className={`bg-white border rounded-3xl p-6 flex flex-col justify-between shadow-xs transition-all duration-300 ${
              game.badge === 'available'
                ? 'border-slate-200 hover:border-amber-300 hover:shadow-md'
                : 'border-slate-200/70 opacity-80'
            }`}
          >
            <div>
              <div className="flex items-start justify-between mb-4">
                <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-3xl shadow-inner">
                  {game.icon}
                </div>

                {game.badge === 'available' ? (
                  <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-[11px] font-bold flex items-center gap-1 shadow-2xs">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>ကစားနိုင်သည်</span>
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200 text-[11px] font-semibold flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>မကြာမီလာမည်</span>
                  </span>
                )}
              </div>

              <h3 className="text-lg font-black text-slate-900 mb-2">{game.title}</h3>
              <p className="text-xs text-slate-500 leading-relaxed mb-4 min-h-[48px]">
                {game.description}
              </p>

              <div className="flex items-center gap-3 text-xs text-slate-500 mb-6">
                <span className="flex items-center gap-1 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
                  <Users className="w-3.5 h-3.5 text-amber-600" />
                  <span>{game.minPlayers} - {game.maxPlayers} ဦး</span>
                </span>
                <span className="bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600">
                  {game.difficulty === 'easy' ? 'အလွယ်' : game.difficulty === 'medium' ? 'အသင့်အတင့်' : 'ခက်'}
                </span>
              </div>
            </div>

            {game.badge === 'available' ? (
              <button
                onClick={() => {
                  sounds.playClick();
                  onPlaySnakesAndLadders();
                }}
                className="w-full py-3.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>အခန်းဖွင့် ကစားမည်</span>
              </button>
            ) : (
              <button
                disabled
                className="w-full py-3.5 rounded-2xl bg-slate-100 text-slate-400 font-bold text-xs flex items-center justify-center gap-1.5 cursor-not-allowed border border-slate-200"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>မကြာမီ ထည့်သွင်းပေးပါမည်</span>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
