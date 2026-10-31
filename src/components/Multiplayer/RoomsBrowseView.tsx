import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  DEFAULT_GAME_ID,
  RegisteredGameId,
  getAvailableGames,
  getGameById,
  getGameTitle,
} from '../../games/registry';
import { GameRoom } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import {
  joinGameRoomByCode,
  deduplicateRoomPlayers,
  normalizeMaxPlayers,
  RoomJoinError,
  RoomJoinErrorCode,
} from '../../services/roomService';
import { sounds } from '../../lib/sound';
import { CreateRoomModal } from './CreateRoomModal';
import {
  Users,
  PlusCircle,
  LogIn,
  Play,
  ShieldAlert,
  WifiOff,
  CheckCircle2,
} from 'lucide-react';

interface RoomsBrowseViewProps {
  onEnterRoom: (roomId: string, room?: GameRoom) => void;
}

export type RoomGameFilterValue = 'all' | RegisteredGameId;

/**
 * Normalize a room's gameType for filter matching while preserving backward compatibility
 * for legacy room documents that omitted gameType.
 */
export function normalizeRoomGameType(gameType?: string | null): string {
  const trimmed = typeof gameType === 'string' ? gameType.trim() : '';
  return trimmed || DEFAULT_GAME_ID;
}

/**
 * Pure client-side room filter by gameType (zero extra Firestore reads/listeners).
 */
export function filterRoomsByGameType(
  rooms: GameRoom[],
  selectedFilter: RoomGameFilterValue
): GameRoom[] {
  if (selectedFilter === 'all') {
    return rooms;
  }
  return rooms.filter((room) => normalizeRoomGameType(room.gameType) === selectedFilter);
}

