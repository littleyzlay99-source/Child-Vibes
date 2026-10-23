import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { sounds } from '../../lib/sound';
import { Trophy, Award, Sparkles, RotateCcw, LogOut, ArrowUpCircle } from 'lucide-react';
import { RoomPlayer } from '../../types';

interface VictoryModalProps {
  winner: RoomPlayer | undefined;
  isHost: boolean;
  isCurrentUserWinner: boolean;
  pointsEarned: number;
  xpEarned: number;
  leveledUp: boolean;
  newLevel?: number;
  onPlayAgain: () => void;
  onLeaveRoom: () => void;
}

export const VictoryModal: React.FC<VictoryModalProps> = ({
  winner,
  isHost,
  isCurrentUserWinner,
  pointsEarned,
  xpEarned,
  leveledUp,
  newLevel,
  onPlayAgain,
  onLeaveRoom,
}) => {
  useEffect(() => {
    sounds.playVictory();
    // Confetti cannon
    const end = Date.now() + 2.5 * 1000;
    const colors = ['#F59E0B', '#EF4444', '#10B981', '#3B82F6', '#8B5CF6'];

    (function frame() {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors,
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors,
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    })();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-300">
      <div className="bg-white border-2 border-amber-300 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl text-center relative overflow-hidden text-slate-800">
        {/* Glow behind trophy */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-amber-200/30 rounded-full blur-3xl pointer-events-none" />

        {/* Trophy Icon */}
        <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-amber-100 border-2 border-amber-400 text-amber-600 mb-4 shadow-md shadow-amber-300/30 animate-bounce">
          <Trophy className="w-10 h-10" />
        </div>

        <h2 className="text-2xl md:text-3xl font-black text-slate-900 mb-1">
          {isCurrentUserWinner ? 'ဂုဏ်ယူပါသည်! သင် အနိုင်ရပါသည်!' : 'ဂိမ်းပွဲပြီးဆုံးပါပြီ!'}
        </h2>
        <p className="text-sm text-slate-600 mb-4">
          <span className="text-amber-700 font-bold">{winner?.displayName || 'ကစားသမား'}</span> သည်
          နံပါတ် ၁၀၀ သို့ ပထမဆုံးရောက်ရှိခဲ့ပါသည်။
        </p>

        {/* Winner Card */}
        <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4 flex items-center justify-center gap-3 mb-5">
          <div
            className="w-14 h-14 rounded-full border-2 border-amber-400 overflow-hidden shadow-xs"
            style={{ backgroundColor: winner?.color || '#F59E0B' }}
          >
            {winner?.photoURL ? (
              <img src={winner.photoURL} alt={winner.displayName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white font-bold text-xl">
                {winner?.displayName.charAt(0)}
              </div>
            )}
          </div>
          <div className="text-left">
            <div className="font-bold text-slate-900 text-base">{winner?.displayName}</div>
            <div className="text-xs text-amber-800 font-mono">ID: {winner?.playerId}</div>
            <div className="text-[11px] text-emerald-700 font-semibold">🏆 ချန်ပီယံဆုရှင်</div>
          </div>
        </div>

        {/* Rewards Earned */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-col items-center">
            <Sparkles className="w-5 h-5 text-amber-600 mb-1" />
            <div className="text-xs text-slate-500">ရွှေဒင်္ဂါး ရရှိမှု</div>
            <div className="text-lg font-black text-amber-800">+{pointsEarned} ဒင်္ဂါး</div>
          </div>
          <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 flex flex-col items-center">
            <Award className="w-5 h-5 text-sky-600 mb-1" />
            <div className="text-xs text-slate-500">အတွေ့အကြုံ (XP)</div>
            <div className="text-lg font-black text-sky-800">+{xpEarned} XP</div>
          </div>
        </div>

        {/* Level Up Banner if applicable */}
        {leveledUp && (
          <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-3 mb-5 flex items-center gap-3 text-left">
            <ArrowUpCircle className="w-8 h-8 text-emerald-600 shrink-0 animate-bounce" />
            <div>
              <div className="text-xs text-emerald-800 font-semibold">LEVEL တက်လှမ်းပါပြီ!</div>
              <div className="text-sm font-black text-slate-900">
                ဂုဏ်ယူပါသည်! အဆင့် Level {newLevel} သို့ ရောက်ရှိသွားပါပြီ!
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          {isHost ? (
            <button
              onClick={onPlayAgain}
              className="flex-1 py-3 px-4 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>နောက်တစ်ပွဲ ပြန်ကစားမည်</span>
            </button>
          ) : (
            <div className="flex-1 py-3 px-4 rounded-xl bg-slate-100 text-slate-500 text-xs flex items-center justify-center">
              Host မှ နောက်တစ်ပွဲ စတင်ရန် စောင့်ဆိုင်းပါ...
            </div>
          )}

          <button
            onClick={onLeaveRoom}
            className="py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm flex items-center justify-center gap-2 transition cursor-pointer border border-slate-200"
          >
            <LogOut className="w-4 h-4" />
            <span>အခန်းမှ ထွက်မည်</span>
          </button>
        </div>
      </div>
    </div>
  );
};
