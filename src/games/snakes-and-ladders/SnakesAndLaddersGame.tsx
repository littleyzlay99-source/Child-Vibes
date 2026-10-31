import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { executeDiceRollAndMove } from '../../services/roomService';
import { GameBoard } from '../../components/SnakesAndLadders/GameBoard';
import { DiceRoller } from '../../components/SnakesAndLadders/DiceRoller';
import { VictoryModal } from '../../components/SnakesAndLadders/VictoryModal';
import type { GameModuleGameplayProps } from '../types';

function resolvePlayerColorClass(hexColor?: string): string {
  switch (hexColor?.toUpperCase()) {
    case '#EF4444':
      return 'bg-rose-500';
    case '#10B981':
      return 'bg-emerald-500';
    case '#3B82F6':
      return 'bg-blue-500';
    case '#F59E0B':
      return 'bg-amber-500';
    default:
      return 'bg-slate-400';
  }
}

/**
 * Snakes & Ladders Gameplay Surface (Step 3.3B)
 * - Encapsulates Snakes & Ladders board rendering, dice rolling, live tile positions, and victory modal
 * - Zero direct Firestore subscriptions (relies on Shared Room Controller's single room listener)
 * - Cleans up local animation/error timers on unmount
 */
export const SnakesAndLaddersGame: React.FC<GameModuleGameplayProps> = ({
  room,
  currentUserId,
  currentUserDisplayName,
  isHost,
  cosmetics,
  rewardOutcome,
  fallbackProgress,
  isClaimingReward,
  onCommitRoomState,
  onTurnTimeout,
  onPlayAgain,
  onLeaveAfterFinish,
}) => {
  const [movingPlayerId, setMovingPlayerId] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<boolean>(false);
  const [gameErrorNotice, setGameErrorNotice] = useState<string | null>(null);

  const actionLockRef = useRef<boolean>(false);
  const animUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up any pending animation or error dismissal timers on unmount or round teardown
  useEffect(() => {
    return () => {
      if (animUnlockTimerRef.current) {
        clearTimeout(animUnlockTimerRef.current);
        animUnlockTimerRef.current = null;
      }
      if (errorDismissTimerRef.current) {
        clearTimeout(errorDismissTimerRef.current);
        errorDismissTimerRef.current = null;
      }
      actionLockRef.current = false;
    };
  }, []);

  const currentTurnPlayer = room.players[room.currentTurnIndex];
  const isMyTurn = Boolean(currentUserId && currentTurnPlayer?.uid === currentUserId);
  const winningPlayer = room.winnerId
    ? room.players.find((p) => p.uid === room.winnerId)
    : undefined;

  const handleRollDice = useCallback(async (): Promise<number | undefined> => {
    if (
      !currentUserId ||
      !isMyTurn ||
      actionInProgress ||
      actionLockRef.current ||
      room.status !== 'playing'
    ) {
      return undefined;
    }

    actionLockRef.current = true;
    setActionInProgress(true);
    setMovingPlayerId(currentUserId);
    setGameErrorNotice(null);

    if (errorDismissTimerRef.current) {
      clearTimeout(errorDismissTimerRef.current);
      errorDismissTimerRef.current = null;
    }

    try {
      const outcome = await executeDiceRollAndMove(room.id, currentUserId);
      const nowMs = Date.now();

      // Synchronize RoomView's monotonic version tracker + React room state atomically
      onCommitRoomState({
        stateVersion: outcome.stateVersion,
        playerSync: {
          uid: currentUserId,
          position: outcome.newPos,
          positionVersion: outcome.positionVersion,
          lastMoveId: outcome.moveId,
          updatedAtMs: nowMs,
        },
        applyRoomPatch: (prevRoom) => {
          const updatedPlayers = prevRoom.players.map((p) =>
            p.uid === currentUserId
              ? {
                  ...p,
                  position: outcome.newPos,
                  positionVersion: outcome.positionVersion,
                  lastMoveId: outcome.moveId,
                  updatedAtMs: nowMs,
                  rank: outcome.won ? 1 : p.rank,
                }
              : p
          );

          return {
            ...prevRoom,
            players: updatedPlayers,
            playerPositions: {
              ...(prevRoom.playerPositions || {}),
              [currentUserId]: {
                position: outcome.newPos,
                positionVersion: outcome.positionVersion,
                lastMoveId: outcome.moveId,
                updatedAtMs: nowMs,
              },
            },
            lastDiceRoll: outcome.diceRoll,
            lastMoveSummary: outcome.eventSummary,
            lastMoveId: outcome.moveId,
            lastMoveTimestamp: outcome.turnStartTimestamp,
            lastMovePath: outcome.movePath,
            lastMovingPlayerUid: currentUserId,
            currentTurnIndex: outcome.nextTurnIndex,
            turnStartTimestamp: outcome.turnStartTimestamp,
            turnDeadline: outcome.turnDeadline,
            stateVersion: outcome.stateVersion,
            status: outcome.won ? 'finished' : prevRoom.status,
            winnerId: outcome.won ? currentUserId : prevRoom.winnerId,
            winnerName: outcome.won
              ? currentUserDisplayName || prevRoom.winnerName
              : prevRoom.winnerName,
          };
        },
      });

      const animationTime = Math.max(1200, (outcome.movePath?.length || 1) * 250);
      if (animUnlockTimerRef.current) {
        clearTimeout(animUnlockTimerRef.current);
      }
      animUnlockTimerRef.current = setTimeout(() => {
        animUnlockTimerRef.current = null;
        setMovingPlayerId(null);
        setActionInProgress(false);
        actionLockRef.current = false;
      }, animationTime);

      return outcome.diceRoll;
    } catch (error: unknown) {
      console.error('Move error:', error);
      const errorMessage =
        error instanceof Error && error.message
          ? error.message
          : 'အံစာတုံးခေါက်ရာတွင် အဆင်မပြေဖြစ်သွားပါသည်။ ပြန်လည်ကြိုးစားပေးပါ။';
      setGameErrorNotice(errorMessage);
      setMovingPlayerId(null);
      setActionInProgress(false);
      actionLockRef.current = false;

      errorDismissTimerRef.current = setTimeout(() => {
        errorDismissTimerRef.current = null;
        setGameErrorNotice(null);
      }, 3500);
      return undefined;
    }
  }, [
    currentUserId,
    isMyTurn,
    actionInProgress,
    room.status,
    room.id,
    currentUserDisplayName,
    onCommitRoomState,
  ]);

  return (
    <>
      {/* Move / Turn Action Error Notification Banner */}
      {gameErrorNotice && (
        <div className="p-2.5 sm:p-3 bg-rose-50 border border-rose-300 rounded-xl text-xs font-semibold text-rose-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{gameErrorNotice}</span>
        </div>
      )}

      {/* Compact Live Players & Tile Position Strip (Exit button lives solely in GameShell Top Bar) */}
      <div className="bg-white border border-slate-200/90 rounded-2xl px-3 py-2 flex items-center justify-between gap-2 shadow-xs backdrop-blur-md">
        <span className="text-xs font-bold text-slate-600 hidden sm:inline whitespace-nowrap shrink-0">
          ကစားသမားများ
        </span>

        <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto w-full sm:w-auto py-0.5 scrollbar-none">
          {room.players.map((p, idx) => {
            const isCurrentTurn = idx === room.currentTurnIndex && room.status === 'playing';
            return (
              <div
                key={p.uid}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold border transition whitespace-nowrap shrink-0 ${
                  isCurrentTurn
                    ? 'border-amber-400 bg-amber-100 text-amber-950 shadow-xs ring-2 ring-amber-300/40'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${resolvePlayerColorClass(
                    p.color
                  )}`}
                />
                <span className="truncate max-w-[78px] sm:max-w-[110px]">{p.displayName}</span>
                <span className="text-amber-800 font-mono tabular-nums text-[11px]">
                  #{p.position}
                </span>
                {p.isConnected === false && (
                  <span title="Offline">
                    <WifiOff className="w-3 h-3 text-rose-600 shrink-0" />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Board View with Version-Protected Step Animation */}
      <GameBoard
        players={room.players}
        currentTurnIndex={room.currentTurnIndex}
        boardSkin={cosmetics.activeBoardSkin || 'board_classic'}
        movingPlayerId={movingPlayerId}
        gameRound={room.gameRound || 1}
        lastMoveId={room.lastMoveId}
        lastMovePath={room.lastMovePath}
        lastMoveTimestamp={room.lastMoveTimestamp}
        lastMovingPlayerUid={room.lastMovingPlayerUid}
      />

      {/* Turn & Dice Action Controller with 30s Countdown */}
      <DiceRoller
        isMyTurn={isMyTurn}
        currentTurnPlayer={currentTurnPlayer}
        lastDiceRoll={room.lastDiceRoll}
        lastMoveSummary={room.lastMoveSummary}
        onRollDice={handleRollDice}
        disabled={actionInProgress || room.status === 'finished'}
        diceSkin={cosmetics.activeDiceSkin || 'dice_classic'}
        turnDeadline={room.turnDeadline}
        onTimeout={onTurnTimeout}
      />

      {/* Victory Celebration Modal */}
      {room.status === 'finished' && (
        <VictoryModal
          winner={winningPlayer}
          isHost={isHost}
          isCurrentUserWinner={Boolean(currentUserId && room.winnerId === currentUserId)}
          rewardResult={rewardOutcome}
          fallbackProgress={fallbackProgress}
          isClaimingReward={isClaimingReward}
          onPlayAgain={onPlayAgain}
          onLeaveRoom={onLeaveAfterFinish}
        />
      )}
    </>
  );
};
