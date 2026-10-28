import React, { useEffect } from 'react';
import { AlertTriangle, Play, LogOut } from 'lucide-react';
import { RoomStatus } from '../../types';

interface ExitConfirmModalProps {
  isOpen: boolean;
  gameStatus?: RoomStatus | 'loading';
  isExiting: boolean;
  onContinuePlaying: () => void;
  onConfirmExit: () => void;
}

export const ExitConfirmModal: React.FC<ExitConfirmModalProps> = ({
  isOpen,
  gameStatus,
  isExiting,
  onContinuePlaying,
  onConfirmExit,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isExiting) {
        onContinuePlaying();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isExiting, onContinuePlaying]);

  if (!isOpen) return null;

  const isPlaying = gameStatus === 'playing';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exit-confirm-title"
      onClick={() => {
        if (!isExiting) {
          onContinuePlaying();
        }
      }}
    >
      <div
        className="bg-white border border-slate-200 rounded-3xl p-6 max-w-sm w-full shadow-2xl text-slate-800 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center space-y-2.5">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>

          <h2
            id="exit-confirm-title"
            className="text-lg sm:text-xl font-black text-slate-900 leading-snug"
          >
            ဂိမ်းမှ ထွက်မှာ သေချာပါသလား?
          </h2>

          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            {isPlaying
              ? 'လက်ရှိ ဂိမ်းပွဲ မပြီးဆုံးသေးပါ။ ထွက်ခွာပါက ဤအခန်းမှ သင့်ကို ဖယ်ရှားသွားမည်ဖြစ်ပြီး ကျန်ကစားသမားများ ဆက်လက်ကစားကြမည်ဖြစ်ပါသည်။'
              : 'အခန်းမှ ထွက်ခွာပါက လက်ရှိ စောင့်ဆိုင်းနေသော ဂိမ်းအခန်းမှ ထွက်သွားမည်ဖြစ်ပါသည်။'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            disabled={isExiting}
            onClick={onContinuePlaying}
            className="flex-1 min-h-[48px] px-4 py-3 rounded-xl bg-amber-400 hover:bg-amber-500 active:scale-[0.98] text-slate-950 font-black text-sm flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>ဆက်ကစားမည်</span>
          </button>

          <button
            type="button"
            disabled={isExiting}
            onClick={onConfirmExit}
            className="flex-1 min-h-[48px] px-4 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white font-bold text-sm flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-70 whitespace-nowrap shrink-0"
          >
            {isExiting ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>ထွက်ခွာနေသည်...</span>
              </>
            ) : (
              <>
                <LogOut className="w-4 h-4" />
                <span>ဂိမ်းမှ ထွက်မည်</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
