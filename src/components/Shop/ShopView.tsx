import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { SHOP_CATALOG } from '../../config/gameRules';
import { ShopItem } from '../../types';
import { sounds } from '../../lib/sound';
import {
  ShoppingBag,
  Coins,
  CheckCircle2,
  Sparkles,
  LayoutGrid,
  Shield,
  Dices,
  Crown,
  AlertCircle,
} from 'lucide-react';

export const ShopView: React.FC = () => {
  const { userProfile, purchaseItem, equipItem } = useAuth();
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [purchaseFeedback, setPurchaseFeedback] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const categories = [
    { id: 'all', label: 'အားလုံး', icon: LayoutGrid },
    { id: 'frame', label: 'ပရိုဖိုင်ဘောင်များ', icon: Shield },
    { id: 'board', label: 'ဂိမ်းဘုတ်အလှဆင်', icon: Sparkles },
    { id: 'dice', label: 'အံစာတုံးများ', icon: Dices },
    { id: 'token', label: 'ကစားသမားအရုပ်များ', icon: Crown },
  ];

  const filteredItems =
    activeCategory === 'all'
      ? SHOP_CATALOG
      : SHOP_CATALOG.filter((item) => item.category === activeCategory);

  const handlePurchase = async (item: ShopItem) => {
    sounds.playClick();
    setProcessingId(item.id);
    const result = await purchaseItem(item);
    setPurchaseFeedback(result);
    setProcessingId(null);
    setTimeout(() => {
      setPurchaseFeedback(null);
    }, 4000);
  };

  const handleEquip = async (item: ShopItem) => {
    sounds.playClick();
    await equipItem(item.category as any, item.id);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      {/* Shop Header Banner */}
      <div className="bg-gradient-to-r from-amber-100/90 via-yellow-50/80 to-amber-50/90 border border-amber-200/80 rounded-3xl p-6 md:p-8 shadow-sm relative overflow-hidden backdrop-blur-md">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full bg-amber-200/70 text-amber-800 border border-amber-300 text-xs font-bold flex items-center gap-1.5 shadow-2xs">
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>Child Vibes ဆိုင်တော်ကြီး</span>
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900">
              ဂိမ်းအလှဆင်ပစ္စည်းများနှင့် ပရိုဖိုင်ဘောင်များ
            </h1>
            <p className="text-xs md:text-sm text-slate-600 mt-1 max-w-xl">
              ဂိမ်းကစားခြင်းမှ ရရှိထားသော ရွှေဒင်္ဂါး (Points) များဖြင့် သင်နှစ်သက်ရာ
              ပရိုဖိုင်ဘောင်၊ အံစာတုံးစတိုင်နှင့် ကစားသမားအရုပ်များကို ဝယ်ယူနိုင်ပါသည်။
            </p>
          </div>

          {/* User Points Display Chip */}
          <div className="bg-white/95 border border-amber-300 rounded-2xl px-6 py-4 shadow-sm flex items-center gap-3 shrink-0">
            <div className="w-12 h-12 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-600">
              <Coins className="w-7 h-7" />
            </div>
            <div>
              <div className="text-xs text-slate-500 font-semibold">သင့်လက်ကျန်ဒင်္ဂါး</div>
              <div className="text-2xl font-black text-amber-700 font-mono">
                {userProfile?.points.toLocaleString() || 0}
              </div>
            </div>
          </div>
        </div>

        {/* Purchase Notification Feedback Banner */}
        {purchaseFeedback && (
          <div
            className={`mt-4 p-3.5 rounded-2xl text-xs md:text-sm font-bold flex items-center gap-2 animate-in fade-in ${
              purchaseFeedback.success
                ? 'bg-emerald-50 border border-emerald-300 text-emerald-800'
                : 'bg-rose-50 border border-rose-300 text-rose-800'
            }`}
          >
            {purchaseFeedback.success ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <span>{purchaseFeedback.message}</span>
          </div>
        )}
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => {
                sounds.playClick();
                setActiveCategory(cat.id);
              }}
              className={`px-4 py-2.5 rounded-2xl text-xs md:text-sm font-bold flex items-center gap-2 transition whitespace-nowrap cursor-pointer shadow-2xs ${
                isActive
                  ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/30'
                  : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* Items Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {filteredItems.map((item) => {
          const isOwned = userProfile?.inventory.includes(item.id);
          const isEquipped =
            userProfile?.activeFrame === item.id ||
            userProfile?.activeBoardSkin === item.id ||
            userProfile?.activeDiceSkin === item.id ||
            userProfile?.activeTokenSkin === item.id;
          const canAfford = (userProfile?.points || 0) >= item.price;

          return (
            <div
              key={item.id}
              className={`bg-white border rounded-3xl p-5 flex flex-col justify-between transition-all duration-300 shadow-sm hover:border-amber-300 hover:shadow-md group ${
                isEquipped ? 'border-amber-400 ring-2 ring-amber-300/40 bg-amber-50/20' : 'border-slate-200/90'
              }`}
            >
              <div>
                {/* Item Preview Box */}
                <div className="w-full h-36 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-center p-4 mb-4 relative overflow-hidden group-hover:scale-[1.02] transition-transform">
                  {/* Category Preview Rendering */}
                  {item.category === 'frame' && (
                    <div
                      className={`w-20 h-20 rounded-2xl overflow-hidden p-1 ${
                        item.previewBorder || 'border-2 border-amber-400'
                      }`}
                    >
                      <img
                        src={userProfile?.photoURL || 'https://api.dicebear.com/7.x/bottts/svg?seed=preview'}
                        alt="Preview"
                        className="w-full h-full object-cover rounded-xl bg-slate-200"
                      />
                    </div>
                  )}

                  {item.category === 'board' && (
                    <div
                      className={`w-24 h-24 rounded-xl border-2 grid grid-cols-3 grid-rows-3 p-1 gap-1 text-[8px] font-bold ${
                        item.previewClass || 'bg-amber-100'
                      }`}
                    >
                      {Array.from({ length: 9 }).map((_, i) => (
                        <div
                          key={i}
                          className="border border-slate-300 rounded flex items-center justify-center bg-white/70 text-slate-700"
                        >
                          {i + 1}
                        </div>
                      ))}
                    </div>
                  )}

                  {item.category === 'dice' && (
                    <div
                      className={`w-14 h-14 rounded-xl flex items-center justify-center font-black text-2xl shadow-md border ${
                        item.previewClass || 'bg-white text-black'
                      }`}
                    >
                      ⚅
                    </div>
                  )}

                  {item.category === 'token' && (
                    <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-amber-400 to-yellow-300 border-2 border-white shadow-md flex items-center justify-center text-slate-950 font-black">
                      {item.iconName === 'Star' ? '★' : item.iconName === 'Gem' ? '💎' : '👑'}
                    </div>
                  )}

                  {/* Equipped Badge */}
                  {isEquipped && (
                    <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black shadow-xs">
                      တပ်ဆင်ထားသည်
                    </span>
                  )}
                </div>

                {/* Info */}
                <h3 className="font-bold text-slate-900 text-base mb-1">{item.name}</h3>
                <p className="text-xs text-slate-500 mb-3 min-h-[36px] line-clamp-2">
                  {item.description}
                </p>
              </div>

              {/* Price & Action Button */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 font-mono font-black text-amber-700 text-base">
                  <Coins className="w-4 h-4" />
                  <span>{item.price === 0 ? 'အခမဲ့' : `${item.price} ဒင်္ဂါး`}</span>
                </div>

                {isOwned ? (
                  isEquipped ? (
                    <span className="text-xs font-bold text-amber-700 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>သုံးထားဆဲ</span>
                    </span>
                  ) : (
                    <button
                      onClick={() => handleEquip(item)}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition cursor-pointer"
                    >
                      တပ်ဆင်မည်
                    </button>
                  )
                ) : (
                  <button
                    onClick={() => handlePurchase(item)}
                    disabled={!canAfford || processingId === item.id}
                    className={`px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-xs ${
                      canAfford
                        ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-amber-400/20 cursor-pointer active:scale-95'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                    }`}
                  >
                    <span>
                      {processingId === item.id
                        ? 'ဆောင်ရွက်ဆဲ...'
                        : canAfford
                        ? 'ဝယ်ယူမည်'
                        : 'ဒင်္ဂါးမလုံလောက်'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
