import type { GameRoom } from '../../types';
import type { GameModuleDefinition } from '../types';
import { COURSE_LENGTH_KM_TEXT } from './constants';
import { SnowRushGame } from './SnowRushGame';

export const SNOW_RUSH_INSTRUCTIONS_MM =
  `နှင်းတောင်ထိပ် တာထွက်မျဉ်း (0.00 km) မှ ပန်းဝင်မျဉ်း (${COURSE_LENGTH_KM_TEXT} km) အထိ ဘယ်/ညာ ကွေ့ကာ ခုန်ကျော်ပြီး အမြန်ဆုံး ဆင်းပြိုင်ရမည့် 2D နှင်းလျှောစီး အပြေးပြိုင်ပွဲ ဖြစ်ပါသည်။`;

export function getSnowRushRuleSummary(
  room: Pick<GameRoom, 'exactFinish' | 'maxPlayers'>
): string {
  return `၁.၅၀ ကီလိုမီတာ တောင်ဆင်းပြိုင်ပွဲ (${room.maxPlayers} ဦး)`;
}

/**
 * Step 4.8 Game Module Definition for `snow_rush`.
 * Registered in `REGISTERED_GAME_MODULES` while `snow_rush` remains `status: 'coming_soon'`
 * in Central Game Registry so production Lobby/Game Selector stays safely disabled.
 */
export const snowRushModule: GameModuleDefinition = {
  id: 'snow_rush',
  GameplayComponent: SnowRushGame,
  instructionsMm: SNOW_RUSH_INSTRUCTIONS_MM,
  getRuleSummaryMm: getSnowRushRuleSummary,
};
