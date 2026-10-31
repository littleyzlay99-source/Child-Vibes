import { getGameById, type RegisteredGameId } from './registry';
import { snakesAndLaddersModule } from './snakes-and-ladders/SnakesAndLaddersModule';
import { snowRushModule } from './snow-rush/SnowRushModule';
import type { GameModuleDefinition, GameModuleResolution } from './types';

/**
 * Central Game Module Map — maps registered game IDs to their `GameModuleDefinition`.
 * Availability in production remains strictly gated by `registryEntry.status === 'available'`
 * inside `resolveGameModule` (so `coming_soon` modules stay disabled until explicitly launched).
 */
const REGISTERED_GAME_MODULES: Partial<Record<RegisteredGameId, GameModuleDefinition>> = {
  snakes_and_ladders: snakesAndLaddersModule,
  snow_rush: snowRushModule,
};

/**
 * Resolve a room's `gameType` against both the Central Game Registry and the Game Module Map.
 *
 * Guarantees:
 * 1. Unknown / empty / invalid `gameType` -> `{ kind: 'unresolved', reason: 'unknown_game' }` (NEVER silently falls back to Snakes & Ladders).
 * 2. Registered `coming_soon` game -> `{ kind: 'unresolved', reason: 'coming_soon' }`.
 * 3. Registered `available` game without a module -> `{ kind: 'unresolved', reason: 'module_missing' }`.
 * 4. Registered `available` game with a module -> `{ kind: 'resolved', module, registryEntry }`.
 */
export function resolveGameModule(gameType?: string | null): GameModuleResolution {
  const normalized = typeof gameType === 'string' ? gameType.trim() : '';

  if (!normalized) {
    return {
      kind: 'unresolved',
      reason: 'unknown_game',
      requestedGameType: '',
    };
  }

  const registryEntry = getGameById(normalized);
  if (!registryEntry) {
    return {
      kind: 'unresolved',
      reason: 'unknown_game',
      requestedGameType: normalized,
    };
  }

  if (registryEntry.status !== 'available') {
    return {
      kind: 'unresolved',
      reason: 'coming_soon',
      requestedGameType: normalized,
      registryEntry,
    };
  }

  const gameModule = REGISTERED_GAME_MODULES[registryEntry.id];
  if (!gameModule) {
    return {
      kind: 'unresolved',
      reason: 'module_missing',
      requestedGameType: normalized,
      registryEntry,
    };
  }

  return {
    kind: 'resolved',
    gameType: registryEntry.id,
    registryEntry,
    module: gameModule,
  };
}

/**
 * Returns true if and only if `gameType` is registered as `available` in Central Game Registry
 * AND has a playable Game Module implementation registered.
 */
export function isGameModulePlayable(gameType?: string | null): boolean {
  return resolveGameModule(gameType).kind === 'resolved';
}

/**
 * Return all Game Module IDs wired in `REGISTERED_GAME_MODULES`.
 * Note: Use `isGameModulePlayable(id)` or `getAvailableGames()` to check public availability.
 */
export function getRegisteredGameModuleIds(): RegisteredGameId[] {
  return Object.keys(REGISTERED_GAME_MODULES) as RegisteredGameId[];
}
