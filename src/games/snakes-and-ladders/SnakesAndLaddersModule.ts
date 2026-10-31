import type { GameRoom } from '../../types';
import type { GameModuleDefinition } from '../types';
import { SnakesAndLaddersGame } from './SnakesAndLaddersGame';

export const SNAKES_AND_LADDERS_INSTRUCTIONS_MM =
  'အလှည့်ကျ အံစာတုံးခေါက်ပြီး ၁ မှ ၁၀၀ သို့ ရွေ့ရမည်။ လှေကားတွေ့ပါက အပေါ်သို့ တက်နိုင်ပြီး မြွေတွေ့ပါက အောက်သို့ ပြန်ဆင်းရမည်။ နံပါတ် ၁၀၀ သို့ ပထမဆုံးရောက်ရှိသူသည် ချန်ပီယံဆုနှင့် ရွှေဒင်္ဂါး ရရှိမည်ဖြစ်ပါသည်။';

export function getSnakesAndLaddersRuleSummary(
  room: Pick<GameRoom, 'exactFinish' | 'maxPlayers'>
): string {
  return room.exactFinish ? 'အတိအကျဝင်ရန်လိုသည်' : 'သာမန်စည်းမျဉ်း';
}

export const snakesAndLaddersModule: GameModuleDefinition = {
  id: 'snakes_and_ladders',
  GameplayComponent: SnakesAndLaddersGame,
  instructionsMm: SNAKES_AND_LADDERS_INSTRUCTIONS_MM,
  getRuleSummaryMm: getSnakesAndLaddersRuleSummary,
};
