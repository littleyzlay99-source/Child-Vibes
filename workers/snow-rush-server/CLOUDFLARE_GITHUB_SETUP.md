# Snow Rush Companion Worker — Cloudflare Native GitHub Auto-Deploy လမ်းညွှန်
**(Terminal မလို / GitHub Actions မလို / Code ရေးစရာမလိုသော အဆင့်ဆင့် လမ်းညွှန်)**

ဤလမ်းညွှန်သည် **Google AI Studio မှ GitHub သို့ Push လုပ်ပြီး Cloudflare က အလိုအလျောက် Deploy လုပ်ပေးသည့် နည်းလမ်း**ကို အသုံးပြုနေသူများအတွက် အထူးရေးသားထားပါသည်။

လက်ရှိ `child-vibes3050` (Cloudflare Pages) ကို လုံးဝ မထိခိုက်စေဘဲ၊ Snow Rush Multiplayer အတွက် သီးခြား Companion Worker (`child-vibes-snow-rush-server`) ကို **Cloudflare Dashboard ပေါ်မှ တစ်ကြိမ်သာ ချိတ်ဆက်ပေးရုံဖြင့်** နောက်ပိုင်း GitHub Push လုပ်တိုင်း အလိုအလျောက် Deploy ဖြစ်နေမည် ဖြစ်ပါသည်။

---

## အပိုင်း (၁) — Cloudflare Dashboard တွင် GitHub နှင့် ပထမဆုံးအကြိမ် ချိတ်ဆက်ပုံ

