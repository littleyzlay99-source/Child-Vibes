import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  DEFAULT_GAME_ID,
  GameRegistryEntry,
  RegisteredGameId,
  getAllGames,
  getAvailableGames,
  getGameById,
} from '../../games/registry';
import {
  createGameRoom,
  RoomJoinError,
  RoomJoinErrorCode,
} from '../../services/roomService';
import { CreateGameRoomOptions, GameRoom } from '../../types';
import { sounds } from '../../lib/sound';
import {
  CheckCircle2,
  Clock,
  ShieldAlert,
  Users,
  WifiOff,
  X,
} from 'lucide-react';

export interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRoomCreated: (roomId: string, room: GameRoom) => void;
  initialGameId?: RegisteredGameId;
}

/**
 * Resolve a guaranteed selectable ('available') game ID from the Central Game Registry.
 * Falls back to the first available game or DEFAULT_GAME_ID if preferredGameId is unavailable.
 */
export function resolveSelectableGameId(preferredGameId?: string | null): RegisteredGameId {
  const preferred = getGameById(preferredGameId);
  if (preferred && preferred.status === 'available') {
    return preferred.id;
  }
  const firstAvailable = getAvailableGames()[0];
  return firstAvailable ? firstAvailable.id : DEFAULT_GAME_ID;
}

/**
 * Compute allowed multiplayer room player counts for a registered game within [2..4].
 */
export function getAllowedPlayerCountsForGame(game: GameRegistryEntry): number[] {
  const min = Math.max(2, Math.min(4, Math.floor(game.minPlayers)));
  const max = Math.max(min, Math.min(4, Math.floor(game.maxPlayers)));
  const counts: number[] = [];
  for (let count = min; count <= max; count += 1) {
    counts.push(count);
  }
  return counts;
}

/**
 * Clamp a player count selection to the allowed range of the target game.
 */
export function clampPlayerCountForGame(count: number, game: GameRegistryEntry): number {
  const allowed = getAllowedPlayerCountsForGame(game);
  if (allowed.length === 0) return 4;
  const min = allowed[0];
  const max = allowed[allowed.length - 1];
  return Math.max(min, Math.min(max, Math.floor(count)));
}

/**
 * Build typed per-game room options for createGameRoom(hostUser, gameType, gameOptions).
 */
export function buildCreateRoomOptionsForGame(
  gameType: RegisteredGameId,
  params: { maxPlayers: number; exactFinish: boolean }
): CreateGameRoomOptions<RegisteredGameId> {
  if (gameType === 'snakes_and_ladders') {
    return {
      maxPlayers: params.maxPlayers,
      exactFinish: params.exactFinish,
    };
  }
  return {
    maxPlayers: params.maxPlayers,
  };
}

