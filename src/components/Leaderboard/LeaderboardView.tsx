import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { UserProfile } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { sounds } from '../../lib/sound';
import {
  Trophy,
  Medal,
  Award,
  Crown,
  Coins,
  Shield,
  Flame,
  User,
} from 'lucide-react';

export const LeaderboardView: React.FC = () => {
  const { userProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<'wins' | 'level' | 'points'>('wins');
  const [leaders, setLeaders] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    setLoading(true);
    let orderField = 'totalWins';
    if (activeTab === 'level') orderField = 'level';
    if (activeTab === 'points') orderField = 'points';

    const usersCol = collection(db, 'users');
    const q = query(usersCol, orderBy(orderField, 'desc'), limit(25));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: UserProfile[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as UserProfile);
        });
        setLeaders(list);
        setLoading(false);
      },
      (error) => {
        console.error('Leaderboard error:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [activeTab]);

  const tabs = [
    { id: 'wins', label: 'အနိုင်ရအများဆုံး', icon: Trophy },
    { id: 'level', label: 'အဆင့်အမြင့်ဆုံး (Level)', icon: Shield },
    { id: 'points', label: 'ရွှေဒင်္ဂါးအများဆုံး', icon: Coins },
  ];

  const topThree = leaders.slice(0, 3);
  const restOfLeaders = leaders.slice(3);

  const getMetricDisplay = (u: UserProfile) => {
    if (activeTab === 'wins') return `${u.totalWins || 0} ပွဲ အနိုင်`;
    if (activeTab === 'level') return `Level ${u.level || 1} (${u.xp || 0} XP)`;
    return `${(u.points || 0).toLocaleString()} ဒင်္ဂါး`;
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      {/* Leaderboard Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-xs font-bold shadow-2xs">
          <Crown className="w-3.5 h-3.5 fill-current" />
          <span>ဂုဏ်ပြုဦးဆောင်သူများ ဇယား</span>
        </div>
        <h1 className="text-2xl md:text-3xl font-black text-slate-900">
          ပလက်ဖောင်း ထိပ်တန်းကစားသမားများ
        </h1>
        <p className="text-xs md:text-sm text-slate-600">
          အပတ်စဉ်နှင့် လစဉ် အကောင်းဆုံးကစားသမားများ၏ အဆင့်သတ်မှတ်ချက်များ
        </p>
      </div>

      {/* Tabs */}
      <div className="flex justify-center">
        <div className="bg-white p-1.5 rounded-2xl border border-slate-200 flex gap-1 shadow-xs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  sounds.playClick();
                  setActiveTab(tab.id as any);
                }}
                className={`px-4 py-2 rounded-xl text-xs md:text-sm font-bold flex items-center gap-1.5 transition cursor-pointer ${
                  isActive
                    ? 'bg-amber-400 text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-500 text-xs">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mb-3" />
          <span>အဆင့်သတ်မှတ်ချက်များ ရယူနေပါသည်...</span>
        </div>
      ) : leaders.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          ကစားသမား မှတ်တမ်းများ မရှိသေးပါ။
        </div>
      ) : (
        <>
          {/* Top 3 Podium Cards */}
          {topThree.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6 items-end">
              {/* Rank 2 (Silver) */}
              {topThree[1] && (
                <div className="bg-white border border-slate-200 rounded-3xl p-5 flex flex-col items-center text-center order-2 sm:order-1 shadow-sm relative">
                  <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-800 font-black flex items-center justify-center text-sm absolute -top-4 shadow-sm border-2 border-white">
                    2
                  </div>
                  <div className="w-20 h-20 rounded-full border-4 border-slate-300 overflow-hidden mb-3 mt-2 shadow-sm">
                    <img
                      src={topThree[1].photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${topThree[1].id}`}
                      alt={topThree[1].displayName}
                      className="w-full h-full object-cover bg-slate-100"
                    />
                  </div>
                  <div className="font-bold text-slate-900 text-base truncate max-w-[150px]">
                    {topThree[1].displayName}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mb-2">{topThree[1].playerId}</div>
                  <div className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-black border border-slate-200">
                    {getMetricDisplay(topThree[1])}
                  </div>
                </div>
              )}

              {/* Rank 1 (Gold) */}
              {topThree[0] && (
                <div className="bg-gradient-to-b from-amber-50 via-white to-white border-2 border-amber-400 rounded-3xl p-6 flex flex-col items-center text-center order-1 sm:order-2 shadow-md relative sm:-translate-y-4">
                  <div className="w-10 h-10 rounded-full bg-amber-400 text-slate-950 font-black flex items-center justify-center text-base absolute -top-5 shadow-md border-2 border-white animate-bounce">
                    👑 1
                  </div>
                  <div className="w-24 h-24 rounded-full border-4 border-amber-400 ring-4 ring-amber-300/40 overflow-hidden mb-3 mt-2 shadow-md">
                    <img
                      src={topThree[0].photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${topThree[0].id}`}
                      alt={topThree[0].displayName}
                      className="w-full h-full object-cover bg-slate-100"
                    />
                  </div>
                  <div className="font-black text-slate-900 text-lg truncate max-w-[170px]">
                    {topThree[0].displayName}
                  </div>
                  <div className="text-xs font-mono text-amber-700 font-bold mb-3">{topThree[0].playerId}</div>
                  <div className="px-4 py-1.5 rounded-full bg-amber-400 text-slate-950 text-xs font-black shadow-sm">
                    {getMetricDisplay(topThree[0])}
                  </div>
                </div>
              )}

              {/* Rank 3 (Bronze) */}
              {topThree[2] && (
                <div className="bg-white border border-amber-200 rounded-3xl p-5 flex flex-col items-center text-center order-3 sm:order-3 shadow-sm relative">
                  <div className="w-8 h-8 rounded-full bg-amber-200 text-amber-900 font-black flex items-center justify-center text-sm absolute -top-4 shadow-sm border-2 border-white">
                    3
                  </div>
                  <div className="w-20 h-20 rounded-full border-4 border-amber-300 overflow-hidden mb-3 mt-2 shadow-sm">
                    <img
                      src={topThree[2].photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${topThree[2].id}`}
                      alt={topThree[2].displayName}
                      className="w-full h-full object-cover bg-slate-100"
                    />
                  </div>
                  <div className="font-bold text-slate-900 text-base truncate max-w-[150px]">
                    {topThree[2].displayName}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mb-2">{topThree[2].playerId}</div>
                  <div className="px-3 py-1 rounded-full bg-amber-50 text-amber-800 text-xs font-black border border-amber-200">
                    {getMetricDisplay(topThree[2])}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Table for remaining ranks */}
          {restOfLeaders.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
              <div className="divide-y divide-slate-100">
                {restOfLeaders.map((player, idx) => {
                  const rank = idx + 4;
                  const isMe = player.id === userProfile?.id;
                  return (
                    <div
                      key={player.id}
                      className={`flex items-center justify-between p-4 px-6 transition ${
                        isMe ? 'bg-amber-50/70 border-l-4 border-amber-400' : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="w-7 font-mono font-bold text-slate-400 text-sm">
                          #{rank}
                        </span>
                        <div className="w-10 h-10 rounded-full overflow-hidden border border-slate-200 bg-slate-100">
                          <img
                            src={player.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${player.id}`}
                            alt={player.displayName}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 text-sm">
                            {player.displayName} {isMe && <span className="text-amber-600 text-xs">(သင်)</span>}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">{player.playerId}</div>
                        </div>
                      </div>

                      <div className="font-mono font-bold text-amber-700 text-sm">
                        {getMetricDisplay(player)}
                      </div>
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
