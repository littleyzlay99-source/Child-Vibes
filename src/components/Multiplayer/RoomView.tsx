import React, { useState, useEffect, useRef, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { GameRoom, MatchRewardResult, RoomPlayer, RoomStatus } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { deriveLevelProgress } from '../../services/progressionService';
import {
  togglePlayerReady,
  startGame,
  leaveGameRoom,
  resetRoomToPlayAgain,
  handleTurnTimeout,
  updatePlayerPresence,
  markPlayerDisconnected,
  reconnectPlayerToRoom,
  handleReconnectionTimeout,
  deduplicateRoomPlayers,
  normalizeMaxPlayers,
} from '../../services/roomService';
import { saveActiveGameSession } from '../../services/gameSessionService';
import { useGameShell } from '../GameShell/GameShell';
import { UNKNOWN_GAME_FALLBACK_TITLE } from '../../games/registry';
import {
  GameModuleRenderer,
  isGameModulePlayable,
  resolveGameModule,
  type GameModuleGameplayProps,
  type RoomStateCommitPayload,
} from '../../games';
import { SharedRoomLobby } from './SharedRoomLobby';
import { sounds } from '../../lib/sound';
import { WifiOff } from 'lucide-react';

export interface RoomMetaSummary {
  roomCode: string;
  gameType: string;
  status: RoomStatus;
}

interface RoomViewProps {
  roomId: string;
  initialRoom?: GameRoom | null;
  onExitRoom: () => void;
  onRoomMetaChange?: (meta: RoomMetaSummary) => void;
}

interface ConfirmedPlayerState {
  position: number;
  positionVersion: number;
  lastMoveId: string | null;
  updatedAtMs: number;
}

/**
 * Turn-based Firestore presence heartbeats, 60s reconnection grace timers, and 30s turn skips
 * apply ONLY to turn-based Firestore rooms (e.g. `snakes_and_ladders`).
 * `snow_rush` manages real-time presence & connection inside its Cloudflare Durable Object WebSocket.
 */
export function shouldUseTurnBasedFirestoreRoomLifecycle(
  gameType?: string | null
): boolean {
  return Boolean(gameType) && gameType !== 'snow_rush';
}

/**
 * Phase 1 Public Security Policy: `snow_rush` never claims XP / Points match rewards.
 */
export function shouldAutoClaimRoomMatchReward(
  room: Pick<GameRoom, 'gameType' | 'status' | 'winnerId'> | null | undefined
): boolean {
  if (!room) return false;
  if (room.gameType === 'snow_rush') return false;
  return (
    room.status === 'finished' &&
    Boolean(room.winnerId) &&
    isGameModulePlayable(room.gameType)
  );
}

export const RoomView: React.FC<RoomViewProps> = ({
  roomId,
  initialRoom,
  onExitRoom,
  onRoomMetaChange,
}) => {
  const { currentUser, userProfile, claimRoomMatchReward } = useAuth();
  const { requestExit, isExiting } = useGameShell();
  const seededRoom = initialRoom && initialRoom.id === roomId ? initialRoom : null;
  const [room, setRoom] = useState<GameRoom | null>(seededRoom);
  const [loading, setLoading] = useState<boolean>(!seededRoom);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isTogglingReady, setIsTogglingReady] = useState(false);
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [reconnectCountdown, setReconnectCountdown] = useState<number>(60);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const onExitRoomRef = useRef(onExitRoom);
  const onRoomMetaChangeRef = useRef(onRoomMetaChange);
  const currentUidRef = useRef<string | undefined>(currentUser?.uid);

  // Authoritative version tracker across snapshots to reject stale/out-of-order positions
  const confirmedStateRef = useRef<{
    gameRound: number;
    stateVersion: number;
    players: Record<string, ConfirmedPlayerState>;
  }>({
    gameRound: 0,
    stateVersion: 0,
    players: {},
  });

  useEffect(() => {
    onExitRoomRef.current = onExitRoom;
  }, [onExitRoom]);

  useEffect(() => {
    onRoomMetaChangeRef.current = onRoomMetaChange;
  }, [onRoomMetaChange]);

  useEffect(() => {
    currentUidRef.current = currentUser?.uid;
  }, [currentUser?.uid]);

  // Synchronize live room metadata to GameShell & local session cache (zero extra Firestore writes)
  useEffect(() => {
    if (!room) return;
    onRoomMetaChangeRef.current?.({
      roomCode: room.roomCode,
      gameType: room.gameType,
      status: room.status,
    });
    if (currentUser?.uid && room.status !== 'finished' && isGameModulePlayable(room.gameType)) {
      saveActiveGameSession(currentUser.uid, roomId, room.roomCode, room.gameType, false);
    }
  }, [room?.roomCode, room?.gameType, room?.status, currentUser?.uid, roomId]);

  // Rewards state for end-game modal (idempotent per roomId + gameRound)
  const [rewardOutcome, setRewardOutcome] = useState<MatchRewardResult | null>(null);
  const [isClaimingReward, setIsClaimingReward] = useState<boolean>(false);
  const claimedRoundKeyRef = useRef<string | null>(null);
  const activeClaimPromiseRef = useRef<Promise<MatchRewardResult> | null>(null);

  // Single stable real-time room listener per roomId with strict version reconciliation
  useEffect(() => {
    let isSubscribed = true;

    // Seed version tracker from authoritative post-join/post-create initialRoom if available
    const seed = initialRoom && initialRoom.id === roomId ? initialRoom : null;
    const seededPlayersMap: Record<string, ConfirmedPlayerState> = {};
    if (seed) {
      for (const p of deduplicateRoomPlayers(seed.players, seed.playerPositions)) {
        seededPlayersMap[p.uid] = {
          position: p.position || 1,
          positionVersion: p.positionVersion || 1,
          lastMoveId: p.lastMoveId ?? null,
          updatedAtMs: p.updatedAtMs ?? 0,
        };
      }
      setRoom(seed);
      setLoading(false);
    }

    confirmedStateRef.current = {
      gameRound: seed?.gameRound || 0,
      stateVersion: seed?.stateVersion || 0,
      players: seededPlayersMap,
    };

    const roomRef = doc(db, 'rooms', roomId);
    const unsubscribe = onSnapshot(
      roomRef,
      (snapshot) => {
        if (!isSubscribed) return;

        if (!snapshot.exists()) {
          // Only exit when confirmed by server (never exit on an unpopulated local cache miss)
          if (!snapshot.metadata.fromCache) {
            onExitRoomRef.current();
            setLoading(false);
          }
          return;
        }

        const rawRoom = snapshot.data() as GameRoom;
        const incomingStateVer = rawRoom.stateVersion || 1;
        const uniqueRawPlayers = deduplicateRoomPlayers(rawRoom.players, rawRoom.playerPositions);
        const myUid = currentUidRef.current;

        // Ignore stale cached pre-join snapshots where the newly joined player isn't listed yet!
        if (
          myUid &&
          !uniqueRawPlayers.some((p) => p.uid === myUid)
        ) {
          if (
            snapshot.metadata.fromCache ||
            incomingStateVer < confirmedStateRef.current.stateVersion
          ) {
            // Stale pre-join local cache snapshot — ignore completely so we never kick Player B out!
            return;
          }

          // Server-confirmed snapshot shows user is genuinely no longer a member (e.g. left on another tab)
          onExitRoomRef.current();
          setLoading(false);
          return;
        }

        setRoom((prevRoom) => {
          const tracker = confirmedStateRef.current;
          const incomingRound = rawRoom.gameRound || 1;
          const maxPlayers = normalizeMaxPlayers(rawRoom.maxPlayers);

          // Reject snapshots belonging to an older match round
          if (tracker.gameRound > 0 && incomingRound < tracker.gameRound) {
            return prevRoom;
          }

          // New match round started (initial load or Play Again reset)
          if (incomingRound > tracker.gameRound) {
            tracker.gameRound = incomingRound;
            tracker.stateVersion = incomingStateVer;
            tracker.players = {};
          }

          // Reconcile each unique player's position strictly by highest positionVersion
          const reconciledPlayers: RoomPlayer[] = uniqueRawPlayers.map((p) => {
            const mapRec = rawRoom.playerPositions?.[p.uid];
            const pVer = typeof p.positionVersion === 'number' && p.positionVersion >= 1 ? p.positionVersion : 1;
            const mapVer = typeof mapRec?.positionVersion === 'number' ? mapRec.positionVersion : 0;

            const incomingVer = Math.max(pVer, mapVer);
            const incomingPos =
              mapRec && mapVer > pVer ? mapRec.position : (p.position || 1);
            const incomingMoveId =
              mapRec && mapVer > pVer ? mapRec.lastMoveId : (p.lastMoveId ?? null);
            const incomingUpdatedAtMs =
              mapRec && mapVer > pVer ? mapRec.updatedAtMs : (p.updatedAtMs ?? 0);

            const known = tracker.players[p.uid];
            let finalPos = incomingPos;
            let finalVer = incomingVer;
            let finalMoveId = incomingMoveId;
            let finalUpdatedAtMs = incomingUpdatedAtMs;

            if (known && incomingVer < known.positionVersion) {
              // Reject stale/lower positionVersion; keep confirmed higher version!
              finalPos = known.position;
              finalVer = known.positionVersion;
              finalMoveId = known.lastMoveId;
              finalUpdatedAtMs = known.updatedAtMs;
            } else {
              tracker.players[p.uid] = {
                position: incomingPos,
                positionVersion: incomingVer,
                lastMoveId: incomingMoveId,
                updatedAtMs: incomingUpdatedAtMs,
              };
            }

            // Merge isolated presence status without affecting position
            const presenceEntry = rawRoom.presence?.[p.uid];
            const isConnected = presenceEntry
              ? presenceEntry.isConnected !== false
              : p.isConnected !== false;
            const lastSeen = presenceEntry?.lastSeen ?? p.lastSeen;

            return {
              ...p,
              position: finalPos,
              positionVersion: finalVer,
              lastMoveId: finalMoveId,
              updatedAtMs: finalUpdatedAtMs,
              isConnected,
              lastSeen,
            };
          });

          if (prevRoom && incomingStateVer < tracker.stateVersion) {
            // Stale room-level snapshot: preserve confirmed turn/move/player list state
            return {
              ...prevRoom,
              presence: rawRoom.presence ?? prevRoom.presence,
            };
          }

          tracker.stateVersion = incomingStateVer;
          return {
            ...rawRoom,
            maxPlayers,
            playerCount: reconciledPlayers.length,
            players: reconciledPlayers,
          };
        });

        setLoading(false);
      },
      (error) => {
        console.error('Room listener error:', error);
        if (isSubscribed) {
          setLoading(false);
        }
      }
    );

    return () => {
      isSubscribed = false;
      unsubscribe();
    };
  }, [roomId]);

  // Browser online/offline indicator (zero Firestore writes)
  useEffect(() => {
    const handleOnlineStatus = () => setIsOnline(true);
    const handleOfflineStatus = () => setIsOnline(false);

    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOfflineStatus);

    return () => {
      window.removeEventListener('online', handleOnlineStatus);
      window.removeEventListener('offline', handleOfflineStatus);
    };
  }, []);

  // Isolated Turn-Based Firestore Presence & Heartbeat (Disabled for `snow_rush`)
  const activeGameType = room?.gameType;
  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid || !roomId || !shouldUseTurnBasedFirestoreRoomLifecycle(activeGameType)) {
      return;
    }

    // Initial reconnect check
    if (navigator.onLine) {
      reconnectPlayerToRoom(roomId, uid);
    }

    const heartbeatInterval = setInterval(() => {
      if (navigator.onLine && document.visibilityState === 'visible') {
        updatePlayerPresence(roomId, uid);
      }
    }, 12000);

    const handleOnline = () => {
      reconnectPlayerToRoom(roomId, uid);
    };

    const handleOffline = () => {
      markPlayerDisconnected(roomId, uid);
    };

    // Recover seamlessly when returning from mobile screen lock, app switcher, or another browser tab
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        setIsOnline(true);
        reconnectPlayerToRoom(roomId, uid);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [roomId, currentUser?.uid, activeGameType]);

  // Monitor Reconnection Deadline (60 Seconds — Turn-Based Games Only)
  useEffect(() => {
    if (
      !room?.reconnectionDeadline ||
      !shouldUseTurnBasedFirestoreRoomLifecycle(room.gameType)
    ) {
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const diffSecs = Math.max(0, Math.ceil((room.reconnectionDeadline! - now) / 1000));
      setReconnectCountdown(diffSecs);

      if (diffSecs <= 0) {
        handleReconnectionTimeout(roomId);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [room?.reconnectionDeadline, room?.gameType, roomId]);

  // When game finishes, idempotently claim server-verified XP & Points once per match round (Never for `snow_rush`)
  useEffect(() => {
    if (!room || !currentUser?.uid) return;

    if (shouldAutoClaimRoomMatchReward(room)) {
      const roundKey = `${roomId}_r${room.gameRound || 1}_${currentUser.uid}`;
      if (claimedRoundKeyRef.current === roundKey) {
        return;
      }
      claimedRoundKeyRef.current = roundKey;
      setIsClaimingReward(true);

      const claimPromise = claimRoomMatchReward(roomId, room.gameRound);
      activeClaimPromiseRef.current = claimPromise;

      claimPromise
        .then((result) => {
          setRewardOutcome(result);
        })
        .catch((err) => {
          console.error('Match reward claim error:', err);
          // Allow retry if transient network disconnect occurred
          claimedRoundKeyRef.current = null;
        })
        .finally(() => {
          if (activeClaimPromiseRef.current === claimPromise) {
            activeClaimPromiseRef.current = null;
          }
          setIsClaimingReward(false);
        });
    } else if (room.status !== 'finished' || room.gameType === 'snow_rush') {
      claimedRoundKeyRef.current = null;
      setRewardOutcome(null);
      setIsClaimingReward(false);
    }
  }, [
    room?.status,
    room?.winnerId,
    room?.gameRound,
    room?.gameType,
    currentUser?.uid,
    roomId,
    claimRoomMatchReward,
  ]);

  // Generic post-transaction room state reconciliation callback for active Game Modules
  const handleCommitRoomState = useCallback((payload: RoomStateCommitPayload) => {
    setRoom((prevRoom) => {
      const tracker = confirmedStateRef.current;

      if (payload.playerSync) {
        const { uid, position, positionVersion, lastMoveId, updatedAtMs } = payload.playerSync;
        const existingVer = tracker.players[uid]?.positionVersion ?? 0;
        if (positionVersion >= existingVer) {
          tracker.players[uid] = {
            position,
            positionVersion,
            lastMoveId,
            updatedAtMs,
          };
        }
      }

      if (!prevRoom || (prevRoom.stateVersion || 0) >= payload.stateVersion) {
        return prevRoom;
      }

      tracker.stateVersion = payload.stateVersion;
      return payload.applyRoomPatch(prevRoom);
    });
  }, []);

  if (loading || !room) {
    return (
      <div className="min-h-[420px] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" />
        <div className="text-slate-800 font-bold text-lg">
          {isOnline ? 'အခန်းချိတ်ဆက်နေပါသည်...' : 'အင်တာနက်လိုင်း ပြန်လည်ချိတ်ဆက်ရန် စောင့်ဆိုင်းနေပါသည်...'}
        </div>
        <div className="text-slate-500 text-xs sm:text-sm mt-1">
          {isOnline
            ? 'သင်၏ ကစားလက်စ ဂိမ်းအခန်းကို ပြန်လည်ရယူနေပါသည်'
            : 'လိုင်းပြန်မိသည်နှင့် ဂိမ်းအခန်းအတွင်းသို့ အလိုအလျောက် ပြန်ဝင်ပါမည်'}
        </div>
      </div>
    );
  }

  const isHost = room.hostId === currentUser?.uid;
  const currentPlayer = room.players.find((p) => p.uid === currentUser?.uid);
  const moduleResolution = resolveGameModule(room.gameType);
  const resolvedEntry = moduleResolution.registryEntry;
  const minPlayersRequired = Math.max(2, resolvedEntry?.minPlayers ?? 2);

  // Check if game module is playable, minimum player count is met, and all non-host players are ready
  const canStartGame =
    moduleResolution.kind === 'resolved' &&
    room.players.length >= minPlayersRequired &&
    room.players.every((p) => (p.uid === room.hostId ? true : p.isReady));

  const handleCopyCode = () => {
    sounds.playClick();
    navigator.clipboard.writeText(room.roomCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    sounds.playClick();
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${room.roomCode}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleToggleReady = async () => {
    if (!currentUser || !currentPlayer || isTogglingReady) return;
    sounds.playClick();
    setIsTogglingReady(true);
    try {
      await togglePlayerReady(roomId, currentUser.uid, !currentPlayer.isReady);
    } finally {
      setIsTogglingReady(false);
    }
  };

  const handleStartGame = async () => {
    if (!isHost || !canStartGame || isStartingGame) return;
    sounds.playClick();
    setIsStartingGame(true);
    try {
      await startGame(roomId);
    } finally {
      setIsStartingGame(false);
    }
  };

  const handleLeaveAfterFinish = async () => {
    if (!currentUser || isExiting) return;
    sounds.playClick();
    if (activeClaimPromiseRef.current) {
      try {
        await activeClaimPromiseRef.current;
      } catch {
        // Proceed with room exit even if claim already resolved or failed
      }
    }
    try {
      await leaveGameRoom(roomId, currentUser.uid);
    } catch (err) {
      console.warn('Post-finish leave room cleanup warning:', err);
    }
    onExitRoom();
  };

  const handleTurnTimeoutTrigger = async () => {
    if (
      room.status === 'playing' &&
      shouldUseTurnBasedFirestoreRoomLifecycle(room.gameType)
    ) {
      try {
        await handleTurnTimeout(roomId);
      } catch (err) {
        console.warn('Timeout skip error:', err);
      }
    }
  };

  const handlePlayAgain = async () => {
    if (!isHost || room.gameType === 'snow_rush') return;
    sounds.playClick();
    await resetRoomToPlayAgain(roomId);
  };

  // 1. WAITING / FULL LOBBY STATE (Delegated to reusable SharedRoomLobby)
  if (room.status === 'waiting' || room.status === 'full') {
    const lobbyMaxPlayers = normalizeMaxPlayers(room.maxPlayers);
    const lobbyGameTitle =
      resolvedEntry?.id === 'snow_rush'
        ? resolvedEntry.title
        : resolvedEntry?.shortTitle || UNKNOWN_GAME_FALLBACK_TITLE;
    const lobbyRuleSummary =
      moduleResolution.kind === 'resolved'
        ? moduleResolution.module.getRuleSummaryMm?.(room) ?? null
        : null;
    const lobbyInstructions =
      moduleResolution.kind === 'resolved'
        ? moduleResolution.module.instructionsMm
        : resolvedEntry?.description ?? null;

    return (
      <SharedRoomLobby
        roomCode={room.roomCode}
        roomStatus={room.status}
        gameTitle={lobbyGameTitle}
        gameIcon={resolvedEntry?.icon}
        ruleSummary={lobbyRuleSummary}
        instructionsText={lobbyInstructions}
        hostId={room.hostId}
        hostName={room.hostName}
        currentUserId={currentUser?.uid ?? null}
        players={room.players}
        minPlayers={minPlayersRequired}
        maxPlayers={lobbyMaxPlayers}
        isHost={isHost}
        canStartGame={canStartGame}
        isOnline={isOnline}
        isTogglingReady={isTogglingReady}
        isStartingGame={isStartingGame}
        isExiting={isExiting}
        copiedCode={copiedCode}
        copiedLink={copiedLink}
        onCopyCode={handleCopyCode}
        onCopyLink={handleCopyLink}
        onToggleReady={handleToggleReady}
        onStartGame={handleStartGame}
        onLeaveRoom={requestExit}
      />
    );
  }

  // 2. ACTIVE GAMEPLAY & VICTORY STATE (Delegated to Game Module Router inside GameShell)
  const gameplayProps: GameModuleGameplayProps = {
    room,
    currentUserId: currentUser?.uid ?? null,
    currentUserDisplayName: userProfile?.displayName ?? null,
    currentPlayer,
    isHost,
    isOnline,
    reconnectCountdown,
    cosmetics: {
      activeBoardSkin: userProfile?.activeBoardSkin || 'board_classic',
      activeDiceSkin: userProfile?.activeDiceSkin || 'dice_classic',
      activeTokenSkin: userProfile?.activeTokenSkin || 'token_crown',
      activeFrame: userProfile?.activeFrame || 'frame_gold',
    },
    rewardOutcome,
    fallbackProgress: deriveLevelProgress(userProfile?.totalXp ?? 0),
    isClaimingReward,
    isExiting,
    onCommitRoomState: handleCommitRoomState,
    onTurnTimeout: handleTurnTimeoutTrigger,
    onPlayAgain: handlePlayAgain,
    onRequestExit: requestExit,
    onLeaveAfterFinish: handleLeaveAfterFinish,
  };

  const isSnowRushActive = room.gameType === 'snow_rush';

  return (
    <div
      className={
        isSnowRushActive
          ? 'max-w-5xl mx-auto w-full flex-1 flex flex-col min-h-[500px] sm:min-h-[580px] text-slate-800'
          : 'max-w-5xl mx-auto w-full space-y-2 sm:space-y-3 text-slate-800'
      }
    >
      {/* Shared Local Offline Notice if current device lost internet (Turn-Based Games; Snow Rush renders its own in-canvas network banner) */}
      {!isOnline && !isSnowRushActive && (
        <div className="p-2.5 sm:p-3 bg-amber-50 border border-amber-300 rounded-2xl flex items-center gap-2 text-xs font-bold text-amber-950">
          <WifiOff className="w-4 h-4 text-rose-600 shrink-0" />
          <span>
            အင်တာနက်လိုင်း ခေတ္တပြတ်တောက်နေပါသည်။ လိုင်းပြန်မိသည်နှင့် လက်ရှိကစားလက်စ နေရာမှ ဆက်လက်ကစားနိုင်ပါသည်။
          </span>
        </div>
      )}

      {/* Shared Disconnection Grace Period Notice (60 Seconds — Turn-Based Games Only) */}
      {moduleResolution.kind === 'resolved' &&
        shouldUseTurnBasedFirestoreRoomLifecycle(room.gameType) &&
        room.disconnectedPlayerId && (
          <div className="p-2.5 sm:p-3 bg-amber-100 border border-amber-400 rounded-2xl flex items-center justify-between gap-2 text-xs font-bold text-amber-950 shadow-xs">
            <div className="flex items-center gap-2 min-w-0">
              <WifiOff className="w-4 h-4 text-rose-600 shrink-0" />
              <span className="truncate sm:whitespace-normal">
                ကစားသမား <strong className="text-rose-700 font-black">{room.disconnectedPlayerName}</strong> ၏
                လိုင်းပြတ်တောက်နေပါသည်။ စောင့်ဆိုင်းပေးပါ...
              </span>
            </div>
            <span className="px-2.5 py-0.5 bg-rose-600 text-white rounded-lg text-[11px] font-mono tabular-nums font-black shrink-0">
              {reconnectCountdown}s ကျန်
            </span>
          </div>
        )}

      {/* Delegated Mini-Game Gameplay Surface or Safe Burmese Fallback UI */}
      <GameModuleRenderer resolution={moduleResolution} gameplayProps={gameplayProps} />
    </div>
  );
};