export const CreateRoomModal: React.FC<CreateRoomModalProps> = ({
  isOpen,
  onClose,
  onRoomCreated,
  initialGameId,
}) => {
  const { userProfile } = useAuth();

  const [selectedGameId, setSelectedGameId] = useState<RegisteredGameId>(() =>
    resolveSelectableGameId(initialGameId)
  );
  const [maxPlayers, setMaxPlayers] = useState<number>(4);
  const [exactFinishRule, setExactFinishRule] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<RoomJoinErrorCode | null>(null);

  const submitLockRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Reset modal selection & error state cleanly whenever opened
  useEffect(() => {
    if (!isOpen) return;
    const resolvedId = resolveSelectableGameId(initialGameId);
    const entry = getGameById(resolvedId);
    setSelectedGameId(resolvedId);
    setMaxPlayers(entry ? clampPlayerCountForGame(4, entry) : 4);
    setExactFinishRule(false);
    setErrorMsg(null);
    setErrorCode(null);
  }, [isOpen, initialGameId]);

  // Allow Escape key to close modal when not submitting
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitLockRef.current && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const allGames = getAllGames();
  const availableGames = allGames.filter((g) => g.status === 'available');
  const comingSoonGames = allGames.filter((g) => g.status !== 'available');

  const selectedGame =
    getGameById(selectedGameId) || availableGames[0] || getGameById(DEFAULT_GAME_ID)!;
  const allowedCounts = getAllowedPlayerCountsForGame(selectedGame);

  const handleSelectGame = (game: GameRegistryEntry) => {
    if (game.status !== 'available' || submitLockRef.current || isSubmitting) {
      return;
    }
    sounds.playClick();
    setSelectedGameId(game.id);
    setMaxPlayers((prev) => clampPlayerCountForGame(prev, game));
    setErrorMsg(null);
    setErrorCode(null);
  };

  const handleClose = () => {
    if (submitLockRef.current || isSubmitting) return;
    sounds.playClick();
    onClose();
  };

  const handleSubmit = async () => {
    if (!userProfile || submitLockRef.current || isSubmitting) return;

    const targetGame = getGameById(selectedGameId);
    if (!targetGame || targetGame.status !== 'available') {
      setErrorCode('GAME_UNAVAILABLE');
      setErrorMsg('ရွေးချယ်ထားသော ဂိမ်းကို လက်ရှိတွင် အခန်းဖွင့် ကစား၍ မရနိုင်သေးပါ။');
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setErrorMsg(null);
    setErrorCode(null);
    sounds.playClick();

    try {
      const clampedPlayers = clampPlayerCountForGame(maxPlayers, targetGame);
      const roomOptions = buildCreateRoomOptionsForGame(targetGame.id, {
        maxPlayers: clampedPlayers,
        exactFinish: exactFinishRule,
      });

      const result = await createGameRoom(userProfile, targetGame.id, roomOptions);

      submitLockRef.current = false;
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
      onClose();
      onRoomCreated(result.roomId, result.room);
    } catch (err: any) {
      submitLockRef.current = false;
      if (isMountedRef.current) {
        setErrorCode(err instanceof RoomJoinError ? err.code : 'UNKNOWN_ERROR');
        setErrorMsg(err?.message || 'အခန်းဖန်တီးခြင်း မအောင်မြင်ပါ');
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/45 backdrop-blur-xs animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-room-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full max-h-[90dvh] flex flex-col shadow-2xl relative text-slate-800 overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 sm:px-7 pt-5 sm:pt-6 pb-3.5 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
          <div>
            <h3 id="create-room-modal-title" className="text-lg sm:text-xl font-black text-slate-900">
              အခန်းအသစ် ဖန်တီးမည်
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              အခန်းဖွင့်ပြီးပါက Room Code ဖြင့် သူငယ်ချင်းများကို ဖိတ်ခေါ်နိုင်ပါသည်
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="ပိတ်မည်"
            className="min-h-[38px] min-w-[38px] p-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-600 hover:text-slate-900 flex items-center justify-center transition cursor-pointer disabled:opacity-50 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="px-5 sm:px-7 py-4 space-y-5 overflow-y-auto overscroll-contain flex-1">
          {errorMsg && (
            <div
              className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                errorCode === 'NETWORK_ERROR'
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-rose-50 border-rose-300 text-rose-800'
              }`}
            >
              {errorCode === 'NETWORK_ERROR' ? (
                <WifiOff className="w-4 h-4 shrink-0 text-amber-700" />
              ) : (
                <ShieldAlert className="w-4 h-4 shrink-0 text-rose-600" />
              )}
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Selectable Available Games */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">
              ကစားမည့် ဂိမ်းအမျိုးအစား ရွေးချယ်ပါ
            </label>
            <div className="space-y-2">
              {availableGames.map((game) => {
                const isSelected = selectedGame.id === game.id;
                return (
                  <button
                    key={game.id}
                    type="button"
                    onClick={() => handleSelectGame(game)}
                    disabled={isSubmitting}
                    aria-pressed={isSelected}
                    className={`w-full min-h-[60px] p-3.5 rounded-2xl border text-left flex items-center justify-between gap-3 transition cursor-pointer disabled:opacity-60 ${
                      isSelected
                        ? 'bg-amber-50/80 border-amber-400 ring-2 ring-amber-400/25 shadow-2xs'
                        : 'bg-white border-slate-200 hover:border-amber-300 hover:bg-amber-50/30'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-11 h-11 rounded-xl bg-white border border-amber-200/80 flex items-center justify-center text-2xl shrink-0 shadow-2xs">
                        {game.icon}
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 text-sm truncate">
                          {game.shortTitle}
                        </div>
                        <div className="text-[11px] text-slate-600 flex items-center gap-2 mt-0.5">
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Users className="w-3 h-3 text-amber-600" />
                            {game.minPlayers} - {game.maxPlayers} ဦး
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-700 font-semibold">ကစားနိုင်သည်</span>
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0">
                      <CheckCircle2
                        className={`w-5 h-5 ${
                          isSelected ? 'text-amber-600' : 'text-slate-300'
                        }`}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Per-Game Options for Selected Game */}
          <div className="space-y-3.5 pt-1">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">
                ကစားသမား အရေအတွက် ရွေးချယ်ပါ
              </label>
              <div
                className="grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${Math.max(1, allowedCounts.length)}, minmax(0, 1fr))`,
                }}
              >
                {allowedCounts.map((count) => (
                  <button
                    key={count}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      sounds.playClick();
                      setMaxPlayers(count);
                    }}
                    className={`min-h-[44px] py-2.5 rounded-xl text-xs font-black transition cursor-pointer tabular-nums disabled:opacity-60 ${
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

            {selectedGame.id === 'snakes_and_ladders' && (
              <label className="flex items-center justify-between gap-3 p-3.5 bg-slate-50 rounded-2xl border border-slate-200 cursor-pointer select-none">
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    အတိအကျ ဝင်ရန် လို/မလို စည်းမျဉ်း
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    ၁၀၀ သို့ရောက်ရန် အံစာတုံးနံပါတ် အတိအကျလိုအပ်သည်
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={exactFinishRule}
                  disabled={isSubmitting}
                  onChange={(e) => {
                    sounds.playClick();
                    setExactFinishRule(e.target.checked);
                  }}
                  className="w-5 h-5 accent-amber-500 rounded cursor-pointer shrink-0"
                />
              </label>
            )}
          </div>

          {/* Coming Soon Games (Read-Only / Disabled from Registry) */}
          {comingSoonGames.length > 0 && (
            <div className="pt-1 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-slate-500">
                  မကြာမီ ထပ်မံပါဝင်လာမည့် ဂိမ်းများ
                </span>
                <span className="text-[10px] font-semibold text-slate-400">
                  Coming Soon
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {comingSoonGames.map((game) => (
                  <button
                    key={game.id}
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="min-h-[46px] px-3 py-2 rounded-xl border border-slate-200/80 bg-slate-50/80 text-left flex items-center justify-between gap-2 opacity-75 cursor-not-allowed"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-lg shrink-0">{game.icon}</span>
                      <span className="text-xs font-semibold text-slate-600 truncate">
                        {game.shortTitle}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 whitespace-nowrap shrink-0">
                      <Clock className="w-3 h-3" />
                      <span>မကြာမီ</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 sm:px-7 py-4 border-t border-slate-100 bg-slate-50/60 flex gap-3 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs sm:text-sm transition cursor-pointer disabled:opacity-50"
          >
            ပယ်ဖျက်
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || selectedGame.status !== 'available'}
            className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-xs sm:text-sm transition shadow-xs cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? 'ဖန်တီးနေသည်...' : 'အခန်းဖွင့်မည်'}
          </button>
        </div>
      </div>
    </div>
  );
};
