import React from 'react';
import {
  Users,
  Copy,
  Check,
  Share2,
  Play,
  LogOut,
  Crown,
  ShieldCheck,
  Clock,
  Info,
  WifiOff,
} from 'lucide-react';
import { RoomPlayer, RoomStatus } from '../../types';

export interface SharedRoomLobbyProps {
  roomCode: string;
  roomStatus: Extract<RoomStatus, 'waiting' | 'full'>;
  gameTitle: string;
  gameIcon?: string;
  ruleSummary?: string | null;
  instructionsText?: string | null;
  hostId: string;
  hostName?: string;
  currentUserId?: string | null;
  players: RoomPlayer[];
  minPlayers?: number;
  maxPlayers: number;
  isHost: boolean;
  canStartGame: boolean;
  isOnline?: boolean;
  isTogglingReady?: boolean;
  isStartingGame?: boolean;
  isExiting?: boolean;
  copiedCode: boolean;
  copiedLink: boolean;
  onCopyCode: () => void;
  onCopyLink: () => void;
  onToggleReady: () => void | Promise<void>;
  onStartGame: () => void | Promise<void>;
  onLeaveRoom: () => void;
}

const MYANMAR_DIGITS = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'] as const;

function toMyanmarDigits(value: number): string {
  return String(Math.max(0, Math.floor(value)))
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0) - 48;
      return code >= 0 && code <= 9 ? MYANMAR_DIGITS[code] : ch;
    })
    .join('');
}

function resolvePlayerColorClass(hexColor?: string): string {
  switch (hexColor?.toUpperCase()) {
    case '#EF4444':
      return 'bg-rose-500';
    case '#10B981':
      return 'bg-emerald-500';
    case '#3B82F6':
      return 'bg-blue-500';
    case '#F59E0B':
      return 'bg-amber-500';
    default:
      return 'bg-slate-400';
  }
}

/**
 * Shared Multi-Game Room Lobby UI (Step 3.3A)
 * - Purely presentational & callback-driven (zero Firestore listeners or game-specific logic)
 * - Reusable across Snakes & Ladders and all future multiplayer mini-games
 */
