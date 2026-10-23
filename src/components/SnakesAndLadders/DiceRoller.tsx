import React, { useState, useEffect, useRef } from 'react';
import { sounds } from '../../lib/sound';
import { Dices, Sparkles, User, Clock, AlertTriangle } from 'lucide-react';
import { RoomPlayer } from '../../types';

interface DiceRollerProps {
  isMyTurn: boolean;
  currentTurnPlayer: RoomPlayer | undefined;
  lastDiceRoll: number;
  lastMoveSummary: string;
  onRollDice: () => Promise<number | undefined>;
  disabled: boolean;
  diceSkin?: string;
  turnDeadline?: number;
  onTimeout?: () => void;
}

export const DiceRoller: React.FC<DiceRollerProps> = ({
  isMyTurn,
  currentTurnPlayer,
  lastDiceRoll,
  lastMoveSummary,
  onRollDice,
  disabled,
  diceSkin = 'dice_classic',
  turnDeadline = 0,
  onTimeout,
}) => {
  const [isRolling, setIsRolling] = useState(false);
  const [displayRoll, setDisplayRoll] = useState(lastDiceRoll || 1);
  const [secondsLeft, setSecondsLeft] = useState<number>(30);
  const rollIntervalRef = useRef<any>(null);

  // Clear interval on unmount
  useEffect(() => {
    return () => {
      if (rollIntervalRef.current) {
        clearInterval(rollIntervalRef.current);
      }
    };
  }, []);

  // Synchronize 30-Second Countdown with server turnDeadline
  useEffect(() => {
    if (!turnDeadline || turnDeadline <= 0) {
      setSecondsLeft(30);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const diffMs = turnDeadline - now;
      const secs = Math.max(0, Math.ceil(diffMs / 1000));
      setSecondsLeft(secs);

      if (secs <= 0 && isMyTurn && !isRolling && !disabled) {
        if (onTimeout) {
          onTimeout();
        }
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 500);
    return () => clearInterval(interval);
  }, [turnDeadline, isMyTurn, isRolling, disabled, onTimeout]);

  // Keep display roll synced with lastDiceRoll from room state when not rolling
  useEffect(() => {
    if (lastDiceRoll && !isRolling) {
      setDisplayRoll(lastDiceRoll);
    }
  }, [lastDiceRoll, isRolling]);

  const handleRollClick = async () => {
    if (!isMyTurn || isRolling || disabled) return;
    setIsRolling(true);
    sounds.playDiceRoll();

    // Visual dice cycling animation
    if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
    rollIntervalRef.current = setInterval(() => {
      setDisplayRoll(Math.floor(Math.random() * 6) + 1);
    }, 55);

    const animStart = Date.now();
    try {
      // Execute authoritative roll via Firebase transaction
      const confirmedRoll = await onRollDice();

      // Ensure smooth tumbling visual for at least 600ms
      const elapsed = Date.now() - animStart;
      if (elapsed < 600) {
        await new Promise((resolve) => setTimeout(resolve, 600 - elapsed));
      }

      if (rollIntervalRef.current) {
        clearInterval(rollIntervalRef.current);
        rollIntervalRef.current = null;
      }

      if (typeof confirmedRoll === 'number' && confirmedRoll >= 1 && confirmedRoll <= 6) {
        setDisplayRoll(confirmedRoll);
      } else if (lastDiceRoll) {
        setDisplayRoll(lastDiceRoll);
      }
    } catch (err) {
      if (rollIntervalRef.current) {
        clearInterval(rollIntervalRef.current);
        rollIntervalRef.current = null;
      }
      setDisplayRoll(lastDiceRoll || 1);
    } finally {
      setIsRolling(false);
    }
  };

  // Dice dot patterns
  const renderDots = (value: number) => {
    switch (value) {
      case 1:
        return (
          <div className="w-full h-full flex items-center justify-center">
            <span className="w-4 h-4 rounded-full bg-current" />
          </div>
        );
      case 2:
        return (
          <div className="w-full h-full flex justify-between p-1.5">
            <span className="w-3 h-3 rounded-full bg-current self-start" />
            <span className="w-3 h-3 rounded-full bg-current self-end" />
          </div>
        );
      case 3:
        return (
          <div className="w-full h-full flex justify-between p-1.5">
            <span className="w-3 h-3 rounded-full bg-current self-start" />
            <span className="w-3 h-3 rounded-full bg-current self-center" />
            <span className="w-3 h-3 rounded-full bg-current self-end" />
          </div>
        );
      case 4:
        return (
          <div className="w-full h-full grid grid-cols-2 p-1.5 place-content-between place-items-center">
            <span className="w-2.5 h-2.5 rounded-full bg-current" />
            <span className="w-2.5 h-2.5 rounded-full bg-current" />
            <span className="w-2.5 h-2.5 rounded-full bg-current" />
            <span className="w-2.5 h-2.5 rounded-full bg-current" />
          </div>
        );
      case 5:
        return (
          <div className="w-full h-full relative p-1.5">
            <div className="absolute top-1.5 left-1.5 w-2.5 h-2.5 rounded-full bg-current" />
            <div className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-current" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-current" />
            <div className="absolute bottom-1.5 left-1.5 w-2.5 h-2.5 rounded-full bg-current" />
            <div className="absolute bottom-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-current" />
          </div>
        );
      case 6:
      default:
        return (
          <div className="w-full h-full grid grid-cols-2 grid-rows-3 p-1.5 place-content-between place-items-center">
            <span className="w-2.5 h-2.5 rounded-full bg-current" />
            <span className="w-2.5 h-2.5 rounded-full bg-current" />
            <span className="w-2.5 h-2.5 rounded-full bg-current" />
            <span className="w-2.5 h-2.5 rounded-full bg-current" />
            <span className="w-2.5 h-2.5 rounded-full bg-current" />
            <span className="w-2.5 h-2.5 rounded-full bg-current" />
          </div>
        );
    }
  };

  const getDiceSkinStyle = () => {
    if (diceSkin === 'dice_gold') {
      return 'bg-gradient-to-tr from-yellow-500 via-amber-400 to-amber-200 text-amber-950 border-2 border-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.6)]';
    }
    if (diceSkin === 'dice_ruby') {
      return 'bg-gradient-to-tr from-rose-700 via-red-600 to-rose-400 text-white border-2 border-rose-300 shadow-[0_0_20px_rgba(225,29,72,0.6)]';
    }
    // Classic white
    return 'bg-slate-50 text-slate-900 border-2 border-slate-300 shadow-lg';
  };

  const isLowTime = secondsLeft <= 8;

  return (
    <div className="w-full bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs backdrop-blur-md">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left: Active Player Banner & Turn indicator */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative">
            <div
              className="w-12 h-12 rounded-full border-2 border-white shadow-md flex items-center justify-center overflow-hidden"
              style={{ backgroundColor: currentTurnPlayer?.color || '#3B82F6' }}
            >
              {currentTurnPlayer?.photoURL ? (
                <img
                  src={currentTurnPlayer.photoURL}
                  alt={currentTurnPlayer.displayName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-6 h-6 text-white" />
              )}
            </div>
            {isMyTurn && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white animate-ping" />
            )}
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500 flex items-center gap-2">
              <span>လက်ရှိအလှည့်</span>
              {/* 30s Countdown Badge */}
              <div
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-bold transition-colors ${
                  isLowTime
                    ? 'bg-rose-100 text-rose-800 border border-rose-300 animate-pulse'
                    : 'bg-amber-100 text-amber-900 border border-amber-300'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>{secondsLeft}s ကျန်</span>
              </div>
            </div>

            <div className="text-base font-bold text-slate-900 flex items-center gap-2 mt-0.5">
              <span>{currentTurnPlayer?.displayName || 'ကစားသမား'}</span>
              {isMyTurn ? (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 font-black shadow-xs">
                  သင့်အလှည့်ဖြစ်ပါသည်
                </span>
              ) : (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  {currentTurnPlayer?.displayName} ခေါက်နေဆဲ
                </span>
              )}
            </div>

            <div className="text-xs text-slate-500">
              လက်ရှိနေရာ: <span className="text-amber-700 font-bold">အကွက် {currentTurnPlayer?.position || 1}</span> / ၁၀၀
            </div>
          </div>
        </div>

        {/* Center: 3D Dice Display & Roll Action Button */}
        <div className="flex items-center gap-4 w-full md:w-auto justify-center">
          {/* 3D Dice Box */}
          <div
            className={`w-16 h-16 rounded-xl flex items-center justify-center transform transition-transform duration-200 select-none ${getDiceSkinStyle()} ${
              isRolling ? 'rotate-180 scale-110' : 'hover:scale-105'
            }`}
          >
            {renderDots(displayRoll)}
          </div>

          {/* Roll Button */}
          <button
            onClick={handleRollClick}
            disabled={!isMyTurn || isRolling || disabled}
            className={`px-6 py-3.5 rounded-xl font-black text-sm md:text-base flex items-center gap-2 transition-all duration-200 ${
              isMyTurn && !isRolling && !disabled
                ? 'bg-amber-400 hover:bg-amber-500 text-slate-950 shadow-sm hover:scale-105 cursor-pointer active:scale-95 animate-pulse'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
            }`}
          >
            <Dices className={`w-5 h-5 ${isRolling ? 'animate-spin' : ''}`} />
            <span>
              {isRolling
                ? 'အံစာတုံး လှည့်နေသည်...'
                : isMyTurn
                ? `အံစာတုံး ခေါက်မည် (${secondsLeft}s)`
                : `စောင့်ဆိုင်းပါ (${currentTurnPlayer?.displayName || 'အခြားသူ'} အလှည့်)`}
            </span>
          </button>
        </div>
      </div>

      {/* Live Event Announcer Banner */}
      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2 text-xs md:text-sm text-slate-600">
        <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
        <span className="truncate">{lastMoveSummary || 'ဂိမ်းစတင်ရန် အံစာတုံးခေါက်ပါ'}</span>
      </div>
    </div>
  );
};
