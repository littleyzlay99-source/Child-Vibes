import React from 'react';
import { Clock, Flag, LogOut, Trophy, Wifi } from 'lucide-react';
import type { RaceFinishState, SnowRushSnapshot } from '../engine/multiplayerTypes';
import { formatMultiplayerFinishReasonMm } from '../multiplayerHud';
import type { SnowRushConnectionStatus } from '../network/SnowRushSocketClient';
import { formatDistanceKm, formatRaceTimeSec } from '../simulation';

export interface SnowRushMultiplayerPodiumProps {
  readonly finishState: RaceFinishState;
  readonly snapshot: SnowRushSnapshot;
  readonly currentUserId: string | null;
  readonly connectionStatus: SnowRushConnectionStatus;
  readonly rttMs: number | null;
  readonly isExiting: boolean;
  readonly onExitRoom: () => void;
}

function getNetworkSummaryLabelMm(
  status: SnowRushConnectionStatus,
  rttMs: number | null
): string {
  switch (status) {
    case 'connected':
      return rttMs !== null ? `ချိတ်ဆက်ပြီး · ${rttMs} ms` : 'ချိတ်ဆက်ပြီး';
    case 'disconnected':
      return 'ပြိုင်ပွဲပြီးဆုံး၍ ချိတ်ဆက်မှု ပိတ်သိမ်းပြီး';
    case 'reconnecting':
      return 'ပြန်လည်ချိတ်ဆက်နေသည်';
    case 'duplicate_session':
      return 'အခြား စက်မှ ဝင်ရောက်ထားသည်';
    default:
      return 'ချိတ်ဆက်မှု အခြေအနေ တည်ငြိမ်';
  }
}

/**
 * Display-only Match Finished / Standings Overlay for Snow Rush Step 4.8.
 *
 * Driven 100% by server-authoritative `finishState` & `snapshot`.
 * Strictly performs ZERO Firestore writes, ZERO reward claims, and ZERO room resets.
 */
export const SnowRushMultiplayerPodium: React.FC<SnowRushMultiplayerPodiumProps> = ({
  finishState,
  snapshot,
  currentUserId,
  connectionStatus,
  rttMs,
  isExiting,
  onExitRoom,
}) => {
  const standings =
    finishState.standings.length > 0 ? finishState.standings : snapshot.raceStandings;
  const winnerEntry =
    standings.find((entry) => entry.uid === finishState.winnerId) ?? standings[0] ?? null;
  const finishReasonMm = formatMultiplayerFinishReasonMm(finishState.finishReason);
  const networkSummaryMm = getNetworkSummaryLabelMm(connectionStatus, rttMs);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-3 sm:p-6 bg-slate-950/55 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 my-auto text-slate-900">
        {/* Header & Winner Spotlight */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-emerald-700">
              <Flag className="w-3.5 h-3.5 shrink-0" />
              <span>ပြိုင်ပွဲပြီးဆုံးပြီ</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-slate-500 font-medium">
                <Wifi className="w-3 h-3 shrink-0" />
                <span>{networkSummaryMm}</span>
              </span>
            </div>

            <h3 className="text-xl sm:text-2xl font-black text-slate-900 mt-1 truncate">
              {winnerEntry ? `🏆 အနိုင်ရသူ — ${winnerEntry.displayName}` : 'နှင်းတောင်ဆင်းပြိုင်ပွဲ ရလဒ်'}
            </h3>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{finishReasonMm}</p>
          </div>

          <div className="w-12 h-12 rounded-2xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-600 shrink-0">
            <Trophy className="w-6 h-6" />
          </div>
        </div>

        {/* Authoritative Rank 1–4 Standings */}
        <div className="space-y-2" role="list" aria-label="ပြိုင်ပွဲဝင် အဆင့်စာရင်း">
          {standings.map((entry) => {
            const isLocal = Boolean(currentUserId && entry.uid === currentUserId);
            const isWinner = entry.rank === 1;
            const timeLabel =
              entry.finished && entry.finishTimeMs !== null
                ? `${formatRaceTimeSec(entry.finishTimeMs)}s`
                : 'အချိန်ပြည့်';
            const distanceLabel = entry.finished
              ? '1.00 km'
              : `${formatDistanceKm(entry.distanceM)} km (${Math.round(entry.distanceM)} m)`;

            return (
              <div
                key={entry.uid}
                role="listitem"
                className={`flex items-center justify-between gap-3 p-3 rounded-2xl border transition ${
                  isWinner
                    ? 'bg-amber-50/90 border-amber-300'
                    : isLocal
                      ? 'bg-sky-50/80 border-sky-300'
                      : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center font-mono font-black text-xs tabular-nums shrink-0 ${
                      isWinner
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-slate-200 text-slate-800'
                    }`}
                  >
                    #{entry.rank}
                  </div>

                  <span
                    className="w-3.5 h-3.5 rounded-full border border-slate-900/20 shrink-0"
                    style={{ backgroundColor: entry.color || '#0EA5E9' }}
                    aria-hidden="true"
                  />

                  <div className="min-w-0">
                    <div className="text-sm font-black text-slate-900 truncate">
                      {entry.displayName}
                      {isLocal ? ' (သင်)' : ''}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono tabular-nums">
                      <span>{distanceLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span>Item {entry.itemsUsedCount}</span>
                      <span aria-hidden="true">·</span>
                      <span>Hit {entry.attacksLandedCount}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="inline-flex items-center gap-1 text-xs font-mono font-black text-slate-900 tabular-nums">
                    <Clock className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                    <span>{timeLabel}</span>
                  </div>
                  <div className="text-[10px] font-semibold text-slate-500">
                    {entry.finished ? 'ပန်းဝင်ပြီး' : 'တာပိတ်ချိန်'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Display-Only Settlement Guard Notice */}
        <div className="p-3 rounded-2xl bg-slate-100 border border-slate-200 text-[11px] text-slate-700 leading-relaxed">
          ဤအဆင့်သည် <strong>Display-Only Multiplayer စမ်းသပ်မှု</strong> ဖြစ်ပါသည် — XP၊ ရမှတ် (Points)
          နှင့် Firestore အခန်းရလဒ် မှတ်တမ်းတင်ခြင်း မပြုလုပ်သေးပါ။
        </div>

        {/* Exit Room Action */}
        <div className="pt-1">
          <button
            type="button"
            disabled={isExiting}
            onClick={(e) => {
              e.currentTarget.blur();
              onExitRoom();
            }}
            className="w-full min-h-[46px] py-2.5 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>{isExiting ? 'အခန်းမှ ထွက်နေသည်...' : 'အခန်းမှ ထွက်မည်'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