export const SharedRoomLobby: React.FC<SharedRoomLobbyProps> = ({
  roomCode,
  roomStatus,
  gameTitle,
  gameIcon,
  ruleSummary,
  instructionsText,
  hostId,
  hostName,
  currentUserId,
  players,
  minPlayers = 2,
  maxPlayers,
  isHost,
  canStartGame,
  isOnline = true,
  isTogglingReady = false,
  isStartingGame = false,
  isExiting = false,
  copiedCode,
  copiedLink,
  onCopyCode,
  onCopyLink,
  onToggleReady,
  onStartGame,
  onLeaveRoom,
}) => {
  const safeMinPlayers = Math.max(2, Math.floor(minPlayers));
  const safeMaxPlayers = Math.max(safeMinPlayers, Math.floor(maxPlayers));
  const emptySlotCount = Math.max(0, safeMaxPlayers - players.length);
  const isLobbyFull = roomStatus === 'full' || players.length >= safeMaxPlayers;
  const currentPlayer = players.find((p) => p.uid === currentUserId);
  const resolvedHostName =
    players.find((p) => p.uid === hostId)?.displayName || hostName || '';
  const minPlayersMm = toMyanmarDigits(safeMinPlayers);

  return (
    <div className="max-w-4xl mx-auto w-full p-2 sm:p-4 md:p-6 space-y-4 sm:space-y-6 text-slate-800">
      {/* Local Offline Notice if current device lost internet in Lobby */}
      {!isOnline && (
        <div className="p-2.5 sm:p-3 bg-amber-50 border border-amber-300 rounded-2xl flex items-center gap-2 text-xs font-bold text-amber-950">
          <WifiOff className="w-4 h-4 text-rose-600 shrink-0" />
          <span>
            အင်တာနက်လိုင်း ခေတ္တပြတ်တောက်နေပါသည်။ လိုင်းပြန်မိသည်နှင့် အခန်းချိတ်ဆက်မှု အလိုအလျောက် ပြန်လည်ရရှိပါမည်။
          </span>
        </div>
      )}

      {/* Lobby Header Bar */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-4 sm:p-5 md:p-6 shadow-xs backdrop-blur-md">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center flex-wrap gap-2 text-xs text-slate-600 mb-1">
              <span className="font-bold text-amber-800 inline-flex items-center gap-1">
                {gameIcon && <span aria-hidden="true">{gameIcon}</span>}
                <span>{gameTitle}</span>
              </span>
              <span aria-hidden="true">·</span>
              {isLobbyFull ? (
                <span className="font-bold text-emerald-700 tabular-nums">
                  လူစုံပြီ ({players.length}/{safeMaxPlayers})
                </span>
              ) : (
                <span className="font-semibold text-sky-700 tabular-nums">
                  ကစားသမား စောင့်ဆိုင်းဆဲ ({players.length}/{safeMaxPlayers})
                </span>
              )}
              {ruleSummary && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-500">{ruleSummary}</span>
                </>
              )}
            </div>

            <h1 className="text-xl md:text-2xl font-black text-slate-900 flex items-center gap-2">
              <span>အခန်းနံပါတ် -</span>
              <span className="text-amber-700 font-mono tracking-wider">{roomCode}</span>
            </h1>

            {resolvedHostName && (
              <div className="text-[11px] sm:text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="truncate">
                  အခန်းဖန်တီးသူ (Host): <strong className="text-slate-700">{resolvedHostName}</strong>
                </span>
              </div>
            )}
          </div>

          {/* Quick Share / Invite Buttons */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <button
              type="button"
              onClick={onCopyCode}
              className="flex-1 md:flex-initial min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-700 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition cursor-pointer whitespace-nowrap"
            >
              {copiedCode ? (
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <Copy className="w-4 h-4 shrink-0" />
              )}
              <span>{copiedCode ? 'ကုဒ်ကူးယူပြီး' : 'အခန်းကုဒ် ကူးမည်'}</span>
            </button>

            <button
              type="button"
              onClick={onCopyLink}
              className="flex-1 md:flex-initial min-h-[44px] px-3.5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition shadow-xs cursor-pointer whitespace-nowrap"
            >
              {copiedLink ? (
                <Check className="w-4 h-4 shrink-0" />
              ) : (
                <Share2 className="w-4 h-4 shrink-0" />
              )}
              <span>{copiedLink ? 'Link ကူးယူပြီး' : 'သူငယ်ချင်းဖိတ်ရန် Link'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Players List Grid (2 columns on mobile so 4 players fit without pushing Start off-screen) */}
      <div className="space-y-2.5 sm:space-y-3">
        <div className="flex items-center justify-between px-1 sm:px-2">
          <h2 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600" />
            <span className="tabular-nums">
              ပါဝင်သူများ ({players.length} / {safeMaxPlayers})
            </span>
          </h2>
          <div className="text-[11px] sm:text-xs text-slate-500">
            အနည်းဆုံး {minPlayersMm} ဦး လိုအပ်ပါသည်
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
          {players.map((player) => {
            const isRoomHost = player.uid === hostId;
            const isMe = Boolean(currentUserId && player.uid === currentUserId);
            const isOffline = player.isConnected === false;

            return (
              <div
                key={player.uid}
                className={`relative bg-white border rounded-2xl p-3 sm:p-4 flex flex-col items-center text-center transition-all duration-200 shadow-xs ${
                  player.isReady
                    ? 'border-emerald-400 bg-emerald-50/20'
                    : 'border-slate-200'
                }`}
              >
                {/* Host Indicator */}
                {isRoomHost && (
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1 bg-amber-400 text-slate-950 px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-black">
                    <Crown className="w-2.5 h-2.5 sm:w-3 sm:h-3 fill-current" />
                    <span>HOST</span>
                  </div>
                )}

                {/* Player Color & Connection Indicator */}
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
                  {isOffline && (
                    <span
                      title="အင်တာနက်လိုင်း ပြတ်တောက်နေသည်"
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-rose-50 border border-rose-200"
                    >
                      <WifiOff className="w-2.5 h-2.5 text-rose-600" />
                    </span>
                  )}
                  <span
                    className={`w-3 h-3 rounded-full border border-white shadow-xs ${resolvePlayerColorClass(
                      player.color
                    )}`}
                    title="ကစားသမားအရောင်"
                  />
                </div>

                {/* Avatar */}
                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full overflow-hidden border-2 border-slate-200 mb-2 sm:mb-3 mt-3 sm:mt-2 shadow-inner bg-slate-100">
                  <img
                    src={
                      player.photoURL ||
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${player.uid}`
                    }
                    alt={player.displayName}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Name & Player ID */}
                <div className="font-bold text-slate-900 text-xs sm:text-sm truncate max-w-full px-1">
                  {player.displayName} {isMe && '(သင်)'}
                </div>
                <div className="text-[11px] font-mono text-amber-800 font-semibold mb-2 sm:mb-3">
                  {player.playerId}
                </div>

                {/* Ready / Connection Status */}
                <div
                  className={`px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-bold flex items-center gap-1 whitespace-nowrap ${
                    isOffline
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : player.isReady
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 text-slate-500 border border-slate-200'
                  }`}
                >
                  {isOffline ? (
                    <>
                      <WifiOff className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      <span>လိုင်းပြတ်နေသည်</span>
                    </>
                  ) : player.isReady ? (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>အဆင်သင့်ဖြစ်ပြီ</span>
                    </>
                  ) : (
                    <>
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>စောင့်ဆိုင်းဆဲ</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {/* Waiting for Players Empty Slots */}
          {Array.from({ length: emptySlotCount }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="border-2 border-dashed border-slate-200/90 rounded-2xl p-4 sm:p-6 flex flex-col items-center justify-center text-center text-slate-400 bg-slate-50/50 min-h-[148px] sm:min-h-[170px]"
            >
              <Users className="w-6 h-6 sm:w-8 sm:h-8 opacity-40 mb-1.5 sm:mb-2" />
              <span className="text-[11px] sm:text-xs font-semibold">
                ကစားသမား စောင့်ဆိုင်းဆဲ
              </span>
              <span className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">
                ကုဒ်မျှဝေပြီး ဖိတ်ခေါ်ပါ
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Lobby Controls Bar */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 shadow-xs">
        <button
          type="button"
          onClick={onLeaveRoom}
          disabled={isExiting}
          className="w-full sm:w-auto min-h-[46px] px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm flex items-center justify-center gap-2 transition cursor-pointer border border-slate-200 whitespace-nowrap disabled:opacity-60"
        >
          <LogOut className="w-4 h-4" />
          <span>အခန်းမှ ထွက်မည်</span>
        </button>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Guest Ready Toggle */}
          {!isHost && (
            <button
              type="button"
              onClick={onToggleReady}
              disabled={isTogglingReady || isExiting}
              className={`w-full sm:w-auto min-h-[48px] px-6 py-3.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition shadow-xs cursor-pointer disabled:opacity-60 ${
                currentPlayer?.isReady
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-amber-400 hover:bg-amber-500 text-slate-950'
              }`}
            >
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <span>
                {currentPlayer?.isReady
                  ? 'အဆင်သင့်ဖြစ်ပြီးပါပြီ (ပယ်ဖျက်ရန်)'
                  : 'အဆင်သင့်ဖြစ်ပြီ'}
              </span>
            </button>
          )}

          {/* Host Start Game Button */}
          {isHost && (
            <button
              type="button"
              onClick={onStartGame}
              disabled={!canStartGame || isStartingGame || isExiting}
              className={`w-full sm:w-auto min-h-[48px] px-7 py-3.5 rounded-xl font-black text-sm md:text-base flex items-center justify-center gap-2 transition shadow-xs ${
                canStartGame && !isStartingGame && !isExiting
                  ? 'bg-amber-400 hover:bg-amber-500 text-slate-950 cursor-pointer active:scale-[0.98]'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
              }`}
            >
              <Play className="w-5 h-5 fill-current shrink-0" />
              <span>
                {isStartingGame
                  ? 'ဂိမ်းစတင်နေသည်...'
                  : players.length < safeMinPlayers
                  ? `ကစားသမား အနည်းဆုံး ${minPlayersMm} ဦး လိုအပ်ပါသည်`
                  : canStartGame
                  ? 'ဂိမ်းစတင်မည်'
                  : 'အားလုံး အဆင်သင့်ဖြစ်ရန် စောင့်ဆိုင်းပါ'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Optional Game Summary / Instructions */}
      {instructionsText && (
        <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3.5 sm:p-4 flex items-start gap-3 text-xs text-slate-700">
          <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-slate-900">ဂိမ်းကစားနည်း အကျဉ်းချုပ် - </span>
            <span>{instructionsText}</span>
          </div>
        </div>
      )}
    </div>
  );
};
