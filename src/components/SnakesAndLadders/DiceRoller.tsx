import React, { useState } from 'react';
import { sounds } from '../../lib/sound';
import { Dices, Sparkles, User, Trophy } from 'lucide-react';
import { RoomPlayer } from '../../types';

interface DiceRollerProps {
  isMyTurn: boolean;
  currentTurnPlayer: RoomPlayer | undefined;
  lastDiceRoll: number;
  lastMoveSummary: string;
  onRollDice: (rollResult: number) => Promise<void>;
  disabled: boolean;
  diceSkin?: string;
}

export const DiceRoller: React.FC<DiceRollerProps> = ({
  isMyTurn,
  currentTurnPlayer,
  lastDiceRoll,
  lastMoveSummary,
  onRollDice,
  disabled,
  diceSkin = 'dice_classic',
}) => {
  const [isRolling, setIsRolling] = useState(false);
  const [displayRoll, setDisplayRoll] = useState(lastDiceRoll || 1);

  const handleRollClick = async () => {
    if (!isMyTurn || isRolling || disabled) return;
    setIsRolling(true);
    sounds.playDiceRoll();

    // Roll animation with random faces
    let rollCount = 0;
    const interval = setInterval(() => {
      setDisplayRoll(Math.floor(Math.random() * 6) + 1);
      rollCount++;
      if (rollCount > 10) {
        clearInterval(interval);
        const finalRoll = Math.floor(Math.random() * 6) + 1;
        setDisplayRoll(finalRoll);
        setIsRolling(false);
        onRollDice(finalRoll);
      }
    }, 70);
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

  return (
    <div className="w-full bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm backdrop-blur-md">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left: Current Turn Info */}
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
            <div className="text-xs font-semibold text-slate-500">လက်ရှိအလှည့်</div>
            <div className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>{currentTurnPlayer?.displayName || 'ကစားသမား'}</span>
              {isMyTurn && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold">
                  သင့်အလှည့်ဖြစ်ပါသည်
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500">
              လက်ရှိနေရာ: <span className="text-amber-700 font-bold">အကွက် {currentTurnPlayer?.position || 1}</span> / ၁၀၀
            </div>
          </div>
        </div>

        {/* Center: Dice Display & Roll Action */}
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
            className={`px-6 py-3.5 rounded-xl font-bold text-sm md:text-base flex items-center gap-2 transition-all duration-200 ${
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
                ? 'အံစာတုံး ခေါက်မည်'
                : 'စောင့်ဆိုင်းပါ...'}
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
