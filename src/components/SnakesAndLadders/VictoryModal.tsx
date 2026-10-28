import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { sounds } from '../../lib/sound';
import {
  Trophy,
  Award,
  Sparkles,
  RotateCcw,
  LogOut,
  ArrowUpCircle,
  Shield,
  Crown,
} from 'lucide-react';
import { LevelProgressInfo, MatchRewardResult, RoomPlayer } from '../../types';
import { REWARD_CONFIG } from '../../config/rewardConfig';

interface VictoryModalProps {
  winner: RoomPlayer | undefined;
  isHost: boolean;
  isCurrentUserWinner: boolean;
  rewardResult: MatchRewardResult | null;
  fallbackProgress: LevelProgressInfo;
  isClaimingReward?: boolean;
  onPlayAgain: () => void;
  onLeaveRoom: () => void;
}

export const VictoryModal: React.FC<VictoryModalProps> = ({
  winner,
  isHost,
  isCurrentUserWinner,
  rewardResult,
  fallbackProgress,
  isClaimingReward = false,
  onPlayAgain,
  onLeaveRoom,
}) => {
  useEffect(() => {
    sounds.playVictory();
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

  const expectedReward = isCurrentUserWinner
    ? REWARD_CONFIG.MATCH_WIN
    : REWARD_CONFIG.MATCH_LOSS;

  const displayedPointsEarned = rewardResult ? rewardResult.pointsEarned : expectedReward.points;
  const displayedXpEarned = rewardResult ? rewardResult.xpEarned : expectedReward.xp;

  const currentLevel = rewardResult ? rewardResult.newLevel : fallbackProgress.level;
  const isMaxLevel = rewardResult ? rewardResult.isMaxLevel : fallbackProgress.isMaxLevel;
  const currentLevelXp = rewardResult
    ? rewardResult.currentLevelXp
    : fallbackProgress.currentLevelXp;
  const xpForNextLevel = rewardResult
    ? rewardResult.xpForNextLevel
    : fallbackProgress.xpForNextLevel;
  const xpRemaining = rewardResult
    ? rewardResult.xpRemainingForNextLevel
    : fallbackProgress.xpRemainingForNextLevel;
  const progressPercent = rewardResult
    ? rewardResult.progressPercent
    : fallbackProgress.progressPercent;
  const totalXp = rewardResult ? rewardResult.totalXp : fallbackProgress.totalXp;
  const leveledUp = rewardResult?.leveledUp || false;
  const previousLevel = rewardResult?.previousLevel || currentLevel;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-300 overflow-y-auto">
      <div className="bg-white border-2 border-amber-300 rounded-3xl p-5 sm:p-7 max-w-md w-full shadow-2xl text-center relative overflow-hidden text-slate-800 my-auto">
        {/* Glow behind trophy */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-amber-200/30 rounded-full blur-3xl pointer-events-none" />

        {/* Trophy Icon */}
        <div className="relative inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-amber-100 border-2 border-amber-400 text-amber-600 mb-3 shadow-md shadow-amber-300/30 animate-bounce">
          <Trophy className="w-8 h-8 sm:w-10 sm:h-10" />
        </div>

        <h2 className="text-xl sm:text-2xl font-black text-slate-900 mb-1">
          {isCurrentUserWinner ? 'ဂုဏ်ယူပါသည်! သင် အနိုင်ရပါသည်!' : 'ဂိမ်းပွဲပြီးဆုံးပါပြီ!'}
        </h2>
        <p className="text-xs sm:text-sm text-slate-600 mb-4">
          <span className="text-amber-700 font-bold">{winner?.displayName || 'ကစားသမား'}</span> သည်
          ပန်းတိုင်သို့ အောင်မြင်စွာ ရောက်ရှိခဲ့ပါသည်။
        </p>

        {/* Winner Card */}
        <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3.5 flex items-center justify-center gap-3 mb-4">
          <div
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-full border-2 border-amber-400 overflow-hidden shadow-xs shrink-0"
            style={{ backgroundColor: winner?.color || '#F59E0B' }}
          >
            {winner?.photoURL ? (
              <img
                src={winner.photoURL}
                alt={winner.displayName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white font-bold text-lg">
                {winner?.displayName?.charAt(0) || 'P'}
              </div>
            )}
          </div>
          <div className="text-left min-w-0">
            <div className="font-bold text-slate-900 text-sm sm:text-base truncate">
              {winner?.displayName}
            </div>
            <div className="text-xs text-amber-800 font-mono">ID: {winner?.playerId}</div>
            <div className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
              <Crown className="w-3.5 h-3.5 fill-current text-amber-500" />
              <span>ချန်ပီယံဆုရှင်</span>
            </div>
          </div>
        </div>

        {/* Match Reward Summary Cards (+XP & +Points) */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-sky-50 border border-sky-200 rounded-2xl p-3 flex flex-col items-center">
            <Award className="w-5 h-5 text-sky-600 mb-1" />
            <div className="text-[11px] text-slate-500 font-semibold">
              {isCurrentUserWinner ? 'အနိုင်ရ XP ဆု' : 'ပါဝင်ကစားမှု XP'}
            </div>
            <div className="text-lg sm:text-xl font-black text-sky-800 font-mono tabular-nums">
              +{displayedXpEarned.toLocaleString()} XP
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex flex-col items-center">
            <Sparkles className="w-5 h-5 text-amber-600 mb-1" />
            <div className="text-[11px] text-slate-500 font-semibold">
              {isCurrentUserWinner ? 'အနိုင်ရ Points ဆု' : 'ပါဝင်ကစားမှု Points'}
            </div>
            <div className="text-lg sm:text-xl font-black text-amber-800 font-mono tabular-nums">
              +{displayedPointsEarned.toLocaleString()} Points
            </div>
          </div>
        </div>

        {/* Level Up Banner if applicable */}
        {leveledUp && (
          <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-3 mb-4 flex items-center gap-3 text-left">
            <ArrowUpCircle className="w-7 h-7 text-emerald-600 shrink-0 animate-bounce" />
            <div>
              <div className="text-[11px] text-emerald-800 font-bold uppercase tracking-wide">
                LEVEL UP! အဆင့်တက်သွားပါပြီ
              </div>
              <div className="text-xs sm:text-sm font-black text-slate-900">
                Level {previousLevel} → Level {currentLevel}{' '}
                {isMaxLevel ? '(MAX LEVEL!)' : 'သို့ ရောက်ရှိသွားပါပြီ!'}
              </div>
            </div>
          </div>
        )}

        {/* Current Level & XP Progress Summary Box */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 mb-5 text-left space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-amber-400 text-slate-950 font-black text-xs">
                <Shield className="w-3.5 h-3.5 fill-current" />
                <span>Level {currentLevel}</span>
              </span>
              {isMaxLevel && (
                <span className="px-2 py-0.5 rounded-lg bg-slate-900 text-amber-300 font-black text-[10px] tracking-wider">
                  MAX LEVEL
                </span>
              )}
            </div>

            <span className="text-xs font-mono font-bold text-slate-700 tabular-nums">
              {isMaxLevel
                ? `စုစုပေါင်း ${totalXp.toLocaleString()} XP`
                : `${currentLevelXp.toLocaleString()} / ${xpForNextLevel.toLocaleString()} XP`}
            </span>
          </div>

          {/* XP Progress Bar */}
          <div className="w-full h-2.5 bg-slate-200/90 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-400 via-yellow-400 to-emerald-400 rounded-full transition-all duration-500"
              style={{ width: `${isMaxLevel ? 100 : progressPercent}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-600 font-medium">
            {isMaxLevel ? (
              <span className="text-emerald-700 font-bold">
                အမြင့်ဆုံးအဆင့် (Level 999) သို့ ရောက်ရှိပြီးဖြစ်ပါသည်
              </span>
            ) : (
              <span>
                နောက်တစ်ဆင့် (Level {currentLevel + 1}) တက်ရန်{' '}
                <strong className="text-amber-800 font-mono font-black">
                  {xpRemaining.toLocaleString()} XP
                </strong>{' '}
                လိုအပ်ပါသည်
              </span>
            )}
            <span className="font-mono font-bold text-slate-500 tabular-nums">
              {isClaimingReward ? 'သိမ်းဆည်းနေဆဲ...' : `${progressPercent}%`}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          {isHost ? (
            <button
              type="button"
              onClick={onPlayAgain}
              disabled={isClaimingReward}
              className="flex-1 min-h-[44px] py-3 px-4 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-xs transition cursor-pointer disabled:opacity-60"
            >
              <RotateCcw className="w-4 h-4" />
              <span>နောက်တစ်ပွဲ ပြန်ကစားမည်</span>
            </button>
          ) : (
            <div className="flex-1 min-h-[44px] py-3 px-4 rounded-xl bg-slate-100 text-slate-500 text-xs flex items-center justify-center">
              Host မှ နောက်တစ်ပွဲ စတင်ရန် စောင့်ဆိုင်းပါ...
            </div>
          )}

          <button
            type="button"
            onClick={onLeaveRoom}
            disabled={isClaimingReward}
            className="min-h-[44px] py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm flex items-center justify-center gap-2 transition cursor-pointer border border-slate-200 disabled:opacity-60"
          >
            <LogOut className="w-4 h-4" />
            <span>{isClaimingReward ? 'ခဏစောင့်ပါ...' : 'အခန်းမှ ထွက်မည်'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
