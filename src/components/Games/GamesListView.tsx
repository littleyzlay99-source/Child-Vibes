import React, { useState } from 'react';
import {
  DEFAULT_GAME_ID,
  GameCategory,
  RegisteredGameId,
  getAllGames,
} from '../../games/registry';
import { GameRoom } from '../../types';
import { sounds } from '../../lib/sound';
import { CreateRoomModal } from '../Multiplayer/CreateRoomModal';
import {
  Gamepad2,
  Users,
  Play,
  PlusCircle,
  Clock,
  CheckCircle2,
} from 'lucide-react';

interface GamesListViewProps {
  onEnterRoom: (roomId: string, room?: GameRoom) => void;
}

export const GamesListView: React.FC<GamesListViewProps> = ({ onEnterRoom }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [createModalGameId, setCreateModalGameId] = useState<RegisteredGameId>(DEFAULT_GAME_ID);

  const categories: { id: 'all' | GameCategory; label: string }[] = [
    { id: 'all', label: 'ဂိမ်းအားလုံး' },
    { id: 'board', label: 'ဘုတ်ဂိမ်း (Board)' },
    { id: 'puzzle', label: 'ပဟေဠိ (Puzzle)' },
    { id: 'brain', label: 'ဉာဏ်စမ်း (Brain)' },
    { id: 'arcade', label: 'အာကိတ် (Arcade)' },
    { id: 'racing', label: 'အပြေးပြိုင်ပွဲ (Racing)' },
    { id: 'casual', label: 'ပေါ့ပေါ့ပါးပါး (Casual)' },
  ];

  const games = getAllGames();

  const filtered =
    selectedCategory === 'all'
      ? games
      : games.filter((g) => g.category === selectedCategory);

  const openCreateRoomForGame = (gameId: RegisteredGameId = DEFAULT_GAME_ID) => {
    sounds.playClick();
    setCreateModalGameId(gameId);
    setShowCreateModal(true);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="bg-white/95 border border-slate-200/90 rounded-3xl p-6 md:p-8 shadow-sm backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
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
            အမျိုးအစားအလိုက် မီနီဂိမ်းများကို ရွေးချယ်ကစားနိုင်ပါသည်။ လက်ရှိတွင် မြွေနှင့်လှေကားနှင့်
            နှင်းတောင်ဆင်းပြိုင်ပွဲ (Snow Rush: Avalanche Escape) တို့ကို ကစားနိုင်ပြီး အခြားဂိမ်းများကို
            ဆက်တိုက်ထည့်သွင်းပေးသွားမည် ဖြစ်ပါသည်။
          </p>
        </div>

        <button
          type="button"
          onClick={() => openCreateRoomForGame(DEFAULT_GAME_ID)}
          className="min-h-[44px] px-5 py-3 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs md:text-sm flex items-center justify-center gap-2 shadow-sm transition cursor-pointer whitespace-nowrap shrink-0"
        >
          <PlusCircle className="w-4 h-4" />
          <span>အခန်းအသစ် ဖွင့်မည်</span>
        </button>
      </div>

      {/* Category Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
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
              game.status === 'available'
                ? 'border-slate-200 hover:border-amber-300 hover:shadow-md'
                : 'border-slate-200/70 opacity-80'
            }`}
          >
            <div>
              <div className="flex items-start justify-between mb-4">
                <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-3xl shadow-inner">
                  {game.icon}
                </div>

                {game.status === 'available' ? (
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

              <h3 className="text-lg font-black text-slate-900 mb-2">{game.title}</h3>
              <p className="text-xs text-slate-500 leading-relaxed mb-4 min-h-[48px]">
                {game.description}
              </p>

              <div className="flex items-center gap-3 text-xs text-slate-500 mb-3">
                <span className="flex items-center gap-1 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
                  <Users className="w-3.5 h-3.5 text-amber-600" />
                  <span>{game.minPlayers} - {game.maxPlayers} ဦး</span>
                </span>
                <span className="bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600">
                  {game.difficulty === 'easy' ? 'အလွယ်' : game.difficulty === 'medium' ? 'အသင့်အတင့်' : 'ခက်'}
                </span>
              </div>

              {game.id === 'snow_rush' ? (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-sky-800 mb-5">
                  <span className="font-mono tabular-nums">1.50 KM</span>
                  <span aria-hidden="true">·</span>
                  <span>Real-time Multiplayer</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-500">XP / Points ဆုကြေး မပါဝင်သေးပါ</span>
                </div>
              ) : (
                <div className="mb-3" />
              )}
            </div>

            {game.status === 'available' ? (
              <button
                type="button"
                onClick={() => openCreateRoomForGame(game.id)}
                className="w-full py-3.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>အခန်းဖွင့် ကစားမည်</span>
              </button>
            ) : (
              <button
                type="button"
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

      {/* Shared Multi-Game Create Room Modal */}
      <CreateRoomModal
        isOpen={showCreateModal}
        initialGameId={createModalGameId}
        onClose={() => setShowCreateModal(false)}
        onRoomCreated={(roomId, room) => onEnterRoom(roomId, room)}
      />
    </div>
  );
};