### အဆင့် ၁။ Cloudflare Dashboard သို့ ဝင်ရောက်ပါ
1. Browser တွင် **[https://dash.cloudflare.com](https://dash.cloudflare.com)** သို့ ဝင်ပြီး လက်ရှိ `child-vibes3050` ရှိသော Cloudflare Account ဖြင့် Sign in ဝင်ပါ။

---

### အဆင့် ၂။ Workers & Pages သို့ သွားပါ
1. ဘယ်ဘက်ခြမ်း Menu (Left Sidebar) ရှိ **Compute (Workers)** (သို့မဟုတ် တိုက်ရိုက် **Workers & Pages**) ကို နှိပ်ပါ။
2. ထိုအောက်ရှိ **Workers & Pages** စာမျက်နှာသို့ ဝင်ပါ (ထိုနေရာတွင် လက်ရှိ `child-vibes3050` Pages project ကိုလည်း တွေ့ရပါမည် — ၎င်းကို ဘာမှပြင်ရန် မလိုပါ)။

---

### အဆင့် ၃။ Create / Import a repository ကို ရွေးချယ်ပါ
1. ညာဘက်အပေါ်နားရှိ **Create** (သို့မဟုတ် **Create application**) ခလုတ်အပြာရောင်ကို နှိပ်ပါ။
2. **Workers** အပိုင်း (Pages tab မဟုတ်ပါ) အောက်ရှိ **Import a repository** (GitHub မှ Repository ချိတ်ဆက်မည့် ခလုတ်) ကို ရွေးပါ။
   > **အရေးကြီး သတိပြုရန်:** **Pages** ကို မရွေးမိပါစေနှင့်။ Snow Rush Server သည် Durable Object ပါဝင်သောကြောင့် **Workers -> Import a repository** ဖြင့်သာ ချိတ်ဆက်ရပါမည်။

---

### အဆင့် ၄။ လက်ရှိ Child Vibes GitHub Repository ကို ရွေးချယ်ပါ
1. **GitHub** ကို ရွေးပြီး လက်ရှိ `child-vibes3050` ချိတ်ဆက်ထားသော GitHub Account နှင့် **Child Vibes Repository** ကို ရွေးချယ်ပါ။
2. **Next** (သို့မဟုတ် **Begin setup**) ကို နှိပ်ပါ။

---

### အဆင့် ၅။ Project name / Worker name ကို အတိအကျ ထည့်သွင်းပါ
1. **Project name** ကွက်လပ်တွင် အောက်ပါအမည်ကို **စာလုံးပေါင်း တစ်ထပ်တည်း တူညီအောင်** Copy ကူးထည့်ပါ-
   ```text
   child-vibes-snow-rush-server
   ```
   > **ဘာကြောင့် အရေးကြီးသနည်း?** `workers/snow-rush-server/wrangler.toml` ထဲရှိ `name = "child-vibes-snow-rush-server"` နှင့် တစ်ထပ်တည်း ကိုက်ညီမှသာ Cloudflare Workers Builds က အောင်မြင်စွာ Deploy လုပ်ပေးပါမည်။ (`child-vibes3050` ဟု လုံးဝ မထည့်ရပါ။)

---

### အဆင့် ၆။ Build command နှင့် Deploy command ကို ထည့်သွင်းပါ
1. **Build command** ကွက်လပ်ကို **အလွတ်ထားပါ** (စာသား တစ်ခုခု ပါနေပါက ဖျက်ထားပါ — Wrangler က TypeScript နှင့် Shared Snow Rush Engine ဖိုင်များကို တိုက်ရိုက် Bundle လုပ်ပေးနိုင်ပါသည်)။
2. **Deploy command** ကွက်လပ်တွင် အောက်ပါအတိုင်း ရှိနေရပါမည် (Cloudflare က ပုံမှန်အားဖြင့် အလိုအလျောက် ဖြည့်ထားပေးပါသည်)-
   ```text
   npx wrangler deploy
   ```

---

### အဆင့် ၇။ Root directory တွင် `workers/snow-rush-server` ထည့်သွင်းပါ
1. **Root directory** (သို့မဟုတ် Advanced settings အောက်ရှိ **Root directory / Path**) တွင် `/` အစား အောက်ပါအတိုင်း အတိအကျ ရိုက်ထည့်ပါ-
   ```text
   workers/snow-rush-server
   ```
   > **သတိပြုရန်:** ရှေ့ဆုံးနှင့် နောက်ဆုံးတွင် `/` မထည့်ဘဲ `workers/snow-rush-server` ဟု ထည့်သွင်းပါ။
2. **Production branch** ရွေးရန် ပေါ်လာပါက Google AI Studio မှ GitHub သို့ Push လုပ်နေသော Branch (ပုံမှန်အားဖြင့် `main` — လက်ရှိ `child-vibes3050` Pages project သုံးနေသော Branch အမည်အတိုင်း) ကို ရွေးပါ။
3. **API token** အပိုင်း ပေါ်လာပါက Cloudflare က အလိုအလျောက် ပြင်ဆင်ပေးထားသော **Create new token** (Default Auto-generated token) အတိုင်းသာ ထားပါ။ ကိုယ်တိုင် Token အသစ် သွားဖန်တီးရန် သို့မဟုတ် GitHub ထဲ သွားထည့်ရန် **လုံးဝ မလိုအပ်ပါ**။

---

### အဆင့် ၈။ Save and Deploy ကို နှိပ်ပါ
1. အထက်ပါ အချက်အလက်များ (`child-vibes-snow-rush-server`, Build command အလွတ်, `npx wrangler deploy`, Root directory `workers/snow-rush-server`) မှန်ကန်ကြောင်း စစ်ဆေးပြီးပါက **Save and Deploy** ခလုတ်ကို နှိပ်ပါ။
2. Cloudflare က Repository ကို ဆွဲယူပြီး ပထမဆုံးအကြိမ် Worker + SQLite Durable Object (`SnowRushRoomDO`) ကို ၁ မိနစ်ခန့်အတွင်း အလိုအလျောက် Deploy လုပ်ပေးပါမည်။

---

## အပိုင်း (၂) — Deploy ပြီးနောက် Worker URL ကြည့်ရှုခြင်းနှင့် `/health` စစ်ဆေးခြင်း

### အဆင့် ၉။ Worker URL ကြည့်ရှုရမည့်နေရာ
1. Deploy အောင်မြင်သွားသည့်အခါ (`Success` / အစိမ်းရောင် အမှန်ခြစ် ပေါ်လာသည့်အခါ) `child-vibes-snow-rush-server` Worker ၏ **Overview** စာမျက်နှာ (သို့မဟုတ် **Settings -> Domains & Routes**) တွင် သင့် Worker URL ကို အောက်ပါပုံစံဖြင့် တွေ့ရပါမည်-
   ```text
   https://child-vibes-snow-rush-server.<your-subdomain>.workers.dev
   ```
2. ထို URL ကို Copy ကူးထားပါ။

---

### အဆင့် ၁၀။ Browser ဖြင့် `/health` ဖွင့်၍ စစ်ဆေးပုံ
1. Copy ကူးထားသော Worker URL ၏ အနောက်တွင် `/health` ပေါင်းထည့်ပြီး Browser Tab အသစ်တွင် ဖွင့်ကြည့်ပါ-
   ```text
   https://child-vibes-snow-rush-server.<your-subdomain>.workers.dev/health
   ```
2. အောက်ပါအတိုင်း JSON စာသား ပေါ်လာပါက Server ၁၀၀% အဆင်သင့် ဖြစ်နေပါပြီ-
   ```json
   {
     "ok": true,
     "service": "child-vibes-snow-rush-server",
     "protocolVersion": 1,
     "snapshotBroadcastHz": 10,
     "durableObjectBindingReady": true,
     "firebaseProjectConfigured": true,
     "firestoreNamedDbConfigured": true,
     "originAllowlistCount": 5
   }
   ```

---

## အပိုင်း (၃) — မလိုအပ်သော Build များ မဖြစ်စေရန် Build Settings ချိန်ညှိခြင်း (အကြံပြုချက်)

Frontend UI အပြောင်းအလဲသက်သက် Push လုပ်သည့်အခါတိုင်း Worker ကို မလိုအပ်ဘဲ ပြန် Deploy မလုပ်စေရန် `child-vibes-snow-rush-server` Worker အတွင်း **Settings -> Build** တွင် အောက်ပါ ၂ ချက်ကို တစ်ကြိမ် စစ်ဆေးသတ်မှတ်ထားနိုင်ပါသည်-

1. **Builds for non-production branches (Branch control / Preview builds):**
   - ကနဦး စမ်းသပ်ချိန်တွင် မလိုအပ်သော Preview builds မထွက်စေရန် **Disabled / Off** ပိတ်ထားရန် အကြံပြုပါသည်။
2. **Build watch paths -> Include paths:**
   - Snow Rush Server နှင့် Shared Simulation ဖိုင်များ ပြောင်းလဲမှသာ Worker ပြန် Deploy ဖြစ်စေရန် **Include paths** တွင် အောက်ပါလမ်းကြောင်းများကို ထည့်သွင်းထားနိုင်ပါသည်-
     ```text
     workers/snow-rush-server/*
     src/games/snow-rush/types.ts
     src/games/snow-rush/constants.ts
     src/games/snow-rush/track.ts
     src/games/snow-rush/items.ts
     src/games/snow-rush/simulation.ts
     src/games/snow-rush/engine/*
     src/games/snow-rush/network/protocol.ts
     ```

---

## အပိုင်း (၄) — နောက်ပိုင်း AI Studio မှ GitHub Push လုပ်တိုင်း အလိုအလျောက် အလုပ်လုပ်ပုံ

အထက်ပါ တစ်ကြိမ်တည်းသော Setup ပြီးဆုံးသွားပါက နောက်ပိုင်းတွင် Terminal သုံးရန်၊ Command ရိုက်ရန် လုံးဝ မလိုတော့ပါ-

1. **Google AI Studio မှ GitHub သို့ Push လုပ်လိုက်တိုင်း:**
   - **Cloudflare Pages (`child-vibes3050`)** က ဝက်ဘ်ဆိုဒ် (`https://child-vibes3050.pages.dev`) ကို ယခင်အတိုင်း အလိုအလျောက် Update လုပ်ပေးပါမည်။
   - **Cloudflare Workers Builds (`child-vibes-snow-rush-server`)** ကလည်း Snow Rush Server ဖိုင်များ အပြောင်းအလဲရှိပါက အလိုအလျောက် Update လုပ်ပေးပါမည်။
2. **Private Multiplayer စမ်းသပ်လိုသည့်အခါ (တစ်ကြိမ်သာ ချိတ်ဆက်ရန်):**
   - **Workers & Pages -> `child-vibes3050` (Pages project) -> Settings -> Variables and Secrets** (သို့မဟုတ် **Environment variables**) တွင်-
     - Variable name: `VITE_SNOW_RUSH_WS_URL`
     - Value: `https://child-vibes-snow-rush-server.<your-subdomain>.workers.dev` (အဆင့် ၉ မှ ရရှိသော သင့် Worker URL)
   - ထည့်သွင်းပြီး `child-vibes3050` Pages ကို တစ်ကြိမ် Redeploy (သို့မဟုတ် AI Studio မှ နောက်တစ်ကြိမ် GitHub Push) လုပ်ပြီးပါက `https://child-vibes3050.pages.dev/?privateSnowRush=1` လင့်ခ်ဖြင့် သူငယ်ချင်း ၂–၄ ယောက် သီးသန့် Multiplayer စမ်းသပ်ကစားနိုင်ပါပြီ။ (ပုံမှန် ကစားသမားများ မြင်ရသော Public Lobby တွင် Snow Rush သည် `Coming Soon` အဖြစ် ဆက်လက်လုံခြုံစွာ ပိတ်ထားဆဲ ဖြစ်ပါသည်။)
