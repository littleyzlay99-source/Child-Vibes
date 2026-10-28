import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { ACHIEVEMENTS_LIST, SHOP_CATALOG } from '../../config/gameRules';
import { deriveLevelProgress } from '../../services/progressionService';
import { sounds } from '../../lib/sound';
import {
  Trophy,
  Award,
  Gamepad2,
  Copy,
  Check,
  Edit3,
  LogOut,
  Sparkles,
  Shield,
  Coins,
  History,
  CheckCircle2,
  Lock,
  Gift,
} from 'lucide-react';

export const ProfileView: React.FC = () => {
  const {
    currentUser,
    userProfile,
    logout,
    updateProfileName,
    updateProfileAvatar,
    equipItem,
    claimAchievementReward,
    userTransactions,
  } = useAuth();

  const [copiedId, setCopiedId] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(userProfile?.displayName || '');
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [claimingAchId, setClaimingAchId] = useState<string | null>(null);
  const [achFeedback, setAchFeedback] = useState<{ success: boolean; message: string } | null>(
    null
  );

  if (!userProfile) return null;

  const handleCopyPlayerId = () => {
    sounds.playClick();
    navigator.clipboard.writeText(userProfile.playerId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    await updateProfileName(nameInput.trim());
    setIsEditingName(false);
  };

  const handleClaimAchievement = async (achId: string) => {
    if (claimingAchId) return;
    sounds.playClick();
    setClaimingAchId(achId);
    const res = await claimAchievementReward(achId);
    setAchFeedback({ success: res.success, message: res.message });
    setClaimingAchId(null);
    setTimeout(() => setAchFeedback(null), 4000);
  };

  const presetAvatars = [
    `https://api.dicebear.com/7.x/bottts/svg?seed=${userProfile.id}`,
    `https://api.dicebear.com/7.x/bottts/svg?seed=shwe_dragon`,
    `https://api.dicebear.com/7.x/bottts/svg?seed=shwe_lion`,
    `https://api.dicebear.com/7.x/bottts/svg?seed=shwe_tiger`,
    `https://api.dicebear.com/7.x/bottts/svg?seed=shwe_phoenix`,
    `https://api.dicebear.com/7.x/bottts/svg?seed=shwe_warrior`,
  ];

  // Authoritative Level 1-999 Progression
  const levelProg = deriveLevelProgress(userProfile.totalXp ?? 0);
  const currentPoints = userProfile.currentPoints ?? userProfile.points ?? 0;
  const totalPointsEarned = userProfile.totalPointsEarned ?? currentPoints;
  const claimedAchievements = userProfile.claimedAchievements || [];

  // Win Rate
  const winRate =
    userProfile.totalGames > 0
      ? Math.round((userProfile.totalWins / userProfile.totalGames) * 100)
      : 0;

  // Active Frame style
  const activeFrameItem = SHOP_CATALOG.find((i) => i.id === userProfile.activeFrame);
  const displayedEmail = currentUser?.email || userProfile.email;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      {/* Profile Header Card */}
      <div className="bg-white/95 border border-slate-200/90 rounded-3xl p-6 md:p-8 shadow-md relative overflow-hidden backdrop-blur-md">
        <div className="absolute top-0 right-0 w-72 h-72 bg-amber-200/30 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 relative z-10">
          {/* Avatar with Equipped Frame */}
          <div className="relative group shrink-0">
            <div
              className={`w-28 h-28 md:w-32 md:h-32 rounded-3xl p-1 overflow-hidden transition-all duration-300 ${
                activeFrameItem?.previewBorder || 'border-2 border-amber-300'
              }`}
            >
              <img
                src={userProfile.photoURL}
                alt={userProfile.displayName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover rounded-2xl bg-slate-100 shadow-sm"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                sounds.playClick();
                setShowAvatarPicker(!showAvatarPicker);
              }}
              className="absolute -bottom-2 -right-2 bg-white hover:bg-slate-50 text-amber-700 p-2 rounded-xl border border-amber-300 shadow-md cursor-pointer transition"
              title="Avatar ပြောင်းမည်"
            >
              <Edit3 className="w-4 h-4" />
            </button>
          </div>

          {/* User Details */}
          <div className="flex-1 text-center sm:text-left space-y-2 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap">
              {isEditingName ? (
                <form onSubmit={handleSaveName} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    maxLength={30}
                    className="bg-white text-slate-800 px-3 py-1.5 rounded-lg border border-amber-400 text-base font-bold focus:outline-hidden shadow-xs"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-lg text-xs font-black cursor-pointer shadow-xs"
                  >
                    သိမ်းမည်
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingName(false)}
                    className="px-2 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs hover:bg-slate-200 cursor-pointer"
                  >
                    ပယ်ဖျက်
                  </button>
                </form>
              ) : (
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <h1 className="text-2xl md:text-3xl font-black text-slate-900 truncate max-w-[240px]">
                    {userProfile.displayName}
                  </h1>
                  <button
                    type="button"
                    onClick={() => {
                      sounds.playClick();
                      setNameInput(userProfile.displayName);
                      setIsEditingName(true);
                    }}
                    className="text-slate-400 hover:text-amber-600 transition cursor-pointer p-1"
                    title="နာမည်ပြင်မည်"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Level Badge + MAX LEVEL Badge */}
              <div className="inline-flex items-center gap-1.5 self-center sm:self-auto">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-400 text-slate-950 font-black text-xs shadow-xs">
                  <Shield className="w-3.5 h-3.5 fill-current" />
                  <span>Level {levelProg.level}</span>
                </span>
                {levelProg.isMaxLevel && (
                  <span className="px-2.5 py-1 rounded-xl bg-slate-900 text-amber-300 font-black text-[10px] tracking-wider">
                    MAX LEVEL
                  </span>
                )}
              </div>
            </div>

            {/* Unique Player ID & Copy */}
            <div className="flex items-center justify-center sm:justify-start gap-2 text-xs">
              <span className="text-slate-500">Player ID:</span>
              <span className="font-mono font-bold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-md border border-amber-200">
                {userProfile.playerId}
              </span>
              <button
                type="button"
                onClick={handleCopyPlayerId}
                className="text-slate-500 hover:text-slate-800 transition flex items-center gap-1 cursor-pointer"
                title="Player ID ကူးမည်"
              >
                {copiedId ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span className="text-[11px] font-semibold">
                  {copiedId ? 'ကူးပြီးပါပြီ' : 'ကူးမည်'}
                </span>
              </button>
            </div>

            {displayedEmail && (
              <div className="text-xs text-slate-500 truncate max-w-xs mx-auto sm:mx-0">
                {displayedEmail}
              </div>
            )}

            {/* Level XP Progress Bar */}
            <div className="pt-2 max-w-md mx-auto sm:mx-0 space-y-1">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-600">
                  {levelProg.isMaxLevel
                    ? 'MAX LEVEL (အမြင့်ဆုံးအဆင့် 999)'
                    : `Level ${levelProg.level + 1} သို့ တက်ရန်`}
                </span>
                <span className="text-amber-700 font-mono font-bold tabular-nums">
                  {levelProg.isMaxLevel
                    ? `စုစုပေါင်း ${levelProg.totalXp.toLocaleString()} XP`
                    : `${levelProg.currentLevelXp.toLocaleString()} / ${levelProg.xpForNextLevel.toLocaleString()} XP (${levelProg.progressPercent}%)`}
                </span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-yellow-400 transition-all duration-500 rounded-full"
                  style={{ width: `${levelProg.isMaxLevel ? 100 : levelProg.progressPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  {levelProg.isMaxLevel
                    ? 'အမြင့်ဆုံး Level ပြည့်ပြီး · XP ဆက်လက်စုဆောင်းနိုင်သည်'
                    : `နောက်တစ်ဆင့်အတွက် ${levelProg.xpRemainingForNextLevel.toLocaleString()} XP လိုအပ်ပါသည်`}
                </span>
                <span className="font-mono">Total: {levelProg.totalXp.toLocaleString()} XP</span>
              </div>
            </div>
          </div>

          {/* Separated Point Balances (Current Balance vs Total Earned) & Logout */}
          <div className="flex flex-col items-center sm:items-end gap-2.5 shrink-0 w-full sm:w-auto">
            <div className="w-full sm:w-auto bg-amber-50/80 border border-amber-200 rounded-2xl px-4 py-3 text-center sm:text-right shadow-xs space-y-1.5">
              <div>
                <div className="text-[11px] text-slate-500 flex items-center justify-center sm:justify-end gap-1">
                  <Coins className="w-3.5 h-3.5 text-amber-600" />
                  <span>လက်ကျန် အမှတ် (ဆိုင်သုံးရန်)</span>
                </div>
                <div className="text-2xl font-black text-amber-700 font-mono tabular-nums">
                  {currentPoints.toLocaleString()}
                </div>
              </div>
              <div className="pt-1.5 border-t border-amber-200/70 text-[11px] text-slate-600 flex items-center justify-center sm:justify-end gap-1.5">
                <span>စုစုပေါင်း ရမှတ်:</span>
                <strong className="font-mono text-slate-900 tabular-nums">
                  {totalPointsEarned.toLocaleString()}
                </strong>
              </div>
            </div>

            <button
              type="button"
              onClick={logout}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 text-xs font-semibold border border-slate-200 hover:border-rose-300 transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>အကောင့်ထွက်မည်</span>
            </button>
          </div>
        </div>

        {/* Avatar Preset Selector */}
        {showAvatarPicker && (
          <div className="mt-6 pt-6 border-t border-slate-200 animate-in fade-in">
            <div className="text-xs font-bold text-slate-700 mb-3">Avatar စတိုင် ရွေးချယ်ပါ -</div>
            <div className="flex flex-wrap gap-3">
              {presetAvatars.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    updateProfileAvatar(url);
                    setShowAvatarPicker(false);
                  }}
                  className={`w-14 h-14 rounded-2xl overflow-hidden border-2 transition cursor-pointer hover:scale-105 ${
                    userProfile.photoURL === url
                      ? 'border-amber-400 ring-2 ring-amber-400/50'
                      : 'border-slate-200'
                  }`}
                >
                  <img
                    src={url}
                    alt={`Avatar ${i}`}
                    className="w-full h-full object-cover bg-slate-100"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
            <Trophy className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">အနိုင်ရအကြိမ်</div>
            <div className="text-xl font-black text-slate-900 tabular-nums">
              {userProfile.totalWins} ပွဲ
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600 shrink-0">
            <Gamepad2 className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">ကစားထားသောပွဲ</div>
            <div className="text-xl font-black text-slate-900 tabular-nums">
              {userProfile.totalGames} ပွဲ
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">Win Rate (နိုင်နှုန်း)</div>
            <div className="text-xl font-black text-emerald-700 tabular-nums">{winRate}%</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600 shrink-0">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">ပိုင်ဆိုင်သော ပစ္စည်း</div>
            <div className="text-xl font-black text-purple-700 tabular-nums">
              {userProfile.inventory.length} ခု
            </div>
          </div>
        </div>
      </div>

      {/* Owned Inventory & Customization */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-xs">
        <h2 className="text-lg font-black text-slate-900 mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" />
          <span>ပိုင်ဆိုင်ထားသော အလှဆင်ပစ္စည်းများ (Inventory)</span>
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {SHOP_CATALOG.filter((item) => userProfile.inventory.includes(item.id)).map((item) => {
            const isEquipped =
              userProfile.activeFrame === item.id ||
              userProfile.activeBoardSkin === item.id ||
              userProfile.activeDiceSkin === item.id ||
              userProfile.activeTokenSkin === item.id;

            return (
              <div
                key={item.id}
                className={`border rounded-2xl p-4 flex flex-col items-center text-center transition shadow-xs ${
                  isEquipped ? 'bg-amber-50/80 border-amber-300' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-white border border-slate-200 mb-2">
                  <span className="text-[11px] font-bold text-amber-700">
                    {item.category.toUpperCase()}
                  </span>
                </div>
                <div className="text-xs font-bold text-slate-900 mb-1 truncate w-full">
                  {item.name}
                </div>
                <div className="text-[11px] text-slate-500 mb-3 line-clamp-1">
                  {item.description}
                </div>

                {isEquipped ? (
                  <span className="text-[11px] font-bold text-amber-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>တပ်ဆင်ထားသည်</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => equipItem(item.category as any, item.id)}
                    className="w-full py-1.5 rounded-lg bg-slate-200 hover:bg-amber-400 hover:text-slate-950 text-slate-700 text-xs font-bold transition cursor-pointer"
                  >
                    တပ်ဆင်မည်
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Achievements System (Extensible XP + Points Rewards) */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-500" />
            <span>အောင်မြင်မှုများ (Achievements)</span>
          </h2>
          {achFeedback && (
            <div
              className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                achFeedback.success
                  ? 'bg-emerald-50 border border-emerald-300 text-emerald-800'
                  : 'bg-rose-50 border border-rose-300 text-rose-800'
              }`}
            >
              {achFeedback.message}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ACHIEVEMENTS_LIST.map((ach) => {
            let isUnlocked = false;
            let currentVal = 0;
            if (ach.id === 'first_win') {
              currentVal = userProfile.totalWins;
              isUnlocked = userProfile.totalWins >= 1;
            } else if (ach.id === 'win_5') {
              currentVal = userProfile.totalWins;
              isUnlocked = userProfile.totalWins >= 5;
            } else if (ach.id === 'games_10') {
              currentVal = userProfile.totalGames;
              isUnlocked = userProfile.totalGames >= 10;
            } else if (ach.id === 'reach_lvl_5') {
              currentVal = levelProg.level;
              isUnlocked = levelProg.level >= 5;
            }

            const isClaimed = claimedAchievements.includes(ach.id);

            return (
              <div
                key={ach.id}
                className={`border rounded-2xl p-4 flex items-start gap-4 transition shadow-xs ${
                  isUnlocked
                    ? 'bg-emerald-50/50 border-emerald-300 text-slate-900'
                    : 'bg-slate-50/60 border-slate-200 text-slate-500 opacity-80'
                }`}
              >
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${
                    isUnlocked
                      ? 'bg-emerald-100 border-emerald-300 text-emerald-700'
                      : 'bg-slate-100 border-slate-200 text-slate-400'
                  }`}
                >
                  {isUnlocked ? <Trophy className="w-6 h-6" /> : <Lock className="w-6 h-6" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900">{ach.title}</span>
                    <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold">
                      <span className="text-sky-700">+{ach.rewardXp} XP</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-amber-700">+{ach.rewardPoints} Pts</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{ach.description}</p>
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <span className="text-[11px] font-semibold text-slate-600 tabular-nums">
                      တိုးတက်မှု: {Math.min(currentVal, ach.targetCount)} / {ach.targetCount}
                    </span>

                    {isUnlocked &&
                      (isClaimed ? (
                        <span className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>ဆုထုတ်ယူပြီး</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleClaimAchievement(ach.id)}
                          disabled={claimingAchId === ach.id}
                          className="px-2.5 py-1 rounded-lg bg-amber-400 hover:bg-amber-500 text-slate-950 text-[11px] font-black flex items-center gap-1 cursor-pointer transition disabled:opacity-60"
                        >
                          <Gift className="w-3 h-3" />
                          <span>
                            {claimingAchId === ach.id ? 'ထုတ်ယူနေဆဲ...' : 'ဆုထုတ်ယူမည်'}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Point & XP Transaction History */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-xs">
        <h2 className="text-lg font-black text-slate-900 mb-4 flex items-center gap-2">
          <History className="w-5 h-5 text-amber-500" />
          <span>ရမှတ်နှင့် XP မှတ်တမ်း (Transaction History)</span>
        </h2>

        {userTransactions.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs">မှတ်တမ်းများ မရှိသေးပါ။</div>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {userTransactions.slice(0, 20).map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 truncate">{tx.description}</div>
                  <div className="text-[10px] text-slate-400">
                    {new Date(tx.createdAt).toLocaleDateString()}{' '}
                    {new Date(tx.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
                <div className="text-right shrink-0 space-y-0.5 font-mono tabular-nums">
                  <div
                    className={`font-black text-sm ${
                      tx.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {tx.amount >= 0 ? `+${tx.amount.toLocaleString()}` : tx.amount.toLocaleString()}{' '}
                    ဒင်္ဂါး
                  </div>
                  {typeof tx.xpAmount === 'number' && tx.xpAmount > 0 && (
                    <div className="text-[11px] font-bold text-sky-700">
                      +{tx.xpAmount.toLocaleString()} XP
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
