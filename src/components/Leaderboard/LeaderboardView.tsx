import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { UserProfile } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { SHOP_CATALOG } from '../../config/gameRules';
import {
  deriveLevelProgress,
  normalizeUserProfile,
  sortLevelLeaderboard,
  sortPointLeaderboard,
} from '../../services/progressionService';
import {
  fetchLevelLeaderboard,
  fetchPointLeaderboard,
} from '../../services/rewardService';
import { sounds } from '../../lib/sound';
import {
  Crown,
  Coins,
  Shield,
  RefreshCw,
  Award,
  Sparkles,
} from 'lucide-react';

type LeaderboardTab = 'level' | 'points';

export const LeaderboardView: React.FC = () => {
  const { userProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<LeaderboardTab>('level');
  const [rawLeaders, setRawLeaders] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const loadLeaderboard = useCallback(
    async (tab: LeaderboardTab, forceRefresh: boolean = false) => {
      if (forceRefresh) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const result =
          tab === 'level'
            ? await fetchLevelLeaderboard(50, forceRefresh)
            : await fetchPointLeaderboard(50, forceRefresh);
        setRawLeaders(result);
      } catch (err) {
        console.error('Leaderboard load error:', err);
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    []
  );

  // Reload whenever tab changes or signed-in player's progression changes after a match
  useEffect(() => {
    loadLeaderboard(activeTab, false);
  }, [
    activeTab,
    loadLeaderboard,
    userProfile?.level,
    userProfile?.totalXp,
    userProfile?.totalPointsEarned,
  ]);

  // Merge current signed-in player's latest normalized profile so recent rewards reflect immediately
  const leaders = useMemo(() => {
    const byId = new Map<string, UserProfile>();
    for (const entry of rawLeaders) {
      const norm = normalizeUserProfile(entry, entry.id);
      byId.set(norm.id, norm);
    }
    if (userProfile?.id) {
      const myNorm = normalizeUserProfile(userProfile, userProfile.id);
      byId.set(myNorm.id, myNorm);
    }
    const merged = Array.from(byId.values());
    return activeTab === 'level'
      ? sortLevelLeaderboard(merged).slice(0, 50)
      : sortPointLeaderboard(merged).slice(0, 50);
  }, [rawLeaders, userProfile, activeTab]);

  const myRankIndex = useMemo(() => {
    if (!userProfile?.id) return -1;
    return leaders.findIndex((p) => p.id === userProfile.id);
  }, [leaders, userProfile?.id]);

  const topThree = leaders.slice(0, 3);
  const restOfLeaders = leaders.slice(3);

  const getFrameBorder = (activeFrame?: string) => {
    const found = SHOP_CATALOG.find((item) => item.id === activeFrame);
    return found?.previewBorder || 'border-2 border-slate-200';
  };

  const handleManualRefresh = () => {
    if (isRefreshing || loading) return;
    sounds.playClick();
    loadLeaderboard(activeTab, true);
  };

  const renderPodiumCard = (player: UserProfile, rank: 1 | 2 | 3) => {
    const prog = deriveLevelProgress(player.totalXp ?? 0);
    const totalEarned = player.totalPointsEarned ?? player.points ?? 0;
    const isMe = player.id === userProfile?.id;
    const isFirst = rank === 1;
    const isSecond = rank === 2;

    const cardClasses = isFirst
      ? 'bg-gradient-to-b from-amber-50 via-white to-white border-2 border-amber-400 rounded-3xl p-5 sm:p-6 flex flex-col items-center text-center order-1 sm:order-2 shadow-md relative sm:-translate-y-3'
      : isSecond
      ? 'bg-white border border-slate-200 rounded-3xl p-5 flex flex-col items-center text-center order-2 sm:order-1 shadow-sm relative'
      : 'bg-white border border-amber-200 rounded-3xl p-5 flex flex-col items-center text-center order-3 sm:order-3 shadow-sm relative';

    const rankBadgeClasses = isFirst
      ? 'w-10 h-10 rounded-full bg-amber-400 text-slate-950 font-black flex items-center justify-center text-sm absolute -top-5 shadow-md border-2 border-white'
      : isSecond
      ? 'w-8 h-8 rounded-full bg-slate-200 text-slate-800 font-black flex items-center justify-center text-sm absolute -top-4 shadow-sm border-2 border-white'
      : 'w-8 h-8 rounded-full bg-amber-200 text-amber-900 font-black flex items-center justify-center text-sm absolute -top-4 shadow-sm border-2 border-white';

    return (
      <div key={player.id} className={cardClasses}>
        <div className={rankBadgeClasses}>{isFirst ? '👑 1' : rank}</div>

        {/* Player Avatar */}
        <div
          className={`${
            isFirst ? 'w-22 h-22' : 'w-18 h-18'
          } rounded-2xl p-0.5 overflow-hidden mb-3 mt-2 shadow-sm ${getFrameBorder(
            player.activeFrame
          )}`}
        >
          <img
            src={
              player.photoURL ||
              `https://api.dicebear.com/7.x/bottts/svg?seed=${player.id}`
            }
            alt={player.displayName}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover rounded-xl bg-slate-100"
          />
        </div>

        {/* Player Name & ID */}
        <div className="font-black text-slate-900 text-base truncate max-w-[180px]">
          {player.displayName}{' '}
          {isMe && <span className="text-amber-600 text-xs font-bold">(သင်)</span>}
        </div>
        <div className="text-xs font-mono text-slate-500 font-semibold mb-3">
          {player.playerId}
        </div>

        {/* Metric Display (Strictly Separated by Active Tab) */}
        {activeTab === 'level' ? (
          <div className="w-full space-y-2">
            <div className="flex items-center justify-center gap-1.5 flex-wrap">
              <span
                className={`px-3 py-1 rounded-xl text-xs font-black inline-flex items-center gap-1 ${
                  isFirst
                    ? 'bg-amber-400 text-slate-950 shadow-xs'
                    : 'bg-slate-100 text-slate-800 border border-slate-200'
                }`}
              >
                <Shield className="w-3.5 h-3.5 fill-current" />
                <span>Level {prog.level}</span>
              </span>
              {prog.isMaxLevel && (
                <span className="px-2 py-0.5 rounded-lg bg-slate-900 text-amber-300 text-[10px] font-black tracking-wider">
                  MAX LEVEL
                </span>
              )}
            </div>

            <div className="w-full bg-slate-50 border border-slate-200/80 rounded-xl p-2 space-y-1">
              <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-600 tabular-nums">
                <span>
                  {prog.isMaxLevel
                    ? 'MAX LEVEL'
                    : `${prog.currentLevelXp} / ${prog.xpForNextLevel} XP`}
                </span>
                <span>{prog.progressPercent}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-emerald-400 rounded-full"
                  style={{ width: `${prog.isMaxLevel ? 100 : prog.progressPercent}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-slate-500 tabular-nums">
                စုစုပေါင်း {prog.totalXp.toLocaleString()} XP
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full bg-amber-50/80 border border-amber-200 rounded-xl py-2 px-3">
            <div className="text-[10px] text-slate-500 font-semibold">စုစုပေါင်း ရရှိထားသော အမှတ်</div>
            <div className="text-sm sm:text-base font-mono font-black text-amber-800 tabular-nums flex items-center justify-center gap-1 mt-0.5">
              <Coins className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{totalEarned.toLocaleString()} Points</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      {/* Leaderboard Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 bg-white border border-slate-200/90 rounded-3xl p-5 sm:p-6 shadow-xs">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold">
            <Crown className="w-3.5 h-3.5 fill-current" />
            <span>ဂုဏ်ပြုဦးဆောင်သူများ ဇယား</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-900">
            ပလက်ဖောင်း ထိပ်တန်းကစားသမားများ
          </h1>
          <p className="text-xs md:text-sm text-slate-600">
            {activeTab === 'level'
              ? 'အမြင့်ဆုံး Level အလိုက် စီစဉ်ထားပါသည် (Level တူညီပါက စုစုပေါင်း Total XP ပိုများသူ ဦးစားပေးသည်)'
              : 'စုစုပေါင်း ရှာဖွေရရှိခဲ့သော အမှတ် (Total Points Earned) အလိုက် စီစဉ်ထားပါသည် — ဆိုင်တွင် ပစ္စည်းဝယ်ယူသော်လည်း အမှတ်မလျော့ပါ'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleManualRefresh}
          disabled={loading || isRefreshing}
          className="self-start sm:self-auto min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>ပြန်လည်ရယူမည်</span>
        </button>
      </div>

      {/* Strictly Separated Dual Leaderboard Tabs (Mobile & Desktop Friendly) */}
      <div className="bg-white p-1.5 rounded-2xl border border-slate-200 grid grid-cols-2 gap-1.5 shadow-xs">
        <button
          type="button"
          onClick={() => {
            sounds.playClick();
            setActiveTab('level');
          }}
          className={`min-h-[46px] px-3 sm:px-5 py-2.5 rounded-xl text-xs sm:text-sm font-black flex items-center justify-center gap-2 transition cursor-pointer ${
            activeTab === 'level'
              ? 'bg-amber-400 text-slate-950 shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Shield className="w-4 h-4 shrink-0" />
          <span>Level Leaderboard</span>
        </button>

        <button
          type="button"
          onClick={() => {
            sounds.playClick();
            setActiveTab('points');
          }}
          className={`min-h-[46px] px-3 sm:px-5 py-2.5 rounded-xl text-xs sm:text-sm font-black flex items-center justify-center gap-2 transition cursor-pointer ${
            activeTab === 'points'
              ? 'bg-amber-400 text-slate-950 shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Coins className="w-4 h-4 shrink-0" />
          <span>Point Leaderboard</span>
        </button>
      </div>

      {/* Signed-in User's Own Standing Summary Strip */}
      {userProfile && !loading && (
        <div className="bg-amber-50/80 border border-amber-300/90 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 font-mono font-black">
              {myRankIndex >= 0 ? `#${myRankIndex + 1}` : 'Top 50 ပြင်ပ'}
            </span>
            <div>
              <div className="font-black text-slate-900 text-sm">
                သင်၏ လက်ရှိအဆင့် · {userProfile.displayName}
              </div>
              <div className="font-mono text-slate-600 text-[11px]">{userProfile.playerId}</div>
            </div>
          </div>

          {activeTab === 'level' ? (
            <div className="flex items-center gap-2 font-mono font-black text-slate-900">
              <Award className="w-4 h-4 text-amber-600" />
              <span>Level {userProfile.level}</span>
              {userProfile.level >= 999 && (
                <span className="px-2 py-0.5 rounded-md bg-slate-900 text-amber-300 text-[10px]">
                  MAX LEVEL
                </span>
              )}
              <span className="text-slate-500 font-semibold">
                ({(userProfile.totalXp ?? 0).toLocaleString()} XP)
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 font-mono font-black text-amber-800 text-sm">
              <Sparkles className="w-4 h-4 text-amber-600" />
              <span>
                {(userProfile.totalPointsEarned ?? userProfile.points ?? 0).toLocaleString()} Points
              </span>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-500 text-xs">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mb-3" />
          <span>အဆင့်သတ်မှတ်ချက်များ ရယူနေပါသည်...</span>
        </div>
      ) : leaders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-3xl text-center py-16 text-slate-500 text-sm">
          ကစားသမား မှတ်တမ်းများ မရှိသေးပါ။
        </div>
      ) : (
        <>
          {/* Top 3 Podium Cards */}
          {topThree.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5 items-end">
              {topThree[1] && renderPodiumCard(topThree[1], 2)}
              {topThree[0] && renderPodiumCard(topThree[0], 1)}
              {topThree[2] && renderPodiumCard(topThree[2], 3)}
            </div>
          )}

          {/* Ranked List (#4+) */}
          {restOfLeaders.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
              <div className="divide-y divide-slate-100">
                {restOfLeaders.map((player, idx) => {
                  const rank = idx + 4;
                  const isMe = player.id === userProfile?.id;
                  const prog = deriveLevelProgress(player.totalXp ?? 0);
                  const totalEarned = player.totalPointsEarned ?? player.points ?? 0;

                  return (
                    <div
                      key={player.id}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:px-6 transition ${
                        isMe
                          ? 'bg-amber-50/70 border-l-4 border-amber-400'
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <span className="w-8 font-mono font-black text-slate-500 text-sm tabular-nums shrink-0">
                          #{rank}
                        </span>
                        <div
                          className={`w-11 h-11 rounded-xl p-0.5 overflow-hidden bg-slate-100 shrink-0 ${getFrameBorder(
                            player.activeFrame
                          )}`}
                        >
                          <img
                            src={
                              player.photoURL ||
                              `https://api.dicebear.com/7.x/bottts/svg?seed=${player.id}`
                            }
                            alt={player.displayName}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover rounded-lg"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 text-sm truncate">
                            {player.displayName}{' '}
                            {isMe && <span className="text-amber-600 text-xs">(သင်)</span>}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {player.playerId}
                          </div>
                        </div>
                      </div>

                      {activeTab === 'level' ? (
                        <div className="flex items-center justify-between sm:justify-end gap-4 pl-11 sm:pl-0">
                          <div className="w-36 sm:w-44 space-y-1">
                            <div className="flex items-center justify-between text-[10px] font-mono text-slate-600 tabular-nums">
                              <span>
                                {prog.isMaxLevel
                                  ? 'MAX LEVEL'
                                  : `${prog.currentLevelXp}/${prog.xpForNextLevel} XP`}
                              </span>
                              <span>{prog.totalXp.toLocaleString()} XP</span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-amber-400 to-emerald-400 rounded-full"
                                style={{
                                  width: `${prog.isMaxLevel ? 100 : prog.progressPercent}%`,
                                }}
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-950 font-mono font-black text-xs tabular-nums">
                              Lv.{prog.level}
                            </span>
                            {prog.isMaxLevel && (
                              <span className="px-2 py-0.5 rounded-md bg-slate-900 text-amber-300 font-black text-[10px]">
                                MAX LEVEL
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5 pl-11 sm:pl-0 font-mono font-black text-amber-800 text-sm tabular-nums">
                          <Coins className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>{totalEarned.toLocaleString()} Points</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
