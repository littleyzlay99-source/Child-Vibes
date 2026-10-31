import React from 'react';
import { Clock, LogOut, ShieldAlert } from 'lucide-react';
import { UNKNOWN_GAME_FALLBACK_TITLE } from './registry';
import type { GameModuleResolution } from './types';

export interface UnsupportedGameFallbackProps {
  resolution: Extract<GameModuleResolution, { kind: 'unresolved' }>;
  roomCode?: string;
  isExiting?: boolean;
  onLeaveRoom: () => void | Promise<void>;
}

/**
 * Safe Burmese Fallback UI when a room's `gameType` is coming_soon, unknown, or unimplemented.
 * Never silently renders Snakes & Ladders for invalid or unavailable game types.
 */
export const UnsupportedGameFallback: React.FC<UnsupportedGameFallbackProps> = ({
  resolution,
  roomCode,
  isExiting = false,
  onLeaveRoom,
}) => {
  const isComingSoon = resolution.reason === 'coming_soon';
  const displayTitle = resolution.registryEntry?.shortTitle || UNKNOWN_GAME_FALLBACK_TITLE;
  const displayIcon = resolution.registryEntry?.icon;

  const headingText = isComingSoon
    ? `${displayTitle} ဂိမ်း မကြာမီလာမည်`
    : 'ဤဂိမ်းအမျိုးအစားကို လက်ရှိတွင် ကစား၍ မရနိုင်ပါ';

  const bodyText = isComingSoon
    ? `“${displayTitle}” မီနီဂိမ်းကို လက်ရှိတွင် ပြင်ဆင်နေဆဲဖြစ်သောကြောင့် ဂိမ်းပွဲစတင် ကစား၍ မရနိုင်သေးပါ။ မကြာမီ ထပ်မံထည့်သွင်းပေးသွားပါမည်။`
    : resolution.reason === 'module_missing'
    ? `“${displayTitle}” ဂိမ်းမော်ဂျူးကို လက်ရှိဗားရှင်းတွင် ထည့်သွင်းထားခြင်း မရှိသေးပါ။ အခန်းမှ ထွက်ခွာပြီး ကစားနိုင်သော အခြားဂိမ်းကို ရွေးချယ်ပေးပါ။`
    : 'ရွေးချယ်ထားသော ဂိမ်းအမျိုးအစား (gameType) သည် မှားယွင်းနေပါသည် သို့မဟုတ် စာရင်းသွင်းထားခြင်း မရှိပါ။ ကျေးဇူးပြု၍ အခန်းမှ ထွက်ခွာပြီး ပြန်လည်ကြိုးစားပေးပါ။';

  return (
    <div className="max-w-lg mx-auto w-full py-6 sm:py-10 px-3">
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 text-center shadow-sm space-y-4">
        <div
          className={`w-16 h-16 rounded-2xl mx-auto flex items-center justify-center border ${
            isComingSoon
              ? 'bg-amber-50 border-amber-200 text-amber-700'
              : 'bg-rose-50 border-rose-200 text-rose-600'
          }`}
        >
          {displayIcon ? (
            <span className="text-3xl" aria-hidden="true">
              {displayIcon}
            </span>
          ) : (
            <ShieldAlert className="w-8 h-8" />
          )}
        </div>

        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
            {isComingSoon ? (
              <>
                <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>မကြာမီလာမည် (Coming Soon)</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>ဂိမ်းမရရှိနိုင်ပါ</span>
              </>
            )}
            {roomCode && (
              <>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span className="font-mono text-amber-800">#{roomCode}</span>
              </>
            )}
          </div>

          <h2 className="text-lg sm:text-xl font-black text-slate-900 pt-1">{headingText}</h2>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-md mx-auto">
            {bodyText}
          </p>
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={onLeaveRoom}
            disabled={isExiting}
            className="w-full sm:w-auto min-h-[46px] px-6 py-3 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-sm inline-flex items-center justify-center gap-2 transition shadow-xs cursor-pointer disabled:opacity-60"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>{isExiting ? 'ထွက်ခွာနေသည်...' : 'အခန်းမှ ထွက်မည်'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