export const RoomsBrowseView: React.FC<RoomsBrowseViewProps> = ({ onEnterRoom }) => {
  const { currentUser, userProfile } = useAuth();
  const [rooms, setRooms] = useState<GameRoom[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedGameFilter, setSelectedGameFilter] = useState<RoomGameFilterValue>('all');
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [joiningRoomCode, setJoiningRoomCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<RoomJoinErrorCode | null>(null);

  const actionLockRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    const roomsCol = collection(db, 'rooms');
    // Subscribe once to both 'waiting' and 'full' lobby rooms so real-time capacity & Full status stay synced
    const q = query(roomsCol, where('status', 'in', ['waiting', 'full']));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!isMountedRef.current) return;
        const list: GameRoom[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as GameRoom;
          const effectiveGameId = normalizeRoomGameType(data.gameType);
          if (getGameById(effectiveGameId)?.status !== 'available') {
            return;
          }
          const uniquePlayers = deduplicateRoomPlayers(data.players, data.playerPositions);
          const normalizedMax = normalizeMaxPlayers(data.maxPlayers);
          list.push({
            ...data,
            id: data.id || docSnap.id,
            maxPlayers: normalizedMax,
            playerCount: uniquePlayers.length,
            players: uniquePlayers,
          });
        });
        // Sort newest first
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setRooms(list);
        setLoading(false);
      },
      (error) => {
        console.error('Browse rooms listener error:', error);
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    );

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, []);

  const availableGames = useMemo(() => getAvailableGames(), []);

  const filterTabs = useMemo(() => {
    const countsByGame: Record<string, number> = {};
    for (const room of rooms) {
      const normalized = normalizeRoomGameType(room.gameType);
      countsByGame[normalized] = (countsByGame[normalized] || 0) + 1;
    }

    return [
      {
        id: 'all' as RoomGameFilterValue,
        label: 'ဂိမ်းအားလုံး',
        icon: '🎮',
        count: rooms.length,
      },
      ...availableGames.map((game) => ({
        id: game.id as RoomGameFilterValue,
        label: game.shortTitle,
        icon: game.icon,
        count: countsByGame[game.id] || 0,
      })),
    ];
  }, [availableGames, rooms]);

  const filteredRooms = useMemo(
    () => filterRoomsByGameType(rooms, selectedGameFilter),
    [rooms, selectedGameFilter]
  );

  const handleJoinDirect = async (roomCode: string) => {
    const cleaned = roomCode.replace(/^#/, '').trim().toUpperCase();
    if (!userProfile || !cleaned || actionLockRef.current || joiningRoomCode !== null) return;

    actionLockRef.current = true;
    setJoiningRoomCode(cleaned);
    setErrorMsg(null);
    setErrorCode(null);
    sounds.playClick();

    try {
      const result = await joinGameRoomByCode(cleaned, userProfile);
      actionLockRef.current = false;
      // Navigate immediately on authoritative backend transaction success; never show an error on success
      onEnterRoom(result.roomId, result.room);
    } catch (err: any) {
      if (isMountedRef.current) {
        const code: RoomJoinErrorCode =
          err instanceof RoomJoinError ? err.code : 'UNKNOWN_ERROR';
        setErrorCode(code);
        setErrorMsg(err?.message || 'အခန်းသို့ ဝင်ရောက်ခြင်း မအောင်မြင်ပါ');
        setJoiningRoomCode(null);
      }
      actionLockRef.current = false;
    }
  };

  const handleJoinByInput = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !joinCodeInput.trim() || actionLockRef.current) return;
    await handleJoinDirect(joinCodeInput.trim());
  };

  const currentUid = currentUser?.uid || userProfile?.id;
  const isBusy = joiningRoomCode !== null;
  const preferredCreateGameId: RegisteredGameId =
    selectedGameFilter === 'all' ? DEFAULT_GAME_ID : selectedGameFilter;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-5">
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
              disabled={isBusy}
              className="w-full min-h-[42px] bg-slate-50 text-amber-800 font-mono text-xs font-bold pl-3 pr-8 py-2.5 rounded-xl border border-slate-300 focus:border-amber-400 focus:bg-white focus:outline-hidden disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isBusy || !joinCodeInput.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-amber-600 disabled:opacity-40 cursor-pointer"
              title="ကုဒ်ဖြင့် ဝင်မည်"
            >
              <LogIn className="w-4 h-4" />
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              if (isBusy) return;
              sounds.playClick();
              setErrorMsg(null);
              setErrorCode(null);
              setShowCreateModal(true);
            }}
            disabled={isBusy}
            className="min-h-[42px] px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs md:text-sm flex items-center gap-1.5 shadow-sm transition cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <PlusCircle className="w-4 h-4" />
            <span>အခန်းအသစ်ဖွင့်မည်</span>
          </button>
        </div>
      </div>

      {/* Client-Side Game Filter Bar (Sourced from Central Game Registry) */}
      <div
        className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none"
        role="tablist"
        aria-label="ဂိမ်းအလိုက် အခန်းစစ်ထုတ်ရန်"
      >
        {filterTabs.map((tab) => {
          const isActive = selectedGameFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                sounds.playClick();
                setSelectedGameFilter(tab.id);
              }}
              className={`min-h-[42px] px-4 py-2 rounded-xl text-xs md:text-sm font-bold flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
                isActive
                  ? 'bg-amber-400 text-slate-950 shadow-xs'
                  : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200/90'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {!loading && (
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[11px] font-black tabular-nums ${
                    isActive
                      ? 'bg-slate-950/15 text-slate-950'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Distinct Error Banner (Network Error vs Room Full / Validation Error) */}
      {errorMsg && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 animate-in fade-in ${
            errorCode === 'NETWORK_ERROR'
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          <div className="flex items-center gap-2">
            {errorCode === 'NETWORK_ERROR' ? (
              <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setErrorCode(null);
            }}
            className="px-2 py-0.5 rounded-lg bg-white/70 hover:bg-white text-[11px] font-semibold cursor-pointer"
          >
            ပိတ်မည်
          </button>
        </div>
      )}

      {/* Rooms List */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-500 text-xs">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mb-3" />
          <span>အခန်းများ ရှာဖွေနေပါသည်...</span>
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="bg-white border border-slate-200/90 rounded-3xl p-10 sm:p-12 text-center space-y-3 shadow-xs">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-3xl mx-auto">
            {selectedGameFilter === 'all'
              ? '🚪'
              : getGameById(selectedGameFilter)?.icon || '🎮'}
          </div>
          <h3 className="text-base font-bold text-slate-900">
            {selectedGameFilter === 'all'
              ? 'လက်ရှိတွင် ဖွင့်ထားသော အခန်း မရှိသေးပါ'
              : `${getGameTitle(selectedGameFilter)} ဂိမ်းအတွက် ဖွင့်ထားသော အခန်း မရှိသေးပါ`}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {selectedGameFilter !== 'all' && rooms.length > 0
              ? 'အခြားဂိမ်းအခန်းများကို ကြည့်ရှုနိုင်သလို ဤဂိမ်းအတွက် ကိုယ်တိုင် အခန်းအသစ် ဖန်တီးနိုင်ပါသည်။'
              : 'သင်ကိုယ်တိုင် အခန်းအသစ်ဖန်တီးပြီး ရရှိလာသော Room Code သို့မဟုတ် Link ဖြင့် သူငယ်ချင်းများကို ဖိတ်ခေါ်ကစားနိုင်ပါသည်။'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
            {selectedGameFilter !== 'all' && rooms.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  setSelectedGameFilter('all');
                }}
                className="min-h-[42px] px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                <span>ဂိမ်းအားလုံး ကြည့်မည်</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                sounds.playClick();
                setShowCreateModal(true);
              }}
              disabled={isBusy}
              className="min-h-[42px] px-6 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs inline-flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-60"
            >
              <PlusCircle className="w-4 h-4" />
              <span>အခန်းအသစ် ဖန်တီးမည်</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRooms.map((room) => {
            const uniquePlayers = deduplicateRoomPlayers(room.players, room.playerPositions);
            const maxCap = normalizeMaxPlayers(room.maxPlayers);
            const activeCount = uniquePlayers.length;
            const isAlreadyJoined =
              !!currentUid && uniquePlayers.some((p) => p.uid === currentUid);
            const isCapacityFull = activeCount >= maxCap;
            const isBlockedByFull = !isAlreadyJoined && isCapacityFull;
            const isJoiningThisRoom = joiningRoomCode === room.roomCode;

            const effectiveGameType = normalizeRoomGameType(room.gameType);
            const roomGameEntry = getGameById(effectiveGameType);
            const roomGameTitle = getGameTitle(room.gameType);
            const roomGameIcon = roomGameEntry?.icon || '🎮';

            return (
              <div
                key={room.id}
                className="bg-white border border-slate-200/90 hover:border-amber-300 rounded-3xl p-5 flex flex-col justify-between shadow-xs hover:shadow-md transition-all"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="font-mono font-black text-amber-700 text-sm tracking-wider">
                      #{room.roomCode}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {isAlreadyJoined ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>ဝင်ထားပြီး</span>
                        </span>
                      ) : isCapacityFull ? (
                        <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 text-[10px] font-bold border border-rose-200">
                          Full
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
                          Waiting
                        </span>
                      )}
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold border border-slate-200 tabular-nums">
                        {activeCount} / {maxCap} ဦး
                      </span>
                    </div>
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

                  <div className="text-[11px] text-slate-600 mb-4 bg-slate-50 p-2.5 rounded-xl border border-slate-200 space-y-0.5">
                    <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <span>{roomGameIcon}</span>
                      <span className="truncate">ဂိမ်း: {roomGameTitle}</span>
                    </div>
                    {effectiveGameType === 'snakes_and_ladders' ? (
                      <div>
                        စည်းမျဉ်း: {room.exactFinish ? 'အတိအကျဝင်ရန်လို' : 'သာမန်စည်းမျဉ်း'}
                      </div>
                    ) : (
                      <div>
                        ကစားသမား: {roomGameEntry ? `${roomGameEntry.minPlayers} - ${roomGameEntry.maxPlayers} ဦး` : `${maxCap} ဦး`}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleJoinDirect(room.roomCode)}
                  disabled={isBlockedByFull || isBusy}
                  className={`w-full min-h-[42px] py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition ${
                    isJoiningThisRoom
                      ? 'bg-amber-300 text-slate-950 cursor-wait'
                      : isAlreadyJoined
                      ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-xs cursor-pointer disabled:opacity-60'
                      : isBlockedByFull
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                      : 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-xs cursor-pointer disabled:opacity-60'
                  }`}
                >
                  {isJoiningThisRoom ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                      <span>အခန်းသို့ ဝင်ရောက်နေသည်...</span>
                    </>
                  ) : isAlreadyJoined ? (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>အခန်းတွင်းသို့ ပြန်ဝင်မည်</span>
                    </>
                  ) : isBlockedByFull ? (
                    <span>အခန်းလူပြည့်နေပါသည်</span>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>အခန်းသို့ ဝင်ရောက်မည်</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Shared Multi-Game Create Room Modal */}
      <CreateRoomModal
        isOpen={showCreateModal}
        initialGameId={preferredCreateGameId}
        onClose={() => setShowCreateModal(false)}
        onRoomCreated={(roomId, room) => onEnterRoom(roomId, room)}
      />
    </div>
  );
};
