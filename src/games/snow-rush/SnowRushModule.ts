import type { GameRoom } from '../../types';
import type { GameModuleDefinition } from '../types';
import { COURSE_LENGTH_KM_TEXT } from './constants';
import { SnowRushGame } from './SnowRushGame';

export const SNOW_RUSH_INSTRUCTIONS_MM =
  `နှင်းတောင်ထိပ် တာထွက်မျဉ်း (0.00 km) မှ ပန်းဝင်မျဉ်း (${COURSE_LENGTH_KM_TEXT} km / 1.50 KM) အထိ ဘယ်/ညာ ကွေ့ကာ ခုန်ကျော်ပြီး ကစားသမား ၂–၄ ဦး Real-time Multiplayer အမြန်ဆုံး ဆင်းပြိုင်ရမည့် 2D နှင်းလျှောစီးပြိုင်ပွဲ (၁.၅၀ ကီလိုမီတာ) ဖြစ်ပါသည်။ Phase 1 တွင် XP / Points ဆုကြေး မပါဝင်သေးပါ။`;

export function getSnowRushRuleSummary(
  room: Pick<GameRoom, 'exactFinish' | 'maxPlayers'>
): string {
  return `1.50 KM (၁.၅၀ ကီလိုမီတာ) · Real-time Multiplayer · 2–${room.maxPlayers} ဦး · Phase 1: XP / Points ဆုကြေး မပါဝင်သေးပါ`;
}

/**
 * Public Game Module Definition for `snow_rush` (Step 10.5 Phase 1 Casual Launch).
 * Connects Public Lobby rooms (`status: 'available'` in Central Game Registry) to
 * `SnowRushGame` -> `SnowRushMultiplayerView` without XP / Points rewards in Phase 1.
 */
export const snowRushModule: GameModuleDefinition = {
  id: 'snow_rush',
  GameplayComponent: SnowRushGame,
  instructionsMm: SNOW_RUSH_INSTRUCTIONS_MM,
  getRuleSummaryMm: getSnowRushRuleSummary,
};
