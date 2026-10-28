import React, { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { GameRoom, MatchRewardResult, RoomPlayer, RoomStatus } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { deriveLevelProgress } from '../../services/progressionService';
import {
  togglePlayerReady,
  startGame,
  leaveGameRoom,
  executeDiceRollAndMove,
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
import { GameBoard } from '../SnakesAndLadders/GameBoard';
import { DiceRoller } from '../SnakesAndLadders/DiceRoller';
import { VictoryModal } from '../SnakesAndLadders/VictoryModal';
import { sounds } from '../../lib/sound';
import {
  Users,
  Copy,
  Check,
  Share2,
  Play,
  LogOut,
  Crown,
  ShieldCheck,
  Clock,
  Info,
  WifiOff,
  AlertTriangle,
} from 'lucide-react';

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
  const [movingPlayerId, setMovingPlayerId] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [gameErrorNotice, setGameErrorNotice] = useState<string | null>(null);
  const [reconnectCountdown, setReconnectCountdown] = useState<number>(60);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const actionLockRef = useRef<boolean>(false);
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
      gameType: room.gameType || 'snakes_and_ladders',
      status: room.status,
    });
    if (currentUser?.uid && room.status !== 'finished') {
      saveActiveGameSession(
        currentUser.uid,
        roomId,
        room.roomCode,
        room.gameType || 'snakes_and_ladders',
        false
      );
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

  // Isolated Player Presence & Heartbeat + Mobile Tab Switch / Screen Lock / Network Recovery
  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid || !roomId) return;

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
      setIsOnline(true);
      reconnectPlayerToRoom(roomId, uid);
    };

    const handleOffline = () => {
      setIsOnline(false);
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
  }, [roomId, currentUser?.uid]);

  // Monitor Reconnection Deadline (60 Seconds)
  useEffect(() => {
    if (!room?.reconnectionDeadline) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const diffSecs = Math.max(0, Math.ceil((room.reconnectionDeadline! - now) / 1000));
      setReconnectCountdown(diffSecs);

      if (diffSecs <= 0) {
        handleReconnectionTimeout(roomId);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [room?.reconnectionDeadline, roomId]);

  // When game finishes, idempotently claim server-verified XP & Points once per match round
  useEffect(() => {
    if (!room || !currentUser?.uid) return;

    if (room.status === 'finished' && room.winnerId) {
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
    } else if (room.status !== 'finished') {
      claimedRoundKeyRef.current = null;
      setRewardOutcome(null);
      setIsClaimingReward(false);
    }
  }, [room?.status, room?.winnerId, room?.gameRound, currentUser?.uid, roomId, claimRoomMatchReward]);

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
  const currentTurnPlayer = room.players[room.currentTurnIndex];
  const isMyTurn = currentTurnPlayer?.uid === currentUser?.uid;

  // Check if all non-host players are ready
  const canStartGame =
    room.players.length >= 2 &&
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
    if (!currentUser || !currentPlayer) return;
    sounds.playClick();
    await togglePlayerReady(roomId, currentUser.uid, !currentPlayer.isReady);
  };

  const handleStartGame = async () => {
    if (!isHost || !canStartGame) return;
    sounds.playClick();
    await startGame(roomId);
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
    await leaveGameRoom(roomId, currentUser.uid);
    onExitRoom();
  };

  // Roll Dice & Atomic Execution with immediate local version registration
  const handleRollDice = async (): Promise<number | undefined> => {
    if (
      !currentUser ||
      !isMyTurn ||
      actionInProgress ||
      actionLockRef.current ||
      room.status !== 'playing'
    ) {
      return undefined;
    }

    actionLockRef.current = true;
    setActionInProgress(true);
    setMovingPlayerId(currentUser.uid);
    setGameErrorNotice(null);

    try {
      const outcome = await executeDiceRollAndMove(roomId, currentUser.uid);

      // Atomically synchronize confirmedStateRef + React room state so even if an unrelated
      // snapshot arrives before the move snapshot, there is zero flicker or position rollback
      setRoom((prevRoom) => {
        const tracker = confirmedStateRef.current;
        const nowMs = Date.now();
        const existingVer = tracker.players[currentUser.uid]?.positionVersion ?? 0;

        if (outcome.positionVersion >= existingVer) {
          tracker.players[currentUser.uid] = {
            position: outcome.newPos,
            positionVersion: outcome.positionVersion,
            lastMoveId: outcome.moveId,
            updatedAtMs: nowMs,
          };
        }

        if (!prevRoom || (prevRoom.stateVersion || 0) >= outcome.stateVersion) {
          return prevRoom;
        }

        tracker.stateVersion = outcome.stateVersion;
        const updatedPlayers = prevRoom.players.map((p) =>
          p.uid === currentUser.uid
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
            [currentUser.uid]: {
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
          lastMovingPlayerUid: currentUser.uid,
          currentTurnIndex: outcome.nextTurnIndex,
          turnStartTimestamp: outcome.turnStartTimestamp,
          turnDeadline: outcome.turnDeadline,
          stateVersion: outcome.stateVersion,
          status: outcome.won ? 'finished' : prevRoom.status,
          winnerId: outcome.won ? currentUser.uid : prevRoom.winnerId,
          winnerName: outcome.won
            ? userProfile?.displayName || prevRoom.winnerName
            : prevRoom.winnerName,
        };
      });

      // Wait for token walk animation to complete before re-enabling
      const animationTime = Math.max(1200, (outcome.movePath?.length || 1) * 250);
      setTimeout(() => {
        setMovingPlayerId(null);
        setActionInProgress(false);
        actionLockRef.current = false;
      }, animationTime);
      return outcome.diceRoll;
    } catch (error: any) {
      console.error('Move error:', error);
      setGameErrorNotice(
        error?.message || 'အံစာတုံးခေါက်ရာတွင် အဆင်မပြေဖြစ်သွားပါသည်။ ပြန်လည်ကြိုးစားပေးပါ။'
      );
      setMovingPlayerId(null);
      setActionInProgress(false);
      actionLockRef.current = false;
      setTimeout(() => setGameErrorNotice(null), 3500);
      return undefined;
    }
  };

  const handleTurnTimeoutTrigger = async () => {
    if (room.status === 'playing') {
      try {
        await handleTurnTimeout(roomId);
      } catch (err) {
        console.warn('Timeout skip error:', err);
      }
    }
  };

  const handlePlayAgain = async () => {
    if (!isHost) return;
    sounds.playClick();
    await resetRoomToPlayAgain(roomId);
  };

  // 1. WAITING / FULL LOBBY STATE (Before Host clicks Start Game)
  if (room.status === 'waiting' || room.status === 'full') {
    const lobbyMaxPlayers = normalizeMaxPlayers(room.maxPlayers);
    const emptySlotCount = Math.max(0, lobbyMaxPlayers - room.players.length);
    const isLobbyFull = room.players.length >= lobbyMaxPlayers;

    return (
      <div className="max-w-4xl mx-auto w-full p-2 sm:p-4 md:p-6 space-y-4 sm:space-y-6 text-slate-800">
        {/* Header Bar */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-4 sm:p-5 md:p-6 shadow-xs backdrop-blur-md">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center flex-wrap gap-2 text-xs text-slate-600 mb-1">
                <span className="font-bold text-amber-800">မြွေနှင့်လှေကားဂိမ်း</span>
                <span aria-hidden="true">·</span>
                {isLobbyFull ? (
                  <span className="font-bold text-emerald-700">
                    လူစုံပြီ ({room.players.length}/{lobbyMaxPlayers})
                  </span>
                ) : (
                  <span className="font-semibold text-sky-700">
                    ကစားသမား စောင့်ဆိုင်းဆဲ ({room.players.length}/{lobbyMaxPlayers})
                  </span>
                )}
                <span aria-hidden="true">·</span>
                <span className="text-slate-500">
                  {room.exactFinish ? 'အတိအကျဝင်ရန်လိုသည်' : 'သာမန်စည်းမျဉ်း'}
                </span>
              </div>
              <h1 className="text-xl md:text-2xl font-black text-slate-900 flex items-center gap-2">
                <span>အခန်းနံပါတ် -</span>
                <span className="text-amber-700 font-mono tracking-wider">{room.roomCode}</span>
              </h1>
            </div>

            {/* Quick Share Buttons */}
            <div className="flex items-center gap-2 w-full md:w-auto">
              <button
                type="button"
                onClick={handleCopyCode}
                className="flex-1 md:flex-initial min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-700 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition cursor-pointer whitespace-nowrap"
              >
                {copiedCode ? <Check className="w-4 h-4 text-emerald-600 shrink-0" /> : <Copy className="w-4 h-4 shrink-0" />}
                <span>{copiedCode ? 'ကုဒ်ကူးယူပြီး' : 'အခန်းကုဒ် ကူးမည်'}</span>
              </button>

              <button
                type="button"
                onClick={handleCopyLink}
                className="flex-1 md:flex-initial min-h-[44px] px-3.5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition shadow-xs cursor-pointer whitespace-nowrap"
              >
                {copiedLink ? <Check className="w-4 h-4 shrink-0" /> : <Share2 className="w-4 h-4 shrink-0" />}
                <span>{copiedLink ? 'Link ကူးယူပြီး' : 'သူငယ်ချင်းဖိတ်ရန် Link'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Players List Grid (2 columns on mobile so 4 players fit without pushing Start off-screen) */}
        <div className="space-y-2.5 sm:space-y-3">
          <div className="flex items-center justify-between px-1 sm:px-2">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600" />
              <span className="tabular-nums">ပါဝင်သူများ ({room.players.length} / {lobbyMaxPlayers})</span>
            </h2>
            <div className="text-[11px] sm:text-xs text-slate-500">
              အနည်းဆုံး ၂ ဦး လိုအပ်ပါသည်
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
            {room.players.map((player) => {
              const isRoomHost = player.uid === room.hostId;
              const isMe = player.uid === currentUser?.uid;

              return (
                <div
                  key={player.uid}
                  className={`relative bg-white border rounded-2xl p-3 sm:p-4 flex flex-col items-center text-center transition-all duration-200 shadow-xs ${
                    player.isReady
                      ? 'border-emerald-400 bg-emerald-50/20'
                      : 'border-slate-200'
                  }`}
                >
                  {/* Host Indicator */}
                  {isRoomHost && (
                    <div className="absolute top-2.5 left-2.5 flex items-center gap-1 bg-amber-400 text-slate-950 px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-black">
                      <Crown className="w-2.5 h-2.5 sm:w-3 sm:h-3 fill-current" />
                      <span>HOST</span>
                    </div>
                  )}

                  {/* Player Color Indicator */}
                  <div
                    className="absolute top-2.5 right-2.5 w-3 h-3 rounded-full border border-white shadow-xs"
                    style={{ backgroundColor: player.color }}
                    title="ကစားသမားအရောင်"
                  />

                  {/* Avatar */}
                  <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full overflow-hidden border-2 border-slate-200 mb-2 sm:mb-3 mt-3 sm:mt-2 shadow-inner bg-slate-100">
                    <img
                      src={player.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${player.uid}`}
                      alt={player.displayName}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Name & Player ID */}
                  <div className="font-bold text-slate-900 text-xs sm:text-sm truncate max-w-full px-1">
                    {player.displayName} {isMe && '(သင်)'}
                  </div>
                  <div className="text-[11px] font-mono text-amber-800 font-semibold mb-2 sm:mb-3">
                    {player.playerId}
                  </div>

                  {/* Ready Status */}
                  <div
                    className={`px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-bold flex items-center gap-1 whitespace-nowrap ${
                      player.isReady
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}
                  >
                    {player.isReady ? (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>အဆင်သင့်ဖြစ်ပြီ</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>စောင့်ဆိုင်းဆဲ</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Empty Slots */}
            {Array.from({ length: emptySlotCount }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="border-2 border-dashed border-slate-200/90 rounded-2xl p-4 sm:p-6 flex flex-col items-center justify-center text-center text-slate-400 bg-slate-50/50 min-h-[148px] sm:min-h-[170px]"
              >
                <Users className="w-6 h-6 sm:w-8 sm:h-8 opacity-40 mb-1.5 sm:mb-2" />
                <span className="text-[11px] sm:text-xs font-semibold">ကစားသမား စောင့်ဆိုင်းဆဲ</span>
                <span className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">ကုဒ်မျှဝေပြီး ဖိတ်ခေါ်ပါ</span>
              </div>
            ))}
          </div>
        </div>

        {/* Lobby Controls */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 shadow-xs">
          <button
            type="button"
            onClick={requestExit}
            className="w-full sm:w-auto min-h-[46px] px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm flex items-center justify-center gap-2 transition cursor-pointer border border-slate-200 whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            <span>အခန်းမှ ထွက်မည်</span>
          </button>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {/* Non-host Ready Toggle */}
            {!isHost && (
              <button
                type="button"
                onClick={handleToggleReady}
                className={`w-full sm:w-auto min-h-[48px] px-6 py-3.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition shadow-xs cursor-pointer ${
                  currentPlayer?.isReady
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-amber-400 hover:bg-amber-500 text-slate-950'
                }`}
              >
                <ShieldCheck className="w-5 h-5 shrink-0" />
                <span>
                  {currentPlayer?.isReady ? 'အဆင်သင့်ဖြစ်ပြီးပါပြီ (ပယ်ဖျက်ရန်)' : 'အဆင်သင့်ဖြစ်ပြီ'}
                </span>
              </button>
            )}

            {/* Host Start Game Button */}
            {isHost && (
              <button
                type="button"
                onClick={handleStartGame}
                disabled={!canStartGame}
                className={`w-full sm:w-auto min-h-[48px] px-7 py-3.5 rounded-xl font-black text-sm md:text-base flex items-center justify-center gap-2 transition shadow-xs ${
                  canStartGame
                    ? 'bg-amber-400 hover:bg-amber-500 text-slate-950 cursor-pointer active:scale-[0.98]'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                }`}
              >
                <Play className="w-5 h-5 fill-current shrink-0" />
                <span>
                  {room.players.length < 2
                    ? 'ကစားသမား အနည်းဆုံး ၂ ဦး လိုအပ်ပါသည်'
                    : canStartGame
                    ? 'ဂိမ်းစတင်မည်'
                    : 'အားလုံး အဆင်သင့်ဖြစ်ရန် စောင့်ဆိုင်းပါ'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Quick Instructions */}
        <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3.5 sm:p-4 flex items-start gap-3 text-xs text-slate-700">
          <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-slate-900">ဂိမ်းကစားနည်း အကျဉ်းချုပ် - </span>
            အလှည့်ကျ အံစာတုံးခေါက်ပြီး ၁ မှ ၁၀၀ သို့ ရွေ့ရမည်။ လှေကားတွေ့ပါက အပေါ်သို့ တက်နိုင်ပြီး မြွေတွေ့ပါက
            အောက်သို့ ပြန်ဆင်းရမည်။ နံပါတ် ၁၀၀ သို့ ပထမဆုံးရောက်ရှိသူသည် ချန်ပီယံဆုနှင့် ရွှေဒင်္ဂါး ရရှိမည်ဖြစ်ပါသည်။
          </div>
        </div>
      </div>
    );
  }

  // 2. ACTIVE GAMEPLAY & VICTORY STATE (Inside Dedicated Game Mode Shell)
  const winningPlayer = room.winnerId ? room.players.find((p) => p.uid === room.winnerId) : undefined;

  return (
    <div className="max-w-5xl mx-auto w-full space-y-2 sm:space-y-3 text-slate-800">
      {/* Local Offline Notice if current device lost internet */}
      {!isOnline && (
        <div className="p-2.5 sm:p-3 bg-amber-50 border border-amber-300 rounded-2xl flex items-center gap-2 text-xs font-bold text-amber-950">
          <WifiOff className="w-4 h-4 text-rose-600 shrink-0" />
          <span>
            အင်တာနက်လိုင်း ခေတ္တပြတ်တောက်နေပါသည်။ လိုင်းပြန်မိသည်နှင့် လက်ရှိကစားလက်စ နေရာမှ ဆက်လက်ကစားနိုင်ပါသည်။
          </span>
        </div>
      )}

      {/* Disconnection Grace Period Notice (60 Seconds) */}
      {room.disconnectedPlayerId && (
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

      {/* Error notification banner */}
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
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: p.color }}
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
        boardSkin={userProfile?.activeBoardSkin || 'board_classic'}
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
        diceSkin={userProfile?.activeDiceSkin || 'dice_classic'}
        turnDeadline={room.turnDeadline}
        onTimeout={handleTurnTimeoutTrigger}
      />

      {/* Victory Celebration Modal */}
      {room.status === 'finished' && (
        <VictoryModal
          winner={winningPlayer}
          isHost={isHost}
          isCurrentUserWinner={room.winnerId === currentUser?.uid}
          rewardResult={rewardOutcome}
          fallbackProgress={deriveLevelProgress(userProfile?.totalXp ?? 0)}
          isClaimingReward={isClaimingReward}
          onPlayAgain={handlePlayAgain}
          onLeaveRoom={handleLeaveAfterFinish}
        />
      )}
    </div>
  );
};
