import React from 'react';
import { AlertTriangle, LogOut, RefreshCw, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import type { SnowRushConnectionStatus } from '../network/SnowRushSocketClient';
import type { SnowRushNetworkErrorCode } from '../network/protocol';

export interface SnowRushNetworkStatusBannerProps {
  readonly status: SnowRushConnectionStatus;
  readonly rttMs?: number | null;
  readonly reconnectAttempt?: number;
  readonly maxReconnectAttempts?: number;
  readonly errorCode?: SnowRushNetworkErrorCode | 'WS_UNCONFIGURED' | 'CONNECTION_FAILED' | null;
  readonly errorMessage?: string | null;
  readonly isBrowserOffline?: boolean;
  readonly isRoomExited?: boolean;
  readonly isRaceCompleted?: boolean;
  readonly onRetryConnect?: () => void;
}

export interface NetworkBannerDescriptor {
  readonly visible: boolean;
  readonly tone: 'connected' | 'progress' | 'warning' | 'error';
  readonly headlineMm: string;
  readonly detailMm: string | null;
  readonly canManualRetry: boolean;
}

function getBurmeseErrorDetail(
  errorCode: SnowRushNetworkStatusBannerProps['errorCode'],
  fallbackMessage?: string | null
): { readonly isInvalidRoom: boolean; readonly detailMm: string } {
  switch (errorCode) {
    case 'INVALID_TOKEN':
    case 'EXPIRED_TOKEN':
    case 'AUTH_TIMEOUT':
    case 'UNAUTHENTICATED_MESSAGE':
      return {
        isInvalidRoom: false,
        detailMm: 'အကောင့် Authentication အတည်ပြုချက် သက်တမ်းကုန်သွားပါသည်။ အခန်းမှထွက်၍ ပြန်ဝင်ပေးပါ။',
      };
    case 'ROOM_NOT_FOUND':
      return {
        isInvalidRoom: true,
        detailMm: 'ပြိုင်ပွဲအခန်းကို ရှာမတွေ့ပါ။ အခန်းပိတ်သွားခြင်း ဖြစ်နိုင်ပါသည်။',
      };
    case 'NOT_ROOM_MEMBER':
      return {
        isInvalidRoom: true,
        detailMm: 'သင်သည် ဤပြိုင်ပွဲအခန်း၏ ကစားသမားစာရင်းတွင် မပါဝင်ပါ။',
      };
    case 'WRONG_GAME_TYPE':
      return {
        isInvalidRoom: true,
        detailMm: 'ဤအခန်းသည် နှင်းတောင်ဆင်းပြိုင်ပွဲ (Snow Rush) အခန်း မဟုတ်ပါ။',
      };
    case 'ROOM_NOT_PLAYING':
      return {
        isInvalidRoom: true,
        detailMm: 'ပြိုင်ပွဲ မစတင်သေးပါ။ Lobby အတွင်းမှ Host စတင်ပေးရန် စောင့်ဆိုင်းပါ။',
      };
    case 'ROOM_ALREADY_FINISHED':
      return {
        isInvalidRoom: true,
        detailMm: 'ဤပြိုင်ပွဲအချီ ပြီးဆုံးသွားပါပြီ။',
      };
    case 'ROOM_CAPACITY_INVALID':
      return {
        isInvalidRoom: true,
        detailMm: 'ပြိုင်ပွဲဝင် ကစားသမားအရေအတွက် (၂–၄ ဦး) မပြည့်စုံပါ။',
      };
    case 'ROOM_ROUND_MISMATCH':
    case 'ROOM_VERIFY_FAILED':
      return {
        isInvalidRoom: true,
        detailMm: fallbackMessage || 'အခန်းအချက်အလက် စစ်ဆေးမှု မအောင်မြင်ပါ။',
      };
    case 'DUPLICATE_SESSION_REPLACED':
      return {
        isInvalidRoom: false,
        detailMm: 'အခြား စက် သို့မဟုတ် Tab အသစ်မှ ဝင်ရောက်လာသဖြင့် ဤချိတ်ဆက်မှုကို ရပ်နားထားပါသည်။',
      };
    case 'RATE_LIMIT_EXCEEDED':
      return {
        isInvalidRoom: false,
        detailMm: 'ခလုတ်ပို့လွှတ်မှု အလွန်များနေသဖြင့် ချိတ်ဆက်မှု ခေတ္တပိတ်သွားပါသည်။',
      };
    case 'WS_UNCONFIGURED':
      return {
        isInvalidRoom: false,
        detailMm: 'Online Multiplayer မချိတ်ဆက်ရသေးပါ — VITE_SNOW_RUSH_WS_URL မသတ်မှတ်ရသေးပါ။',
      };
    case 'CONNECTION_FAILED':
      return {
        isInvalidRoom: false,
        detailMm: 'ဆာဗာသို့ ပြန်လည်ချိတ်ဆက်၍ မရသေးပါ။ အင်တာနက်စစ်ဆေးပြီး ပြန်ကြိုးစားပါ။',
      };
    default:
      return {
        isInvalidRoom: false,
        detailMm: fallbackMessage || 'ချိတ်ဆက်မှုတွင် အမှားအယွင်းတစ်ခု ဖြစ်ပေါ်နေပါသည်။',
      };
  }
}

/**
 * Pure state-to-Burmese-UI descriptor resolver for Snow Rush Online Multiplayer.
 * Guarantees deterministic Burmese copy and prevents retry loops on terminal rejections.
 */
export function resolveNetworkBannerDescriptor(
  props: Omit<SnowRushNetworkStatusBannerProps, 'onRetryConnect'>
): NetworkBannerDescriptor {
  const {
    status,
    reconnectAttempt = 0,
    maxReconnectAttempts = 5,
    errorCode = null,
    errorMessage = null,
    isBrowserOffline = false,
    isRoomExited = false,
    isRaceCompleted = false,
  } = props;

  if (isRoomExited) {
    return {
      visible: true,
      tone: 'warning',
      headlineMm: 'အခန်းမှ ထွက်သွားရပြီ',
      detailMm: 'ဤပြိုင်ပွဲအခန်းမှ ထွက်ခွာပြီး ဖြစ်ပါသည်။',
      canManualRetry: false,
    };
  }

  if (errorCode === 'WS_UNCONFIGURED') {
    return {
      visible: true,
      tone: 'warning',
      headlineMm: 'Multiplayer Server မသတ်မှတ်ရသေးပါ',
      detailMm: 'Online Multiplayer မချိတ်ဆက်ရသေးပါ — Server URL မသတ်မှတ်ရသေးပါ။',
      canManualRetry: false,
    };
  }

  if (isBrowserOffline && !isRaceCompleted) {
    return {
      visible: true,
      tone: 'warning',
      headlineMm: 'Network ပြတ်တောက်နေသည်',
      detailMm: 'အင်တာနက်လိုင်း ပြတ်တောက်နေပါသည်။ ပြန်ချိတ်မိသည်နှင့် အလိုအလျောက် ဆက်လက်ချိတ်ဆက်ပါမည်။',
      canManualRetry: true,
    };
  }

  if (status === 'idle') {
    return {
      visible: false,
      tone: 'progress',
      headlineMm: '',
      detailMm: null,
      canManualRetry: false,
    };
  }

  if (status === 'connecting') {
    return {
      visible: true,
      tone: 'progress',
      headlineMm: 'ချိတ်ဆက်နေသည်',
      detailMm: 'နှင်းတောင်ဆင်းပြိုင်ပွဲ ဆာဗာသို့ ချိတ်ဆက်နေပါသည်...',
      canManualRetry: false,
    };
  }

  if (status === 'authenticating') {
    return {
      visible: true,
      tone: 'progress',
      headlineMm: 'Authentication စစ်ဆေးနေသည်',
      detailMm: 'Firebase အကောင့်နှင့် အခန်းဝင်ခွင့်ကို အတည်ပြုနေပါသည်...',
      canManualRetry: false,
    };
  }

  if (status === 'connected') {
    return {
      visible: true,
      tone: 'connected',
      headlineMm: 'ချိတ်ဆက်ပြီး',
      detailMm: null,
      canManualRetry: false,
    };
  }

  if (status === 'reconnecting') {
    return {
      visible: true,
      tone: 'warning',
      headlineMm: 'ပြန်လည်ချိတ်ဆက်နေသည်',
      detailMm: `ကြိုးပမ်းမှု ${Math.max(1, reconnectAttempt)}/${maxReconnectAttempts}...`,
      canManualRetry: false,
    };
  }

  if (status === 'duplicate_session') {
    const errInfo = getBurmeseErrorDetail('DUPLICATE_SESSION_REPLACED', errorMessage);
    return {
      visible: true,
      tone: 'warning',
      headlineMm: 'အခန်းမှ ထွက်သွားရပြီ',
      detailMm: errInfo.detailMm,
      canManualRetry: true,
    };
  }

  if (status === 'disconnected') {
    if (isRaceCompleted) {
      return {
        visible: false,
        tone: 'connected',
        headlineMm: '',
        detailMm: null,
        canManualRetry: false,
      };
    }
    return {
      visible: true,
      tone: 'warning',
      headlineMm: 'Network ပြတ်တောက်နေသည်',
      detailMm: 'ဆာဗာနှင့် ချိတ်ဆက်မှု ပြတ်တောက်သွားပါသည်။',
      canManualRetry: true,
    };
  }

  if (status === 'rejected') {
    const errInfo = getBurmeseErrorDetail(errorCode, errorMessage);
    return {
      visible: true,
      tone: 'error',
      headlineMm: errInfo.isInvalidRoom ? 'Room မမှန်ကန်ပါ' : 'ချိတ်ဆက်ခွင့် ငြင်းပယ်ခံရသည်',
      detailMm: errInfo.detailMm,
      canManualRetry: false,
    };
  }

  // status === 'error' (WS_UNCONFIGURED already returned above)
  const errInfo = getBurmeseErrorDetail(errorCode, errorMessage);
  return {
    visible: true,
    tone: 'error',
    headlineMm:
      errorCode === 'CONNECTION_FAILED'
        ? 'Multiplayer Server ချိတ်ဆက်မှု မအောင်မြင်ပါ'
        : 'Network ပြတ်တောက်နေသည်',
    detailMm: errInfo.detailMm,
    canManualRetry: true,
  };
}

/**
 * Multiplayer-only Network Status & Error UI Banner for Snow Rush.
 * Strictly decoupled from Local Offline Preview (`?devSnowRush=1`).
 */
export const SnowRushNetworkStatusBanner: React.FC<SnowRushNetworkStatusBannerProps> = ({
  status,
  rttMs = null,
  reconnectAttempt = 0,
  maxReconnectAttempts = 5,
  errorCode = null,
  errorMessage = null,
  isBrowserOffline = false,
  isRoomExited = false,
  isRaceCompleted = false,
  onRetryConnect,
}) => {
  const descriptor = resolveNetworkBannerDescriptor({
    status,
    rttMs,
    reconnectAttempt,
    maxReconnectAttempts,
    errorCode,
    errorMessage,
    isBrowserOffline,
    isRoomExited,
    isRaceCompleted,
  });

  if (!descriptor.visible) {
    return null;
  }

  if (descriptor.tone === 'connected') {
    const rttQualityColor =
      rttMs === null
        ? 'text-sky-200'
        : rttMs <= 90
          ? 'text-emerald-300'
          : rttMs <= 180
            ? 'text-amber-300'
            : 'text-rose-300';

    return (
      <div className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-slate-950/75 px-3 py-1.5 text-xs text-slate-100 backdrop-blur-md">
        <Wifi className={`h-3.5 w-3.5 shrink-0 ${rttQualityColor}`} />
        <span className="font-medium text-slate-200">{descriptor.headlineMm}</span>
        {rttMs !== null && (
          <span className={`font-mono tabular-nums ${rttQualityColor}`}>{rttMs} ms</span>
        )}
      </div>
    );
  }

  if (descriptor.tone === 'progress') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-400/30 bg-slate-950/85 px-4 py-2.5 text-xs text-sky-100 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-sky-300" />
          <div>
            <span className="font-bold">{descriptor.headlineMm}</span>
            {descriptor.detailMm && (
              <span className="text-sky-200/90"> — {descriptor.detailMm}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (descriptor.tone === 'warning') {
    const IconComponent = isRoomExited ? LogOut : status === 'duplicate_session' ? ShieldAlert : WifiOff;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/35 bg-slate-950/90 px-4 py-2.5 text-xs text-amber-100 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <IconComponent className="h-4 w-4 shrink-0 text-amber-300" />
          <div>
            <span className="font-bold">{descriptor.headlineMm}</span>
            {descriptor.detailMm && (
              <span className="text-amber-100/90"> — {descriptor.detailMm}</span>
            )}
          </div>
        </div>
        {descriptor.canManualRetry && onRetryConnect && (
          <button
            type="button"
            onClick={onRetryConnect}
            className="shrink-0 whitespace-nowrap rounded-lg border border-amber-300/40 bg-amber-500/20 px-3 py-1.5 font-medium text-amber-100 transition hover:bg-amber-500/30 cursor-pointer"
          >
            {status === 'duplicate_session' ? 'ဤစက်မှ ပြန်ဝင်မည်' : 'ပြန်ချိတ်ဆက်မည်'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/40 bg-rose-950/90 px-4 py-2.5 text-xs text-rose-100 backdrop-blur-md">
      <div className="flex items-center gap-2.5">
        <AlertTriangle className="h-4 w-4 shrink-0 text-rose-300" />
        <div>
          <span className="font-bold">{descriptor.headlineMm}</span>
          {descriptor.detailMm && <span className="text-rose-100/90"> — {descriptor.detailMm}</span>}
        </div>
      </div>
      {descriptor.canManualRetry && onRetryConnect && (
        <button
          type="button"
          onClick={onRetryConnect}
          className="shrink-0 whitespace-nowrap rounded-lg border border-rose-300/40 bg-rose-500/25 px-3 py-1.5 font-medium text-rose-50 transition hover:bg-rose-500/35 cursor-pointer"
        >
          ပြန်ချိတ်ဆက်မည်
        </button>
      )}
    </div>
  );
};
