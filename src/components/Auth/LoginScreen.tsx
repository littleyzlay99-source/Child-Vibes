import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { sounds } from '../../lib/sound';
import {
  Sparkles,
  Users,
  Trophy,
  ShoppingBag,
  ShieldCheck,
  Gamepad2,
  Copy,
  Check,
  HelpCircle,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';

export const LoginScreen: React.FC = () => {
  const { loginWithGoogle } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUnauthorizedDomain, setIsUnauthorizedDomain] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [showHostingGuide, setShowHostingGuide] = useState(false);

  const currentHostname = typeof window !== 'undefined' ? window.location.hostname : '';

  const handleCopyHostname = () => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(currentHostname);
      setCopiedDomain(true);
      sounds.playClick();
      setTimeout(() => setCopiedDomain(false), 2500);
    }
  };

  const handleLogin = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setIsUnauthorizedDomain(false);
    sounds.playClick();
    try {
      await loginWithGoogle();
    } catch (error: any) {
      console.error('Google sign-in error:', error);
      if (error?.code === 'auth/unauthorized-domain') {
        setIsUnauthorizedDomain(true);
        setErrorMsg('Firebase တွင် Cloudflare Domain ခွင့်ပြုချက် (Authorized Domain) ထည့်သွင်းပေးရန် လိုအပ်နေပါသည်။');
      } else if (error?.code === 'auth/popup-blocked') {
        setErrorMsg('Browser တွင် Pop-up ပိတ်ထားသောကြောင့် Google Login window မပွင့်နိုင်ပါ။ ကျေးဇူးပြု၍ Browser Settings တွင် Pop-up ခွင့်ပြုပေးပါ။');
      } else if (error?.code === 'auth/popup-closed-by-user') {
        setErrorMsg('Google Login window ကို ပိတ်လိုက်သောကြောင့် အကောင့်မဝင်ရောက်နိုင်ပါ။');
      } else if (error?.code === 'auth/network-request-failed') {
        setErrorMsg('အင်တာနက်ချိတ်ဆက်မှု မတည်ငြိမ်သောကြောင့်ဖြစ်နိုင်ပါသည်။ အင်တာနက်စစ်ဆေးပြီး ပြန်လည်ကြိုးစားပေးပါ။');
      } else {
        setErrorMsg(error?.message || 'Google Login ဝင်ရောက်ရာတွင် အခက်အခဲရှိနေပါသည်။ ကျေးဇူးပြု၍ ပြန်လည်ကြိုးစားပေးပါ။');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50/60 via-sky-50/40 to-slate-100/60 flex flex-col justify-between relative overflow-hidden select-none text-slate-800">
      {/* Background Ambient Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-amber-300/20 via-yellow-200/20 to-sky-200/20 rounded-full blur-[100px] pointer-events-none" />

      {/* Top Navbar Minimal */}
      <header className="p-6 md:p-8 flex items-center justify-between relative z-10 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-400 to-yellow-300 flex items-center justify-center shadow-md shadow-amber-400/30">
            <span className="text-2xl">🎲</span>
          </div>
          <div>
            <div className="font-black text-slate-900 text-xl tracking-tight">Child Vibes</div>
            <div className="text-[11px] text-amber-700 font-bold">Online Mini Game Platform</div>
          </div>
        </div>

        {/* Cloudflare Hosting Guide Button */}
        <button
          onClick={() => {
            sounds.playClick();
            setShowHostingGuide(true);
          }}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/90 border border-slate-200 text-xs font-semibold text-slate-600 hover:text-amber-700 hover:border-amber-300 transition shadow-2xs cursor-pointer"
        >
          <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
          <span>Cloudflare Hosting လမ်းညွှန်</span>
        </button>
      </header>

      {/* Main Login Card */}
      <main className="relative z-10 max-w-xl mx-auto w-full p-4 md:p-6 text-center my-auto">
        <div className="bg-white/95 border border-slate-200/90 rounded-3xl p-6 md:p-10 shadow-xl backdrop-blur-xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold mb-4">
            <Sparkles className="w-3.5 h-3.5 text-amber-600 fill-current" />
            <span>မြန်မာ့ ပထမဆုံး အွန်လိုင်း မီနီဂိမ်း ပလက်ဖောင်း</span>
          </div>

          <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-3 tracking-tight">
            မင်္ဂလာပါ! အကောင့်ဝင်ရောက်ပါ
          </h1>
          <p className="text-sm text-slate-600 mb-8 max-w-md mx-auto leading-relaxed">
            သူငယ်ချင်းများနှင့် အတူတူ အွန်လိုင်းမှတစ်ဆင့် မြွေနှင့်လှေကား မီနီဂိမ်းများ
            ကစားနိုင်ရန် သင်၏ Google (Gmail) Account ဖြင့် အလွယ်တကူ ဝင်ရောက်နိုင်ပါသည်။
          </p>

          {/* Error Message & Unauthorized Domain Helper */}
          {errorMsg && (
            <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-300 text-rose-800 text-xs text-left font-medium leading-relaxed space-y-2">
              <div className="flex items-center gap-2 font-bold text-rose-900">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMsg}</span>
              </div>

              {isUnauthorizedDomain && (
                <div className="pt-2 border-t border-rose-200 space-y-2 text-slate-700">
                  <div className="text-[11px] font-semibold text-slate-800">
                    Cloudflare ပေါ်တွင် Google Login အလုပ်လုပ်ရန် Firebase Console တွင် Domain ထည့်သွင်းပေးရပါမည် -
                  </div>
                  <div className="flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-200">
                    <span className="font-mono font-bold text-amber-700 text-xs select-all flex-1 truncate">
                      {currentHostname}
                    </span>
                    <button
                      onClick={handleCopyHostname}
                      type="button"
                      className="px-2.5 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold flex items-center gap-1 cursor-pointer transition"
                    >
                      {copiedDomain ? <Check className="w-3 h-3 text-emerald-800" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedDomain ? 'ကူးပြီး' : 'Domain ကူးမည်'}</span>
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-600 leading-normal">
                    <strong>အဆင့်များ:</strong> Firebase Console &gt; <strong>Authentication</strong> &gt; <strong>Settings</strong> tab &gt; <strong>Authorized domains</strong> တွင် <code>Add domain</code> နှိပ်၍ အထက်ပါ domain ကို Paste လုပ်ပြီး Add ပေးပါ။
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Google Sign-in Button */}
          <button
            onClick={handleLogin}
            disabled={isLoading}
            className="w-full py-4 px-6 rounded-2xl bg-white hover:bg-slate-50 text-slate-800 font-black text-sm md:text-base flex items-center justify-center gap-3 border-2 border-slate-200 hover:border-slate-300 shadow-md hover:scale-[1.01] active:scale-98 transition-all duration-200 cursor-pointer disabled:opacity-50"
          >
            {/* Official Google SVG Logo */}
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>
              {isLoading ? 'ချိတ်ဆက်နေပါသည်...' : 'Google (Gmail) ဖြင့် ဆက်လက်လုပ်ဆောင်မည်'}
            </span>
          </button>

          {/* First-time Notice */}
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>ပထမဆုံးဝင်ရောက်သူများအတွက် Player ID နှင့် 500 ရွှေဒင်္ဂါး လက်ဆောင်ပေးပါမည်</span>
          </div>

          {/* Feature Highlights Grid */}
          <div className="grid grid-cols-2 gap-3 mt-8 pt-8 border-t border-slate-200 text-left">
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-50/60 border border-amber-100">
              <Users className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-xs font-semibold text-slate-700">သူငယ်ချင်းများနှင့် Multiplayer</span>
            </div>
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-50/60 border border-amber-100">
              <Trophy className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-xs font-semibold text-slate-700">Level & Point စနစ်များ</span>
            </div>
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-50/60 border border-amber-100">
              <ShoppingBag className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-xs font-semibold text-slate-700">အလှဆင်ပစ္စည်း Shop စနစ်</span>
            </div>
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-50/60 border border-amber-100">
              <Gamepad2 className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-xs font-semibold text-slate-700">မြွေနှင့်လှေကား မီနီဂိမ်း</span>
            </div>
          </div>
        </div>
      </main>

      {/* Cloudflare Hosting Guide Modal */}
      {showHostingGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl relative text-left max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-2xl">☁️</span>
                <div>
                  <h3 className="text-lg font-black text-slate-900">Cloudflare Pages Hosting လမ်းညွှန်</h3>
                  <div className="text-xs text-slate-500">အမှားမရှိ တင်နိုင်ရန် စစ်ဆေးရမည့် အချက်များ</div>
                </div>
              </div>
              <button
                onClick={() => setShowHostingGuide(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-700">
              {/* Point 1 */}
              <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200 space-y-1">
                <div className="font-bold text-amber-900 text-sm flex items-center gap-1.5">
                  <span>၁။ Build Settings သတ်မှတ်ချက်များ</span>
                </div>
                <div className="space-y-1 text-slate-700 pt-1">
                  <div>• <strong>Framework preset:</strong> <code>Vite</code></div>
                  <div>• <strong>Build command:</strong> <code>npm run build</code></div>
                  <div>• <strong>Build output directory:</strong> <code>dist</code></div>
                  <div>• <strong>Root directory:</strong> <code>/</code> (လွတ်ထားပါ)</div>
                </div>
              </div>

              {/* Point 2 */}
              <div className="p-3.5 bg-sky-50 rounded-2xl border border-sky-200 space-y-1">
                <div className="font-bold text-sky-900 text-sm flex items-center gap-1.5">
                  <span>၂။ Node.js Version သတ်မှတ်ခြင်း</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Cloudflare Pages ၏ Settings &gt; Environment variables တွင် <code>NODE_VERSION</code> ကို <code>20</code> ဟု သတ်မှတ်ပေးပါ။ (ယခု codebase ထဲတွင် <code>.node-version</code> နှင့် <code>.nvmrc</code> ကို ထည့်သွင်းပေးထားပြီးဖြစ်သဖြင့် အလိုအလျောက် Node 20 အသုံးပြုပါမည်)။
                </p>
              </div>

              {/* Point 3 */}
              <div className="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-1">
                <div className="font-bold text-emerald-900 text-sm flex items-center gap-1.5">
                  <span>၃။ SPA Redirect စနစ် (_redirects)</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Cloudflare ပေါ်တွင် Page Refresh လုပ်သည့်အခါ 404 error မဖြစ်စေရန် <code>public/_redirects</code> ကို ထည့်သွင်းပြင်ဆင်ပေးထားပြီးဖြစ်ပါသည်။
                </p>
              </div>

              {/* Point 4 */}
              <div className="p-3.5 bg-purple-50 rounded-2xl border border-purple-200 space-y-1">
                <div className="font-bold text-purple-900 text-sm flex items-center gap-1.5">
                  <span>၄။ Firebase Authorized Domain ထည့်သွင်းရန်</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Cloudflare မှ ရရှိလာသော domain (ဥပမာ: <code>xxx.pages.dev</code>) ကို Firebase Console &gt; <strong>Authentication</strong> &gt; <strong>Settings</strong> &gt; <strong>Authorized domains</strong> တွင် <code>Add domain</code> နှိပ်ပြီး ထည့်ပေးရန် လိုအပ်ပါသည်။ သို့မှသာ Google Login အောင်မြင်ပါမည်။
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowHostingGuide(false)}
              className="mt-6 w-full py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs cursor-pointer shadow-xs"
            >
              နားလည်ပါပြီ
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="p-6 text-center text-xs text-slate-500 relative z-10">
        © 2026 Child Vibes. All Rights Reserved. မြန်မာ့အွန်လိုင်း မီနီဂိမ်း ပလက်ဖောင်း
      </footer>
    </div>
  );
};
