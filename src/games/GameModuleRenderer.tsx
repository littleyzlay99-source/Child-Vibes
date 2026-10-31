import React from 'react';
import { resolveGameModule } from './moduleResolver';
import { UnsupportedGameFallback } from './UnsupportedGameFallback';
import type { GameModuleGameplayProps, GameModuleResolution } from './types';

export interface GameModuleRendererProps {
  resolution?: GameModuleResolution;
  gameType?: string | null;
  gameplayProps: GameModuleGameplayProps;
}

/**
 * Game Module Router Component (Step 3.3B)
 * - Mounts the resolved Mini-Game Gameplay Component ONLY when `status === 'available'` and module exists
 * - Otherwise renders `UnsupportedGameFallback` without ever falling back to Snakes & Ladders
 */
export const GameModuleRenderer: React.FC<GameModuleRendererProps> = ({
  resolution,
  gameType,
  gameplayProps,
}) => {
  const activeResolution = resolution ?? resolveGameModule(gameType ?? gameplayProps.room.gameType);

  if (activeResolution.kind !== 'resolved') {
    const handleFallbackLeave =
      gameplayProps.room.status === 'finished'
        ? gameplayProps.onLeaveAfterFinish
        : gameplayProps.onRequestExit;

    return (
      <UnsupportedGameFallback
        resolution={activeResolution}
        roomCode={gameplayProps.room.roomCode}
        isExiting={gameplayProps.isExiting}
        onLeaveRoom={handleFallbackLeave}
      />
    );
  }

  const { GameplayComponent } = activeResolution.module;
  return <GameplayComponent {...gameplayProps} />;
};
