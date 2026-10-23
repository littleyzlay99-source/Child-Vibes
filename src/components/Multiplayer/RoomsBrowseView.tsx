import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { GameRoom } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { createGameRoom, joinGameRoomByCode } from '../../services/roomService';
import { sounds } from '../../lib/sound';
import {
  Users,
  PlusCircle,
  LogIn,
  Play,
  Sparkles,
  ShieldAlert,
  Crown,
  Search,
} from 'lucide-react';

interface RoomsBrowseViewProps {
  onEnterRoom: (roomId: string) => void;
}

export const RoomsBrowseView: React.FC<RoomsBrowseViewProps> = ({ onEnterRoom }) => {
  const { userProfile } = useAuth();
  const [rooms, setRooms] = useState<GameRoom[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [maxPlayers, setMaxPlayers] = useState<number>(4);
  const [exactFinishRule, setExactFinishRule] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const roomsCol = collection(db, 'rooms');
    const q = query(roomsCol, where('status', '==', 'waiting'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: GameRoom[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as GameRoom);
        });
        // Sort newest first
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setRooms(list);
        setLoading(false);
      },
      (error) => {
        console.error('Browse rooms listener error:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleCreate = async () => {
    if (!userProfile) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    sounds.playClick();
    try {
      const roomId = await createGameRoom(userProfile, maxPlayers, exactFinishRule);
      setShowCreateModal(false);
      onEnterRoom(roomId);
    } catch (err: any) {
      setErrorMsg(err.message || 'အခန်းဖွင့်ခြင်း မအောင်မြင်ပါ');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoinDirect = async (roomCode: string) => {
    if (!userProfile) return;
    sounds.playClick();
    try {
      const roomId = await joinGameRoomByCode(roomCode, userProfile);
      onEnterRoom(roomId);
    } catch (err: any) {
      setErrorMsg(err.message || 'အခန်းသို့ ဝင်ရောက်ခြင်း မအောင်မြင်ပါ');
      setTimeout(() => setErrorMsg(null), 3000);
    }
  };

  const handleJoinByInput = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !joinCodeInput.trim()) return;
    handleJoinDirect(joinCodeInput.trim());
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      {/* Top Controls Bar */}
      <div className="bg-white/95 border border-slate-200/90 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4 backdrop-blur-md">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-amber-500" />
            <span>ဖွင့်လှစ်ထားသော ဂိမ်းအခန်းများ</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            သူငယ်ချင်းဖန်တီးထားသော အခန်းသို့ ဝင်ရောက်ပါ သို့မဟုတ် ကိုယ်တိုင် အခန်းအသစ်ဖွင့်ပါ
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* Quick Join input form */}
          <form onSubmit={handleJoinByInput} className="flex-1 md:w-60 relative">
            <input
              type="text"
              placeholder="အခန်းကုဒ် (Code)..."
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
              maxLength={8}
              className="w-full bg-slate-50 text-amber-800 font-mono text-xs font-bold pl-3 pr-8 py-2.5 rounded-xl border border-slate-300 focus:border-amber-400 focus:bg-white focus:outline-hidden"
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-amber-600"
            >
              <LogIn className="w-4 h-4" />
            </button>
          </form>

          <button
            onClick={() => {
              sounds.playClick();
              setShowCreateModal(true);
            }}
            className="px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs md:text-sm flex items-center gap-1.5 shadow-sm transition cursor-pointer whitespace-nowrap"
          >
            <PlusCircle className="w-4 h-4" />
            <span>အခန်းအသစ်ဖွင့်မည်</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2 animate-in fade-in">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Rooms List */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-500 text-xs">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mb-3" />
          <span>အခန်းများ ရှာဖွေနေပါသည်...</span>
        </div>
      ) : rooms.length === 0 ? (
        <div className="bg-white border border-slate-200/90 rounded-3xl p-12 text-center space-y-3 shadow-xs">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-3xl mx-auto">
            🚪
          </div>
          <h3 className="text-base font-bold text-slate-900">လက်ရှိတွင် ဖွင့်ထားသော အခန်း မရှိသေးပါ</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            သင်ကိုယ်တိုင် အခန်းအသစ်ဖန်တီးပြီး ရရှိလာသော Room Code သို့မဟုတ် Link ဖြင့် သူငယ်ချင်းများကို
            ဖိတ်ခေါ်ကစားနိုင်ပါသည်။
          </p>
          <button
            onClick={() => {
              sounds.playClick();
              setShowCreateModal(true);
            }}
            className="mt-2 px-6 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs inline-flex items-center gap-2 shadow-xs cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>အခန်းအသစ် ဖန်တီးမည်</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map((room) => {
            const isFull = room.players.length >= room.maxPlayers;
            return (
              <div
                key={room.id}
                className="bg-white border border-slate-200/90 hover:border-amber-300 rounded-3xl p-5 flex flex-col justify-between shadow-xs hover:shadow-md transition-all"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono font-black text-amber-700 text-sm tracking-wider">
                      #{room.roomCode}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold border border-slate-200">
                      {room.players.length} / {room.maxPlayers} ဦး
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-xs">
                      👑
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 truncate max-w-[140px]">
                        {room.hostName}
                      </div>
                      <div className="text-[10px] text-slate-500">အခန်းဖန်တီးသူ (Host)</div>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-600 mb-4 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <div>ဂိမ်း: မြွေနှင့်လှေကား (10x10)</div>
                    <div>စည်းမျဉ်း: {room.exactFinish ? 'အတိအကျဝင်ရန်လို' : 'သာမန်စည်းမျဉ်း'}</div>
                  </div>
                </div>

                <button
                  onClick={() => handleJoinDirect(room.roomCode)}
                  disabled={isFull}
                  className={`w-full py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition ${
                    isFull
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                      : 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-xs cursor-pointer'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{isFull ? 'လူပြည့်နေပါသည်' : 'အခန်းသို့ ဝင်ရောက်မည်'}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl relative">
            <h3 className="text-xl font-black text-slate-900 mb-2">အခန်းအသစ် ဖန်တီးမည်</h3>
            <p className="text-xs text-slate-500 mb-6">
              အခန်းဖွင့်ပြီးပါက Room Code ဖြင့် သူငယ်ချင်းများကို ဖိတ်ခေါ်နိုင်ပါသည်
            </p>

            <div className="space-y-4">
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
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      {count} ဦး
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                <div>
                  <div className="text-xs font-bold text-slate-800">အတိအကျ ဝင်ရန် လို/မလို စည်းမျဉ်း</div>
                  <div className="text-[11px] text-slate-500">၁၀၀ သို့ရောက်ရန် အံစာတုံးနံပါတ် အတိအကျလိုအပ်သည်</div>
                </div>
                <input
                  type="checkbox"
                  checked={exactFinishRule}
                  onChange={(e) => setExactFinishRule(e.target.checked)}
                  className="w-5 h-5 accent-amber-500 rounded cursor-pointer"
                />
              </div>

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
                  onClick={handleCreate}
                  disabled={isSubmitting}
                  className="flex-1 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs transition shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'ဖန်တီးနေသည်...' : 'အခန်းဖွင့်မည်'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
