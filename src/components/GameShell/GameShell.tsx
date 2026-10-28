import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { LogOut, Volume2, VolumeX } from 'lucide-react';
import { sounds } from '../../lib/sound';
import { RoomStatus } from '../../types';
import { ExitConfirmModal } from './ExitConfirmModal';

interface GameShellContextValue {
  requestExit: () => void;
  isExiting: boolean;
}

const GameShellContext = createContext<GameShellContextValue>({
  requestExit: () => {},
  isExiting: false,
});

export const useGameShell = () => useContext(GameShellContext);

export interface GameShellProps {
  roomId: string;
  roomCode?: string;
  gameTitle: string;
  gameStatus?: RoomStatus | 'loading';
  onConfirmExit: () => Promise<void>;
  children: React.ReactNode;
}

/**
 * Reusable Dedicated Game Mode Shell for all Mini Games (Snakes & Ladders and future games).
 * - Hides the Main Platform Header & Mobile Bottom Navigation Bar completely
 * - Locks route navigation and intercepts Browser Back Button (`popstate`) to prevent accidental exits
 * - Provides a dedicated "ဂိမ်းမှ ထွက်ရန်" top bar button with Myanmar confirmation dialog
 * - Respects mobile safe-area insets (iPhone 11+, notched iOS & Android gesture bars)
 */
export const GameShell: React.FC<GameShellProps> = ({
  roomId,
  roomCode,
  gameTitle,
  gameStatus = 'loading',
  onConfirmExit,
  children,
}) => {
  const [showExitDialog, setShowExitDialog] = useState<boolean>(false);
  const [isExiting, setIsExiting] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(() => !sounds.enabled);

  const isExitingRef = useRef<boolean>(false);
  const roomIdRef = useRef<string>(roomId);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  const toggleSound = useCallback(() => {
    sounds.enabled = !sounds.enabled;
    setIsMuted(!sounds.enabled);
    if (sounds.enabled) {
      sounds.playClick();
    }
  }, []);

  const requestExit = useCallback(() => {
    if (isExitingRef.current) return;
    sounds.playClick();
    setShowExitDialog(true);
  }, []);

  const handleContinuePlaying = useCallback(() => {
    if (isExitingRef.current) return;
    sounds.playClick();
    setShowExitDialog(false);
  }, []);

  const handleConfirmExit = useCallback(async () => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;
    setIsExiting(true);
    sounds.playClick();

    try {
      // Clear history guard state cleanly before unmounting GameShell
      if (typeof window !== 'undefined' && window.history.state?.__childVibesGameLock) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      await onConfirmExit();
    } finally {
      isExitingRef.current = false;
      setIsExiting(false);
      setShowExitDialog(false);
    }
  }, [onConfirmExit]);

  // Navigation Lock: Intercept Browser / Android Hardware Back Button (`popstate`)
  useEffect(() => {
    if (typeof window === 'undefined' || !roomId) return;

    // Push a single history guard entry per active roomId (safe under React StrictMode)
    if (window.history.state?.__childVibesGameLock !== roomId) {
      window.history.pushState(
        { __childVibesGameLock: roomId },
        document.title,
        window.location.pathname
      );
    }

    const handlePopState = () => {
      if (isExitingRef.current) return;
      // Restore guard state immediately so the browser never navigates away from the game screen
      window.history.pushState(
        { __childVibesGameLock: roomIdRef.current },
        document.title,
        window.location.pathname
      );
      sounds.playClick();
      setShowExitDialog(true);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [roomId]);

  // Warn against accidental desktop tab/window close during an active match
  useEffect(() => {
    if (typeof window === 'undefined' || gameStatus !== 'playing') return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isExitingRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [gameStatus]);

  const statusLabel =
    gameStatus === 'playing'
      ? 'ကစားနေဆဲ'
      : gameStatus === 'full'
      ? 'လူစုံပြီ'
      : gameStatus === 'waiting'
      ? 'စောင့်ဆိုင်းဆဲ'
      : gameStatus === 'finished'
      ? 'ပွဲပြီးဆုံးပြီ'
      : 'ချိတ်ဆက်နေဆဲ';

  const displayCode = roomCode || roomId.replace(/^room_/, '');

  return (
    <GameShellContext.Provider value={{ requestExit, isExiting }}>
      <div className="min-h-[100dvh] bg-gradient-to-b from-amber-50/40 via-sky-50/20 to-slate-100/50 text-slate-800 flex flex-col overscroll-y-contain select-none">
        {/* Compact Dedicated Game Mode Top Bar (No Platform Nav Links) */}
        <header className="sticky top-0 z-40 w-full bg-white/95 backdrop-blur-md border-b border-slate-200/90 pt-safe shadow-xs">
          <div className="max-w-5xl mx-auto px-3 sm:px-6 h-13 flex items-center justify-between gap-3">
            {/* Left Zone: Game Title & Room Code */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-black text-slate-900 text-sm sm:text-base truncate">
                {gameTitle}
              </span>
              {displayCode && (
                <>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="font-mono font-bold text-xs sm:text-sm text-amber-700 whitespace-nowrap shrink-0">
                    #{displayCode}
                  </span>
                </>
              )}
              <span aria-hidden="true" className="text-slate-300 hidden sm:inline">
                ·
              </span>
              <span className="text-xs font-semibold text-slate-500 hidden sm:inline whitespace-nowrap shrink-0">
                {statusLabel}
              </span>
            </div>

            {/* Right Zone: Sound Toggle + Dedicated Exit Game Button */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={toggleSound}
                className="min-h-[40px] min-w-[40px] p-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-600 hover:text-slate-900 flex items-center justify-center transition cursor-pointer"
                title={isMuted ? 'အသံဖွင့်မည်' : 'အသံပိတ်မည်'}
                aria-label={isMuted ? 'အသံဖွင့်မည်' : 'အသံပိတ်မည်'}
              >
                {isMuted ? (
                  <VolumeX className="w-4 h-4 text-rose-500" />
                ) : (
                  <Volume2 className="w-4 h-4 text-amber-600" />
                )}
              </button>

              <button
                type="button"
                onClick={requestExit}
                disabled={isExiting}
                className="min-h-[40px] px-3 sm:px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 active:scale-[0.98] border border-rose-200 text-rose-700 font-bold text-xs sm:text-sm flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>ဂိမ်းမှ ထွက်ရန်</span>
              </button>
            </div>
          </div>
        </header>

        {/* Active Mini-Game Surface */}
        <main className="flex-1 w-full max-w-5xl mx-auto px-2 sm:px-4 py-2 sm:py-3 pb-safe-game flex flex-col justify-start">
          {children}
        </main>

        {/* Myanmar Exit Confirmation Dialog */}
        <ExitConfirmModal
          isOpen={showExitDialog}
          gameStatus={gameStatus}
          isExiting={isExiting}
          onContinuePlaying={handleContinuePlaying}
          onConfirmExit={handleConfirmExit}
        />
      </div>
    </GameShellContext.Provider>
  );
};
