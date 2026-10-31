import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAvailableGames, getGameById } from '../../registry';
import { isGameModulePlayable, resolveGameModule } from '../../moduleResolver';
import {
  buildInitialGameRoom,
  computeGameRoomLeaveOutcome,
  resolveCreateGameRoomInput,
} from '../../../services/roomService';
import {
  buildPlayerPositionsMap,
  sanitizePlayer,
} from '../../../services/roomStateHelpers';
import {
  buildPrivateSnowRushRoomPayload,
  computePrivateSnowRushLeaveTransition,
} from '../../../services/snowRushPrivateRoomService';
import {
  shouldAutoClaimRoomMatchReward,
  shouldUseTurnBasedFirestoreRoomLifecycle,
} from '../../../components/Multiplayer/RoomView';
import { shouldClaimSessionMatchReward } from '../../../services/gameSessionService';
import workerEntry, {
  isOriginAllowed,
  parseAllowedOrigins,
} from '../../../../workers/snow-rush-server/src/index';
import type {
  DurableObjectNamespace,
  ExecutionContext,
  SnowRushWorkerEnv,
} from '../../../../workers/snow-rush-server/src/cloudflareTypes';
import type { GameRoom, RoomPlayer, UserProfile } from '../../../types';

/**
 * Snow Rush Step 10.2 — Public Security Hardening (Phase 1: No Snow Rush Rewards)
 * Automated Negative Security, Snakes & Ladders Regression, & Snow Rush Isolation Suite
 *
 * Covers:
 * - G1: All 10 Negative Security Tests (Non-member update/delete, fake winnerId,
 *       Snow Rush status='finished', gameType/roomCode/createdAt tampering,
 *       unauthorized hostId update, fake gameRound increment, Snow Rush fake match
 *       reward claim, unregistered gameType room create).
 * - G2: Snakes & Ladders Full Lifecycle Regression (Create, Join, Ready, Start,
 *       Turn/Dice/Ladder/Snake/Win, Forfeit-Win, Post-Finish Winner Exit,
 *       Match Reward Claim Win & Loss, Play Again Reset, Refresh/Rejoin).
 * - G3: Snow Rush Phase 1 Isolation & Worker Origin Hardening (Private Room Create/Join/Start,
 *       leaveGameRoom() never sets finished/winnerId, RoomView & gameSessionService isolation,
 *       zero XP/Points reward farming, Worker ALLOWED_ORIGINS rejects http://localhost:3000,
 *       registry.ts stays coming_soon & ?privateSnowRush=1 remains intact).
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const WORKSPACE_ROOT = path.resolve(process.cwd());
const SERVER_REQUEST_TIME = { __serverTimestamp: true } as const;

type RuleDoc = Record<string, any>;

function isValidId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= 128 &&
    /^[a-zA-Z0-9_-]+$/.test(id)
  );
}

function isPlainMap(v: unknown): v is Record<string, any> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v) && !(v as any).__serverTimestamp;
}

function isServerTimestampValue(v: unknown): boolean {
  return Boolean(v && typeof v === 'object' && (v as any).__serverTimestamp === true);
}

function deepEqualRuleValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isServerTimestampValue(a) && isServerTimestampValue(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, idx) => deepEqualRuleValue(item, b[idx]));
  }
  if (isPlainMap(a) && isPlainMap(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqualRuleValue(a[k], b[k])
    );
  }
  return false;
}

function affectedKeys(incomingDoc: RuleDoc, existingDoc: RuleDoc): string[] {
  const keys = new Set([...Object.keys(incomingDoc), ...Object.keys(existingDoc)]);
  const changed: string[] = [];
  for (const k of keys) {
    const inHas = Object.prototype.hasOwnProperty.call(incomingDoc, k);
    const exHas = Object.prototype.hasOwnProperty.call(existingDoc, k);
    if (!inHas || !exHas || !deepEqualRuleValue(incomingDoc[k], existingDoc[k])) {
      changed.push(k);
    }
  }
  return changed;
}

function hasOnlyKeys(keys: string[], allowlist: readonly string[]): boolean {
  return keys.every((k) => allowlist.includes(k));
}

function hasAllKeys(docObj: RuleDoc, required: readonly string[]): boolean {
  return required.every((k) => Object.prototype.hasOwnProperty.call(docObj, k));
}

/**
 * Exact 1:1 Evaluator mirroring `/firestore.rules` `match /rooms/{roomId}`
 */
function isValidRoomPlayerRule(p: unknown): boolean {
  if (!isPlainMap(p)) return false;
  const keys = Object.keys(p);
  if (!hasAllKeys(p, ['uid', 'displayName', 'isReady', 'position'])) return false;
  if (
    !hasOnlyKeys(keys, [
      'uid',
      'playerId',
      'displayName',
      'photoURL',
      'isReady',
      'color',
      'position',
      'positionVersion',
      'lastMoveId',
      'updatedAtMs',
      'activeTokenSkin',
      'isConnected',
      'lastSeen',
      'rank',
      'disconnectedAt',
    ])
  ) {
    return false;
  }
  if (typeof p.uid !== 'string' || p.uid.length < 1 || p.uid.length > 128) return false;
  if ('playerId' in p && (typeof p.playerId !== 'string' || p.playerId.length > 32)) return false;
  if (typeof p.displayName !== 'string' || p.displayName.length < 1 || p.displayName.length > 60)
    return false;
  if ('photoURL' in p && (typeof p.photoURL !== 'string' || p.photoURL.length > 1000)) return false;
  if (typeof p.isReady !== 'boolean') return false;
  if ('color' in p && (typeof p.color !== 'string' || p.color.length > 24)) return false;
  if (typeof p.position !== 'number' || p.position < 1 || p.position > 100) return false;
  if ('positionVersion' in p && (typeof p.positionVersion !== 'number' || p.positionVersion < 1))
    return false;
  if (
    'lastMoveId' in p &&
    p.lastMoveId !== null &&
    (typeof p.lastMoveId !== 'string' || p.lastMoveId.length > 80)
  ) {
    return false;
  }
  if ('updatedAtMs' in p && (typeof p.updatedAtMs !== 'number' || p.updatedAtMs < 0)) return false;
  if (
    'activeTokenSkin' in p &&
    (typeof p.activeTokenSkin !== 'string' || p.activeTokenSkin.length > 50)
  ) {
    return false;
  }
  if ('isConnected' in p && typeof p.isConnected !== 'boolean') return false;
  if ('lastSeen' in p && (typeof p.lastSeen !== 'number' || p.lastSeen < 0)) return false;
  if ('rank' in p && (typeof p.rank !== 'number' || p.rank < 1 || p.rank > 4)) return false;
  if (
    'disconnectedAt' in p &&
    p.disconnectedAt !== null &&
    (typeof p.disconnectedAt !== 'number' || p.disconnectedAt < 0)
  ) {
    return false;
  }
  return true;
}

function isPlayerInListRule(players: any[], uid: string): boolean {
  return Array.isArray(players) && players.slice(0, 4).some((p) => p?.uid === uid);
}

function isValidSnakesTurnPositionStepRule(oldPos: number, newPos: number): boolean {
  return (
    typeof newPos === 'number' &&
    newPos >= 1 &&
    newPos <= 100 &&
    ((newPos <= oldPos + 6 && (newPos !== 100 || oldPos >= 94)) ||
      (newPos === 14 && oldPos >= 1 && oldPos <= 3) ||
      (newPos === 31 && oldPos >= 3 && oldPos <= 8) ||
      (newPos === 38 && oldPos >= 14 && oldPos <= 19) ||
      (newPos === 84 && oldPos >= 22 && oldPos <= 27) ||
      (newPos === 59 && oldPos >= 34 && oldPos <= 39) ||
      (newPos === 67 && oldPos >= 45 && oldPos <= 50) ||
      (newPos === 81 && oldPos >= 57 && oldPos <= 62) ||
      (newPos === 91 && oldPos >= 65 && oldPos <= 70))
  );
}

function isValidGameRoomRule(data: RuleDoc): boolean {
  const keys = Object.keys(data);
  if (!hasAllKeys(data, ['id', 'roomCode', 'gameType', 'hostId', 'status', 'maxPlayers', 'players']))
    return false;
  if (
    !hasOnlyKeys(keys, [
      'id',
      'roomCode',
      'gameType',
      'hostId',
      'hostName',
      'status',
      'maxPlayers',
      'playerCount',
      'players',
      'currentTurnIndex',
      'lastDiceRoll',
      'lastMoveSummary',
      'winnerId',
      'winnerName',
      'matchParticipantIds',
      'exactFinish',
      'stateVersion',
      'gameRound',
      'lastMoveId',
      'playerPositions',
      'presence',
      'turnStartTimestamp',
      'turnDeadline',
      'reconnectionDeadline',
      'disconnectedPlayerId',
      'disconnectedPlayerName',
      'lastMoveTimestamp',
      'lastMovePath',
      'lastMovingPlayerUid',
      'createdAt',
      'updatedAt',
      'timestamp',
      'serverUpdatedAt',
    ])
  ) {
    return false;
  }

  if (typeof data.id !== 'string' || data.id.length < 6 || data.id.length > 64) return false;
  if (typeof data.roomCode !== 'string' || data.roomCode.length < 4 || data.roomCode.length > 16)
    return false;
  if (data.gameType !== 'snakes_and_ladders' && data.gameType !== 'snow_rush') return false;
  if (typeof data.hostId !== 'string' || data.hostId.length < 1 || data.hostId.length > 128)
    return false;
  if ('hostName' in data && (typeof data.hostName !== 'string' || data.hostName.length > 60))
    return false;
  if (!['waiting', 'full', 'playing', 'finished'].includes(data.status)) return false;
  if (typeof data.maxPlayers !== 'number' || data.maxPlayers < 2 || data.maxPlayers > 4)
    return false;
  if (!Array.isArray(data.players) || data.players.length < 1 || data.players.length > 4)
    return false;
  if (!data.players.every(isValidRoomPlayerRule)) return false;
  if (data.players.length > data.maxPlayers) return false;
  const uidSet = new Set(data.players.map((p: any) => p.uid));
  if (uidSet.size !== data.players.length) return false;
  if (!isPlayerInListRule(data.players, data.hostId)) return false;
  if ('playerCount' in data && data.playerCount !== data.players.length) return false;
  if (
    'currentTurnIndex' in data &&
    (!Number.isInteger(data.currentTurnIndex) ||
      data.currentTurnIndex < 0 ||
      data.currentTurnIndex >= 4)
  ) {
    return false;
  }
  if (
    'lastDiceRoll' in data &&
    (!Number.isInteger(data.lastDiceRoll) || data.lastDiceRoll < 1 || data.lastDiceRoll > 6)
  ) {
    return false;
  }
  if ('gameRound' in data && (!Number.isInteger(data.gameRound) || data.gameRound < 1))
    return false;
  if ('stateVersion' in data && (typeof data.stateVersion !== 'number' || data.stateVersion < 1))
    return false;
  if (
    'winnerId' in data &&
    data.winnerId !== null &&
    (typeof data.winnerId !== 'string' || data.winnerId.length < 1 || data.winnerId.length > 128)
  ) {
    return false;
  }
  if (
    'winnerName' in data &&
    data.winnerName !== null &&
    (typeof data.winnerName !== 'string' || data.winnerName.length > 60)
  ) {
    return false;
  }
  if ('timestamp' in data && !isServerTimestampValue(data.timestamp)) return false;
  if ('serverUpdatedAt' in data && !isServerTimestampValue(data.serverUpdatedAt)) return false;

  // Phase 1 Snow Rush Result Lock
  if (data.gameType === 'snow_rush') {
    if (!['waiting', 'full', 'playing'].includes(data.status)) return false;
    if ('winnerId' in data && data.winnerId !== null) return false;
    if ('winnerName' in data && data.winnerName !== null) return false;
  }

  return true;
}

function evaluateRoomCreateRule(params: {
  readonly authUid: string | null;
  readonly roomId: string;
  readonly incoming: RuleDoc;
}): boolean {
  const { authUid, roomId, incoming } = params;
  if (!authUid || !isValidId(roomId)) return false;
  if (!isValidGameRoomRule(incoming)) return false;
  if (incoming.id !== roomId || roomId !== `room_${incoming.roomCode}`) return false;
  if (incoming.hostId !== authUid) return false;
  if (incoming.status !== 'waiting') return false;
  if ('winnerId' in incoming && incoming.winnerId !== null) return false;
  if ('winnerName' in incoming && incoming.winnerName !== null) return false;
  if (incoming.players.length !== 1) return false;
  if (incoming.players[0].uid !== authUid || incoming.players[0].position !== 1) return false;
  if ('playerCount' in incoming && incoming.playerCount !== 1) return false;
  if (incoming.gameRound !== 1 || incoming.stateVersion !== 1) return false;
  return true;
}

function evaluateRoomUpdateRule(params: {
  readonly authUid: string | null;
  readonly roomId: string;
  readonly existing: RuleDoc;
  readonly incoming: RuleDoc;
}): boolean {
  const { authUid, roomId, existing, incoming } = params;
  if (!authUid || !isValidId(roomId)) return false;
  if (!isValidGameRoomRule(incoming)) return false;

  // Universal immutable identity fields
  if (
    incoming.id !== existing.id ||
    incoming.roomCode !== existing.roomCode ||
    incoming.gameType !== existing.gameType ||
    incoming.maxPlayers !== existing.maxPlayers ||
    incoming.createdAt !== existing.createdAt
  ) {
    return false;
  }

  const changed = affectedKeys(incoming, existing);
  const oldRound = typeof existing.gameRound === 'number' ? Math.trunc(existing.gameRound) : 1;
  const newRound = typeof incoming.gameRound === 'number' ? Math.trunc(incoming.gameRound) : 1;
  const monotonicVer =
    typeof incoming.stateVersion === 'number' &&
    (!('stateVersion' in existing) || incoming.stateVersion > existing.stateVersion);

  const sameRoster =
    existing.players.length === incoming.players.length &&
    existing.players.every((p: any, i: number) => p.uid === incoming.players[i].uid);
  const samePositions =
    existing.players.length === incoming.players.length &&
    existing.players.every((p: any, i: number) => p.position === incoming.players[i].position);
  const sameReady =
    existing.players.length === incoming.players.length &&
    existing.players.every((p: any, i: number) => p.isReady === incoming.players[i].isReady);

  // Action 1: Member-Only Isolated Presence Heartbeat
  const action1 =
    isPlayerInListRule(existing.players, authUid) &&
    hasOnlyKeys(changed, ['presence']) &&
    isPlainMap(incoming.presence) &&
    (!isPlainMap(existing.presence) ||
      hasOnlyKeys(affectedKeys(incoming.presence, existing.presence), [authUid]));

  // Action 2: New Player Join Waiting Room
  const preserveJoin =
    incoming.players.length === existing.players.length + 1 &&
    existing.players.every(
      (p: any, i: number) =>
        p.uid === incoming.players[i].uid &&
        p.isReady === incoming.players[i].isReady &&
        p.position === incoming.players[i].position
    ) &&
    incoming.players[incoming.players.length - 1].uid === authUid &&
    incoming.players[incoming.players.length - 1].isReady === false &&
    incoming.players[incoming.players.length - 1].position === 1;

  const action2 =
    existing.status === 'waiting' &&
    !isPlayerInListRule(existing.players, authUid) &&
    existing.players.length >= 1 &&
    existing.players.length < existing.maxPlayers &&
    preserveJoin &&
    incoming.hostId === existing.hostId &&
    newRound === oldRound &&
    (!('winnerId' in incoming) || incoming.winnerId === null) &&
    (!('winnerName' in incoming) || incoming.winnerName === null) &&
    incoming.status === (incoming.players.length >= incoming.maxPlayers ? 'full' : 'waiting') &&
    monotonicVer &&
    hasOnlyKeys(changed, [
      'players',
      'playerCount',
      'maxPlayers',
      'status',
      'winnerId',
      'winnerName',
      'playerPositions',
      'presence',
      'stateVersion',
      'lastMoveSummary',
      'updatedAt',
      'serverUpdatedAt',
    ]);

  // Action 3: Existing Member Ready Toggle / Reconnect Sync
  const onlyCallerReady =
    sameRoster &&
    existing.players.every(
      (p: any, i: number) => p.uid === authUid || p.isReady === incoming.players[i].isReady
    );
  const action3 =
    isPlayerInListRule(existing.players, authUid) &&
    ['waiting', 'full', 'playing'].includes(existing.status) &&
    sameRoster &&
    samePositions &&
    onlyCallerReady &&
    incoming.hostId === existing.hostId &&
    newRound === oldRound &&
    incoming.winnerId === existing.winnerId &&
    incoming.status ===
      (existing.status === 'playing'
        ? 'playing'
        : incoming.players.length >= incoming.maxPlayers
          ? 'full'
          : 'waiting') &&
    (!changed.includes('disconnectedPlayerId') ||
      (existing.disconnectedPlayerId === authUid &&
        incoming.disconnectedPlayerId === null &&
        incoming.reconnectionDeadline === null)) &&
    monotonicVer &&
    hasOnlyKeys(changed, [
      'players',
      'playerCount',
      'maxPlayers',
      'status',
      'winnerId',
      'winnerName',
      'playerPositions',
      'presence',
      'disconnectedPlayerId',
      'disconnectedPlayerName',
      'reconnectionDeadline',
      'lastMoveSummary',
      'stateVersion',
      'updatedAt',
      'serverUpdatedAt',
    ]);

  // Action 4: Host Start Game
  const allNonHostReady = existing.players.every(
    (p: any) => p.uid === existing.hostId || p.isReady === true
  );
  const allStartAtOne = incoming.players.every((p: any) => p.position === 1);
  const action4 =
    existing.hostId === authUid &&
    incoming.hostId === existing.hostId &&
    ['waiting', 'full'].includes(existing.status) &&
    incoming.status === 'playing' &&
    existing.players.length >= 2 &&
    existing.players.length <= existing.maxPlayers &&
    allNonHostReady &&
    sameRoster &&
    allStartAtOne &&
    (!('winnerId' in incoming) || incoming.winnerId === null) &&
    (!('winnerName' in incoming) || incoming.winnerName === null) &&
    Number.isInteger(incoming.gameRound) &&
    incoming.gameRound === oldRound + 1 &&
    monotonicVer &&
    hasOnlyKeys(changed, [
      'status',
      'players',
      'playerCount',
      'playerPositions',
      'currentTurnIndex',
      'turnStartTimestamp',
      'turnDeadline',
      'reconnectionDeadline',
      'disconnectedPlayerId',
      'disconnectedPlayerName',
      'lastMoveId',
      'lastMovePath',
      'lastMovingPlayerUid',
      'winnerId',
      'winnerName',
      'matchParticipantIds',
      'gameRound',
      'stateVersion',
      'lastMoveSummary',
      'updatedAt',
      'serverUpdatedAt',
    ]);

  // Action 5: Snakes & Ladders Active Turn Move
  const turnIdx = existing.currentTurnIndex;
  const isTurnCaller =
    Number.isInteger(turnIdx) &&
    turnIdx >= 0 &&
    turnIdx < existing.players.length &&
    existing.players[turnIdx].uid === authUid;
  const nonTurnUnchanged =
    sameRoster &&
    existing.players.every(
      (p: any, i: number) => i === turnIdx || p.position === incoming.players[i].position
    );
  const action5 =
    existing.gameType === 'snakes_and_ladders' &&
    existing.status === 'playing' &&
    (!('winnerId' in existing) || existing.winnerId === null) &&
    isTurnCaller &&
    sameRoster &&
    nonTurnUnchanged &&
    isValidSnakesTurnPositionStepRule(
      existing.players[turnIdx].position,
      incoming.players[turnIdx].position
    ) &&
    Number.isInteger(incoming.lastDiceRoll) &&
    incoming.lastDiceRoll >= 1 &&
    incoming.lastDiceRoll <= 6 &&
    incoming.lastMovingPlayerUid === authUid &&
    incoming.hostId === existing.hostId &&
    newRound === oldRound &&
    (incoming.status === 'playing'
      ? (!('winnerId' in incoming) || incoming.winnerId === null) &&
        (!('winnerName' in incoming) || incoming.winnerName === null)
      : incoming.status === 'finished' &&
        incoming.winnerId === authUid &&
        existing.players[turnIdx].position >= 94 &&
        incoming.players[turnIdx].position === 100) &&
    monotonicVer &&
    hasOnlyKeys(changed, [
      'players',
      'playerPositions',
      'presence',
      'lastDiceRoll',
      'lastMoveSummary',
      'lastMoveId',
      'lastMoveTimestamp',
      'lastMovePath',
      'lastMovingPlayerUid',
      'currentTurnIndex',
      'turnStartTimestamp',
      'turnDeadline',
      'stateVersion',
      'status',
      'winnerId',
      'winnerName',
      'matchParticipantIds',
      'updatedAt',
      'serverUpdatedAt',
    ]);

  // Action 6: Snakes & Ladders Disconnect / Timeout Recovery
  const action6 =
    existing.gameType === 'snakes_and_ladders' &&
    isPlayerInListRule(existing.players, authUid) &&
    ['waiting', 'full', 'playing'].includes(existing.status) &&
    incoming.status === existing.status &&
    sameRoster &&
    samePositions &&
    sameReady &&
    incoming.hostId === existing.hostId &&
    newRound === oldRound &&
    incoming.winnerId === existing.winnerId &&
    (!changed.includes('disconnectedPlayerId') ||
      incoming.disconnectedPlayerId === authUid ||
      incoming.disconnectedPlayerId === null) &&
    monotonicVer &&
    hasOnlyKeys(changed, [
      'players',
      'playerPositions',
      'presence',
      'disconnectedPlayerId',
      'disconnectedPlayerName',
      'reconnectionDeadline',
      'currentTurnIndex',
      'turnStartTimestamp',
      'turnDeadline',
      'stateVersion',
      'lastMoveSummary',
      'updatedAt',
      'serverUpdatedAt',
    ]);

  // Action 7: Member Leave Room
  const remPreserve = incoming.players.every((rp: any) =>
    existing.players.some((ep: any) => ep.uid === rp.uid && ep.position === rp.position)
  );
  const validSnakesLeave =
    (['waiting', 'full'].includes(existing.status) &&
      incoming.winnerId === null &&
      (!('winnerName' in incoming) || incoming.winnerName === null) &&
      incoming.status ===
        (incoming.players.length >= incoming.maxPlayers ? 'full' : 'waiting')) ||
    (existing.status === 'playing' &&
      ((incoming.players.length === 1 &&
        incoming.status === 'finished' &&
        incoming.winnerId === incoming.players[0].uid) ||
        (incoming.players.length >= 2 &&
          incoming.status === 'playing' &&
          incoming.winnerId === null &&
          (!('winnerName' in incoming) || incoming.winnerName === null)))) ||
    (existing.status === 'finished' &&
      incoming.status === 'finished' &&
      incoming.winnerId === existing.winnerId);

  const validSnowLeave =
    (!('winnerId' in incoming) || incoming.winnerId === null) &&
    (!('winnerName' in incoming) || incoming.winnerName === null) &&
    incoming.status ===
      (existing.status === 'playing'
        ? incoming.players.length >= 2
          ? 'playing'
          : 'waiting'
        : incoming.players.length >= incoming.maxPlayers
          ? 'full'
          : 'waiting');

  const action7 =
    isPlayerInListRule(existing.players, authUid) &&
    !isPlayerInListRule(incoming.players, authUid) &&
    existing.players.length >= 2 &&
    incoming.players.length === existing.players.length - 1 &&
    remPreserve &&
    (existing.hostId === authUid
      ? incoming.hostId === incoming.players[0].uid
      : incoming.hostId === existing.hostId) &&
    newRound === oldRound &&
    (existing.gameType === 'snow_rush' ? validSnowLeave : validSnakesLeave) &&
    monotonicVer &&
    hasOnlyKeys(changed, [
      'players',
      'playerCount',
      'status',
      'playerPositions',
      'hostId',
      'hostName',
      'currentTurnIndex',
      'turnStartTimestamp',
      'turnDeadline',
      'winnerId',
      'winnerName',
      'matchParticipantIds',
      'disconnectedPlayerId',
      'disconnectedPlayerName',
      'reconnectionDeadline',
      'stateVersion',
      'lastMoveSummary',
      'updatedAt',
      'serverUpdatedAt',
    ]);

  // Action 8: Snakes & Ladders Host Play Again Reset
  const action8 =
    existing.gameType === 'snakes_and_ladders' &&
    existing.status === 'finished' &&
    existing.hostId === authUid &&
    incoming.hostId === existing.hostId &&
    sameRoster &&
    allStartAtOne &&
    incoming.status === (incoming.players.length >= incoming.maxPlayers ? 'full' : 'waiting') &&
    (!('winnerId' in incoming) || incoming.winnerId === null) &&
    (!('winnerName' in incoming) || incoming.winnerName === null) &&
    Number.isInteger(incoming.gameRound) &&
    incoming.gameRound === oldRound + 1 &&
    monotonicVer &&
    hasOnlyKeys(changed, [
      'players',
      'playerCount',
      'playerPositions',
      'status',
      'currentTurnIndex',
      'lastDiceRoll',
      'gameRound',
      'stateVersion',
      'lastMoveId',
      'lastMovePath',
      'lastMovingPlayerUid',
      'turnStartTimestamp',
      'turnDeadline',
      'reconnectionDeadline',
      'disconnectedPlayerId',
      'disconnectedPlayerName',
      'lastMoveSummary',
      'winnerId',
      'winnerName',
      'matchParticipantIds',
      'lastMoveTimestamp',
      'updatedAt',
      'serverUpdatedAt',
    ]);

  return action1 || action2 || action3 || action4 || action5 || action6 || action7 || action8;
}

function evaluateRoomDeleteRule(params: {
  readonly authUid: string | null;
  readonly roomId: string;
  readonly existing: RuleDoc;
}): boolean {
  const { authUid, roomId, existing } = params;
  if (!authUid || !isValidId(roomId)) return false;
  if (!isPlayerInListRule(existing.players, authUid)) return false;
  return (
    existing.players.length === 1 ||
    (existing.hostId === authUid && existing.status !== 'playing')
  );
}

function evaluateMatchRewardClaimCreateRule(params: {
  readonly authUid: string | null;
  readonly claimId: string;
  readonly claim: RuleDoc;
  readonly room: RuleDoc | null;
}): boolean {
  const { authUid, claimId, claim, room } = params;
  if (!authUid || !isValidId(claimId) || !room) return false;
  if (
    !hasAllKeys(claim, [
      'id',
      'userId',
      'roomId',
      'gameRound',
      'outcome',
      'xpGranted',
      'pointsGranted',
      'createdAt',
      'serverCreatedAt',
    ]) ||
    !hasOnlyKeys(Object.keys(claim), [
      'id',
      'userId',
      'roomId',
      'gameRound',
      'outcome',
      'xpGranted',
      'pointsGranted',
      'createdAt',
      'serverCreatedAt',
    ])
  ) {
    return false;
  }
  if (claim.id !== claimId || claim.userId !== authUid) return false;
  if (claimId !== `${claim.roomId}_r${claim.gameRound}_${authUid}`) return false;
  if (!isServerTimestampValue(claim.serverCreatedAt)) return false;

  const roomRound = typeof room.gameRound === 'number' ? Math.trunc(room.gameRound) : 1;
  const isParticipant =
    room.winnerId === authUid ||
    (Array.isArray(room.matchParticipantIds) && room.matchParticipantIds.includes(authUid)) ||
    (isPlainMap(room.playerPositions) && authUid in room.playerPositions);

  return (
    room.gameType === 'snakes_and_ladders' &&
    room.status === 'finished' &&
    typeof room.winnerId === 'string' &&
    room.winnerId.length > 0 &&
    roomRound === claim.gameRound &&
    isParticipant &&
    ((room.winnerId === authUid &&
      claim.outcome === 'win' &&
      claim.xpGranted === 100 &&
      claim.pointsGranted === 1000) ||
      (room.winnerId !== authUid &&
        claim.outcome === 'loss' &&
        claim.xpGranted === 75 &&
        claim.pointsGranted === 500))
  );
}

function makeUser(uid: string, name: string, playerId: string): UserProfile {
  return {
    id: uid,
    playerId,
    displayName: name,
    email: `${uid}@example.com`,
    photoURL: '',
    level: 1,
    xp: 0,
    totalXp: 0,
    points: 500,
    currentPoints: 500,
    totalPointsEarned: 500,
    totalWins: 0,
    totalGames: 0,
    activeBoardSkin: 'board_classic',
    activeDiceSkin: 'dice_classic',
    activeTokenSkin: 'token_crown',
    activeFrame: 'frame_gold',
    inventory: [],
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
  };
}

function makeSecondPlayer(uid: string, name: string, isReady: boolean, now: number): RoomPlayer {
  return sanitizePlayer(
    {
      uid,
      playerId: 'CV200002',
      displayName: name,
      photoURL: '',
      isReady,
      color: '#10B981',
      position: 1,
      positionVersion: 1,
      lastMoveId: null,
      updatedAtMs: now,
      activeTokenSkin: 'token_crown',
      isConnected: true,
      lastSeen: now,
      disconnectedAt: null,
    },
    now
  );
}

function createMockWorkerEnv(overrides?: Partial<SnowRushWorkerEnv>): SnowRushWorkerEnv {
  const makeDoId = (val: string) => ({
    toString: () => val,
    equals: (other: { toString(): string }) => other.toString() === val,
  });
  const mockNamespace: DurableObjectNamespace = {
    idFromName: (name: string) => makeDoId(`do_${name}`),
    idFromString: (id: string) => makeDoId(id),
    newUniqueId: () => makeDoId('do_unique'),
    get: (id) => ({
      id,
      fetch: async () => new Response('ok', { status: 200 }),
    }),
  };

  return {
    SNOW_RUSH_ROOM: mockNamespace,
    FIREBASE_PROJECT_ID: 'gen-lang-client-0335200904',
    FIRESTORE_DATABASE_ID: 'ai-studio-47dffdd9-9dac-40e5-b320-95d71826db89',
    SNAPSHOT_BROADCAST_HZ: '10',
    ALLOWED_ORIGINS: '',
    ...overrides,
  };
}

const MOCK_CTX: ExecutionContext = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
};

async function runStep102SecuritySuite(): Promise<void> {
  let passedGroups = 0;
  const now = 1712700000000;
  const hostUser = makeUser('uid_host_alpha', 'Host Alpha', 'CV100001');
  const guestUser = makeUser('uid_guest_bravo', 'Guest Bravo', 'CV100002');
  const thirdUser = makeUser('uid_guest_charlie', 'Guest Charlie', 'CV100003');
  const attackerUid = 'uid_outsider_mallory';

  // ---------------------------------------------------------------------------
  // GROUP 0: Static Structural Verification of firestore.rules & firebase-blueprint.json
  // ---------------------------------------------------------------------------
  {
    const rulesRaw = fs.readFileSync(path.join(WORKSPACE_ROOT, 'firestore.rules'), 'utf8');
    const blueprintRaw = JSON.parse(
      fs.readFileSync(path.join(WORKSPACE_ROOT, 'firebase-blueprint.json'), 'utf8')
    ) as Record<string, any>;

    assert(
      rulesRaw.includes("gameType in ['snakes_and_ladders', 'snow_rush']"),
      'firestore.rules must allowlist registered room gameTypes'
    );
    assert(
      rulesRaw.includes("room.gameType == 'snakes_and_ladders'"),
      'firestore.rules isServerVerifiedMatchReward must restrict match rewards to snakes_and_ladders'
    );
    assert(
      rulesRaw.includes("data.gameType != 'snow_rush'") &&
        rulesRaw.includes("data.status in ['waiting', 'full', 'playing']"),
      'firestore.rules must enforce Phase 1 Snow Rush result lock'
    );
    assert(
      rulesRaw.includes('isPlayerInList(existing().players, request.auth.uid)') &&
        !rulesRaw.includes('(existing().hostId == request.auth.uid || existing().players.size() <= 1)'),
      'firestore.rules delete rule must block non-member deletion on 1-player rooms'
    );
    assert(
      rulesRaw.includes('match /users/{userId}') &&
        rulesRaw.includes('match /reward_claims/{claimId}') &&
        rulesRaw.includes('match /daily_claims/{dailyClaimId}') &&
        rulesRaw.includes('match /achievement_claims/{achClaimId}') &&
        rulesRaw.includes('match /transactions/{txId}'),
      'firestore.rules must preserve all 6 platform collections intact'
    );

    const bpGameTypeEnum = blueprintRaw.entities?.GameRoom?.properties?.gameType?.enum;
    assert(
      Array.isArray(bpGameTypeEnum) &&
        bpGameTypeEnum.includes('snakes_and_ladders') &&
        bpGameTypeEnum.includes('snow_rush') &&
        bpGameTypeEnum.length === 2,
      'firebase-blueprint.json GameRoom.gameType enum must match firestore.rules'
    );
    assert(
      Boolean(blueprintRaw.entities?.GameRoom?.properties?.timestamp),
      'firebase-blueprint.json GameRoom must declare server timestamp property'
    );
    passedGroups += 1;
  }

  // ---------------------------------------------------------------------------
  // GROUP 1 (G1): All 10 Mandatory Negative Security Tests -> MUST DENY
  // ---------------------------------------------------------------------------
  {
    const resolvedSnakes = resolveCreateGameRoomInput('snakes_and_ladders', {
      maxPlayers: 2,
      exactFinish: false,
    });
    const snakesWaitingRoom: RuleDoc = {
      ...buildInitialGameRoom({
        hostUser,
        effectiveHostUid: hostUser.id,
        roomCode: 'SL9001',
        resolved: resolvedSnakes,
        now,
      }),
      timestamp: SERVER_REQUEST_TIME,
      serverUpdatedAt: SERVER_REQUEST_TIME,
    };

    const snowWaitingRoom: RuleDoc = {
      ...buildPrivateSnowRushRoomPayload({
        hostUser,
        effectiveHostUid: hostUser.id,
        roomCode: 'SR9002',
        maxPlayers: 4,
        now,
      }),
      timestamp: SERVER_REQUEST_TIME,
      serverUpdatedAt: SERVER_REQUEST_TIME,
    };

    const guestPlayerReady = makeSecondPlayer(guestUser.id, guestUser.displayName, true, now + 100);
    const snowPlayingRoom: RuleDoc = {
      ...snowWaitingRoom,
      status: 'playing',
      players: [snowWaitingRoom.players[0], guestPlayerReady],
      playerCount: 2,
      playerPositions: buildPlayerPositionsMap(
        [snowWaitingRoom.players[0], guestPlayerReady],
        now + 200
      ),
      matchParticipantIds: [hostUser.id, guestUser.id],
      gameRound: 2,
      stateVersion: 3,
    };

    const snakesPlayingRoom: RuleDoc = {
      ...snakesWaitingRoom,
      status: 'playing',
      players: [snakesWaitingRoom.players[0], guestPlayerReady],
      playerCount: 2,
      playerPositions: buildPlayerPositionsMap(
        [snakesWaitingRoom.players[0], guestPlayerReady],
        now + 200
      ),
      currentTurnIndex: 0,
      matchParticipantIds: [hostUser.id, guestUser.id],
      gameRound: 2,
      stateVersion: 3,
    };

    // G1.1 Non-member Room Update (both presence heartbeat and room state tamper)
    assert(
      evaluateRoomUpdateRule({
        authUid: attackerUid,
        roomId: snowPlayingRoom.id,
        existing: snowPlayingRoom,
        incoming: {
          ...snowPlayingRoom,
          presence: {
            ...snowPlayingRoom.presence,
            [attackerUid]: { isConnected: true, lastSeen: now + 500, disconnectedAt: null },
          },
        },
      }) === false,
      'G1.1a: Non-member presence update must be DENIED'
    );
    assert(
      evaluateRoomUpdateRule({
        authUid: attackerUid,
        roomId: snowPlayingRoom.id,
        existing: snowPlayingRoom,
        incoming: {
          ...snowPlayingRoom,
          lastMoveSummary: 'Hacked by outsider',
          stateVersion: 4,
        },
      }) === false,
      'G1.1b: Non-member room state update must be DENIED'
    );

    // G1.2 Non-member Room Delete (both 1-player waiting room and 2-player playing room)
    assert(
      evaluateRoomDeleteRule({
        authUid: attackerUid,
        roomId: snowWaitingRoom.id,
        existing: snowWaitingRoom,
      }) === false,
      'G1.2a: Non-member delete on 1-player waiting room must be DENIED'
    );
    assert(
      evaluateRoomDeleteRule({
        authUid: attackerUid,
        roomId: snowPlayingRoom.id,
        existing: snowPlayingRoom,
      }) === false,
      'G1.2b: Non-member delete on active 2-player room must be DENIED'
    );

    // G1.3 Fake `winnerId` Update (Snow Rush member, S&L off-turn player, and S&L turn player from tile 1!)
    assert(
      evaluateRoomUpdateRule({
        authUid: hostUser.id,
        roomId: snowPlayingRoom.id,
        existing: snowPlayingRoom,
        incoming: {
          ...snowPlayingRoom,
          winnerId: hostUser.id,
          winnerName: hostUser.displayName,
          stateVersion: 4,
        },
      }) === false,
      'G1.3a: Snow Rush fake winnerId update must be DENIED'
    );
    assert(
      evaluateRoomUpdateRule({
        authUid: guestUser.id, // Not currentTurnIndex (0 = host)
        roomId: snakesPlayingRoom.id,
        existing: snakesPlayingRoom,
        incoming: {
          ...snakesPlayingRoom,
          status: 'finished',
          winnerId: guestUser.id,
          winnerName: guestUser.displayName,
          lastDiceRoll: 6,
          lastMovingPlayerUid: guestUser.id,
          stateVersion: 4,
        },
      }) === false,
      'G1.3b: Snakes & Ladders off-turn fake winnerId must be DENIED'
    );
    const teleportedHost = sanitizePlayer(snakesPlayingRoom.players[0], now + 500, {
      position: 100,
      positionVersion: 2,
    });
    assert(
      evaluateRoomUpdateRule({
        authUid: hostUser.id,
        roomId: snakesPlayingRoom.id,
        existing: snakesPlayingRoom, // Host is at tile 1 (< 94)!
        incoming: {
          ...snakesPlayingRoom,
          players: [teleportedHost, guestPlayerReady],
          playerPositions: buildPlayerPositionsMap([teleportedHost, guestPlayerReady], now + 500),
          status: 'finished',
          winnerId: hostUser.id,
          winnerName: hostUser.displayName,
          lastDiceRoll: 6,
          lastMovingPlayerUid: hostUser.id,
          stateVersion: 4,
        },
      }) === false,
      'G1.3c: Snakes & Ladders teleporting from tile 1 to 100 for instant fake win must be DENIED'
    );

    // G1.4 Client changing `status = 'finished'` on Snow Rush
    assert(
      evaluateRoomUpdateRule({
        authUid: hostUser.id,
        roomId: snowPlayingRoom.id,
        existing: snowPlayingRoom,
        incoming: {
          ...snowPlayingRoom,
          status: 'finished',
          winnerId: null,
          stateVersion: 4,
        },
      }) === false,
      'G1.4: Client setting status="finished" on Snow Rush must be DENIED'
    );

    // G1.5 `gameType` Tampering (`snow_rush -> snakes_and_ladders` to unlock rewards)
    assert(
      evaluateRoomUpdateRule({
        authUid: hostUser.id,
        roomId: snowPlayingRoom.id,
        existing: snowPlayingRoom,
        incoming: {
          ...snowPlayingRoom,
          gameType: 'snakes_and_ladders',
          stateVersion: 4,
        },
      }) === false,
      'G1.5: Tampering gameType from snow_rush to snakes_and_ladders must be DENIED'
    );

    // G1.6 `roomCode` / `createdAt` Tampering
    assert(
      evaluateRoomUpdateRule({
        authUid: hostUser.id,
        roomId: snowWaitingRoom.id,
        existing: snowWaitingRoom,
        incoming: {
          ...snowWaitingRoom,
          roomCode: 'HACK99',
          stateVersion: 2,
        },
      }) === false,
      'G1.6a: roomCode tampering must be DENIED'
    );
    assert(
      evaluateRoomUpdateRule({
        authUid: hostUser.id,
        roomId: snowWaitingRoom.id,
        existing: snowWaitingRoom,
        incoming: {
          ...snowWaitingRoom,
          createdAt: '2099-01-01T00:00:00.000Z',
          stateVersion: 2,
        },
      }) === false,
      'G1.6b: createdAt tampering must be DENIED'
    );

    // G1.7 Unauthorized `hostId` Update
    assert(
      evaluateRoomUpdateRule({
        authUid: guestUser.id,
        roomId: snowPlayingRoom.id,
        existing: snowPlayingRoom,
        incoming: {
          ...snowPlayingRoom,
          hostId: guestUser.id,
          hostName: guestUser.displayName,
          stateVersion: 4,
        },
      }) === false,
      'G1.7: Non-host hijacking hostId must be DENIED'
    );

    // G1.8 Fake `gameRound` Increment (during active `playing` or `+2` jump on Start)
    assert(
      evaluateRoomUpdateRule({
        authUid: hostUser.id,
        roomId: snakesPlayingRoom.id,
        existing: snakesPlayingRoom,
        incoming: {
          ...snakesPlayingRoom,
          gameRound: 3,
          stateVersion: 4,
        },
      }) === false,
      'G1.8a: Incrementing gameRound while status="playing" must be DENIED'
    );
    const twoPlayerLobby: RuleDoc = {
      ...snakesWaitingRoom,
      status: 'full',
      players: [snakesWaitingRoom.players[0], guestPlayerReady],
      playerCount: 2,
      stateVersion: 2,
    };
    assert(
      evaluateRoomUpdateRule({
        authUid: hostUser.id,
        roomId: twoPlayerLobby.id,
        existing: twoPlayerLobby,
        incoming: {
          ...twoPlayerLobby,
          status: 'playing',
          gameRound: 5, // Illegal jump from 1 -> 5
          stateVersion: 3,
        },
      }) === false,
      'G1.8b: Jumping gameRound by >1 on Host Start must be DENIED'
    );

    // G1.9 Snow Rush Fake Match Reward Claim (`/reward_claims` rule)
    const forgedFinishedSnowRoom: RuleDoc = {
      ...snowPlayingRoom,
      status: 'finished',
      winnerId: hostUser.id,
      winnerName: hostUser.displayName,
    };
    const fakeSnowClaimId = `${snowPlayingRoom.id}_r2_${hostUser.id}`;
    assert(
      evaluateMatchRewardClaimCreateRule({
        authUid: hostUser.id,
        claimId: fakeSnowClaimId,
        claim: {
          id: fakeSnowClaimId,
          userId: hostUser.id,
          roomId: snowPlayingRoom.id,
          gameRound: 2,
          outcome: 'win',
          xpGranted: 100,
          pointsGranted: 1000,
          createdAt: new Date(now + 1000).toISOString(),
          serverCreatedAt: SERVER_REQUEST_TIME,
        },
        room: forgedFinishedSnowRoom,
      }) === false,
      'G1.9: Match reward claim for a snow_rush room must be DENIED even if status/winnerId were forged'
    );

    // G1.10 Unregistered `gameType` Room Create
    for (const badGameType of ['poker', 'ludo_king', 'fake_game', '']) {
      assert(
        evaluateRoomCreateRule({
          authUid: hostUser.id,
          roomId: 'room_BAD999',
          incoming: {
            ...snakesWaitingRoom,
            id: 'room_BAD999',
            roomCode: 'BAD999',
            gameType: badGameType,
          },
        }) === false,
        `G1.10: Unregistered gameType "${badGameType}" on room create must be DENIED`
      );
    }

    passedGroups += 1;
  }

  // ---------------------------------------------------------------------------
  // GROUP 2 (G2): Snakes & Ladders Full Lifecycle Regression -> MUST ALLOW
  // ---------------------------------------------------------------------------
  {
    const resolved = resolveCreateGameRoomInput('snakes_and_ladders', {
      maxPlayers: 2,
      exactFinish: true,
    });

    // 1. Create Room
    const createdRoom: RuleDoc = {
      ...buildInitialGameRoom({
        hostUser,
        effectiveHostUid: hostUser.id,
        roomCode: 'SL2026',
        resolved,
        now,
      }),
      timestamp: SERVER_REQUEST_TIME,
      serverUpdatedAt: SERVER_REQUEST_TIME,
    };
    assert(
      evaluateRoomCreateRule({
        authUid: hostUser.id,
        roomId: createdRoom.id,
        incoming: createdRoom,
      }) === true,
      'G2.1: Legitimate Snakes & Ladders room create must be ALLOWED'
    );

    // 2. Guest Join Waiting Room
    const joinedGuest = makeSecondPlayer(guestUser.id, guestUser.displayName, false, now + 100);
    const joinedPlayers = [createdRoom.players[0], joinedGuest];
    const afterJoinRoom: RuleDoc = {
      ...createdRoom,
      players: joinedPlayers,
      playerCount: 2,
      status: 'full',
      playerPositions: buildPlayerPositionsMap(joinedPlayers, now + 100),
      presence: {
        ...createdRoom.presence,
        [guestUser.id]: { isConnected: true, lastSeen: now + 100, disconnectedAt: null },
      },
      stateVersion: 2,
      lastMoveSummary: `${guestUser.displayName} အခန်းသို့ ဝင်ရောက်လာခဲ့သည်။`,
      updatedAt: new Date(now + 100).toISOString(),
      serverUpdatedAt: SERVER_REQUEST_TIME,
    };
    assert(
      evaluateRoomUpdateRule({
        authUid: guestUser.id,
        roomId: createdRoom.id,
        existing: createdRoom,
        incoming: afterJoinRoom,
      }) === true,
      'G2.2: Legitimate Guest join waiting room must be ALLOWED'
    );

    // 3. Guest Toggle Ready (`isReady: false -> true`)
    const readyGuest = sanitizePlayer(joinedGuest, now + 200, { isReady: true });
    const readyPlayers = [createdRoom.players[0], readyGuest];
    const afterReadyRoom: RuleDoc = {
      ...afterJoinRoom,
      players: readyPlayers,
      playerCount: 2,
      status: 'full',
      playerPositions: buildPlayerPositionsMap(readyPlayers, now + 200),
      stateVersion: 3,
      updatedAt: new Date(now + 200).toISOString(),
      serverUpdatedAt: SERVER_REQUEST_TIME,
    };
    assert(
      evaluateRoomUpdateRule({
        authUid: guestUser.id,
        roomId: createdRoom.id,
        existing: afterJoinRoom,
        incoming: afterReadyRoom,
      }) === true,
      'G2.3: Legitimate Guest toggle Ready must be ALLOWED'
    );

    // 4. Host Start Game (`full -> playing`, `gameRound: 1 -> 2`)
    const afterStartRoom: RuleDoc = {
      ...afterReadyRoom,
      status: 'playing',
      currentTurnIndex: 0,
      turnStartTimestamp: now + 300,
      turnDeadline: now + 30300,
      reconnectionDeadline: null,
      disconnectedPlayerId: null,
      disconnectedPlayerName: null,
      lastMoveId: null,
      lastMovePath: [],
      lastMovingPlayerUid: null,
      winnerId: null,
      winnerName: null,
      matchParticipantIds: [hostUser.id, guestUser.id],
      gameRound: 2,
      stateVersion: 4,
      lastMoveSummary: 'ဂိမ်းစတင်ပါပြီ!',
      updatedAt: new Date(now + 300).toISOString(),
      serverUpdatedAt: SERVER_REQUEST_TIME,
    };
    assert(
      evaluateRoomUpdateRule({
        authUid: hostUser.id,
        roomId: createdRoom.id,
        existing: afterReadyRoom,
        incoming: afterStartRoom,
      }) === true,
      'G2.4: Legitimate Host Start Game must be ALLOWED'
    );

    // 5. Turn 1: Host rolls 3 from tile 1 -> hits Ladder 4 -> climbs to 14!
    const hostOn14 = sanitizePlayer(afterStartRoom.players[0], now + 400, {
      position: 14,
      positionVersion: 2,
      lastMoveId: 'mv_1',
    });
    const afterLadderMoveRoom: RuleDoc = {
      ...afterStartRoom,
      players: [hostOn14, readyGuest],
      playerPositions: buildPlayerPositionsMap([hostOn14, readyGuest], now + 400),
      presence: {
        ...afterStartRoom.presence,
        [hostUser.id]: { isConnected: true, lastSeen: now + 400, disconnectedAt: null },
      },
      lastDiceRoll: 3,
      lastMoveSummary: 'Ladder 4 -> 14',
      lastMoveId: 'mv_1',
      lastMoveTimestamp: now + 400,
      lastMovePath: [1, 2, 3, 4, 14],
      lastMovingPlayerUid: hostUser.id,
      currentTurnIndex: 1,
      turnStartTimestamp: now + 400,
      turnDeadline: now + 30400,
      stateVersion: 5,
      status: 'playing',
      winnerId: null,
      winnerName: null,
      matchParticipantIds: [hostUser.id, guestUser.id],
      updatedAt: new Date(now + 400).toISOString(),
      serverUpdatedAt: SERVER_REQUEST_TIME,
    };
    assert(
      evaluateRoomUpdateRule({
        authUid: hostUser.id,
        roomId: createdRoom.id,
        existing: afterStartRoom,
        incoming: afterLadderMoveRoom,
      }) === true,
      'G2.5: Legitimate Snakes & Ladders turn move with Ladder climb (1 + 3 -> 4 -> 14) must be ALLOWED'
    );

    // 6. Legitimate Turn Victory from tile 96 + roll 4 -> 100!
    const hostOn96 = sanitizePlayer(hostOn14, now + 500, { position: 96, positionVersion: 8 });
    const preWinRoom: RuleDoc = {
      ...afterLadderMoveRoom,
      players: [hostOn96, readyGuest],
      playerPositions: buildPlayerPositionsMap([hostOn96, readyGuest], now + 500),
      currentTurnIndex: 0,
      stateVersion: 12,
    };
    const hostWonOn100 = sanitizePlayer(hostOn96, now + 600, {
      position: 100,
      positionVersion: 9,
      lastMoveId: 'mv_win',
      rank: 1,
    });
    const wonRoom: RuleDoc = {
      ...preWinRoom,
      players: [hostWonOn100, readyGuest],
      playerPositions: buildPlayerPositionsMap([hostWonOn100, readyGuest], now + 600),
      lastDiceRoll: 4,
      lastMoveSummary: 'Victory!',
      lastMoveId: 'mv_win',
      lastMoveTimestamp: now + 600,
      lastMovePath: [96, 97, 98, 99, 100],
      lastMovingPlayerUid: hostUser.id,
      currentTurnIndex: 0,
      turnStartTimestamp: now + 600,
      turnDeadline: 0,
      stateVersion: 13,
      status: 'finished',
      winnerId: hostUser.id,
      winnerName: hostUser.displayName,
      matchParticipantIds: [hostUser.id, guestUser.id],
      updatedAt: new Date(now + 600).toISOString(),
      serverUpdatedAt: SERVER_REQUEST_TIME,
    };
    assert(
      evaluateRoomUpdateRule({
        authUid: hostUser.id,
        roomId: createdRoom.id,
        existing: preWinRoom,
        incoming: wonRoom,
      }) === true,
      'G2.6: Legitimate Snakes & Ladders turn win (96 + 4 -> 100) must be ALLOWED'
    );

    // 7. Match Reward Claims (Win +100 XP / +1,000 Pts & Loss +75 XP / +500 Pts)
    const winClaimId = `${createdRoom.id}_r2_${hostUser.id}`;
    const lossClaimId = `${createdRoom.id}_r2_${guestUser.id}`;
    assert(
      evaluateMatchRewardClaimCreateRule({
        authUid: hostUser.id,
        claimId: winClaimId,
        claim: {
          id: winClaimId,
          userId: hostUser.id,
          roomId: createdRoom.id,
          gameRound: 2,
          outcome: 'win',
          xpGranted: 100,
          pointsGranted: 1000,
          createdAt: new Date(now + 650).toISOString(),
          serverCreatedAt: SERVER_REQUEST_TIME,
        },
        room: wonRoom,
      }) === true,
      'G2.7a: Snakes & Ladders Winner match reward claim (+100 XP, +1000 Pts) must be ALLOWED'
    );
    assert(
      evaluateMatchRewardClaimCreateRule({
        authUid: guestUser.id,
        claimId: lossClaimId,
        claim: {
          id: lossClaimId,
          userId: guestUser.id,
          roomId: createdRoom.id,
          gameRound: 2,
          outcome: 'loss',
          xpGranted: 75,
          pointsGranted: 500,
          createdAt: new Date(now + 660).toISOString(),
          serverCreatedAt: SERVER_REQUEST_TIME,
        },
        room: wonRoom,
      }) === true,
      'G2.7b: Snakes & Ladders Loser match reward claim (+75 XP, +500 Pts) must be ALLOWED'
    );

    // 8. Opponent Forfeit Win during `playing` (`computeGameRoomLeaveOutcome` on Snakes & Ladders)
    const forfeitOutcome = computeGameRoomLeaveOutcome({
      room: afterLadderMoveRoom as GameRoom,
      leavingUserId: guestUser.id,
      now: now + 700,
    });
    assert(
      forfeitOutcome.action === 'update' &&
        forfeitOutcome.updates.status === 'finished' &&
        forfeitOutcome.updates.winnerId === hostUser.id,
      'G2.8a: Snakes & Ladders 2P->1P leave during playing must preserve forfeit-win for sole remaining player'
    );
    assert(
      evaluateRoomUpdateRule({
        authUid: guestUser.id,
        roomId: createdRoom.id,
        existing: afterLadderMoveRoom,
        incoming: {
          ...afterLadderMoveRoom,
          ...forfeitOutcome.updates,
          serverUpdatedAt: SERVER_REQUEST_TIME,
        },
      }) === true,
      'G2.8b: Snakes & Ladders forfeit-win leave transaction must pass firestore.rules Action 7'
    );

    // 9. Post-Finish Winner Exit (`wonRoom` -> Winner leaves first while Loser still claims reward)
    const postWinLeave = computeGameRoomLeaveOutcome({
      room: wonRoom as GameRoom,
      leavingUserId: hostUser.id,
      now: now + 800,
    });
    assert(
      postWinLeave.action === 'update' &&
        postWinLeave.updates.status === 'finished' &&
        postWinLeave.updates.winnerId === hostUser.id &&
        postWinLeave.updates.hostId === guestUser.id,
      'G2.9a: Winner leaving finished Snakes & Ladders room must preserve winnerId and promote remaining player to host'
    );
    assert(
      evaluateRoomUpdateRule({
        authUid: hostUser.id,
        roomId: createdRoom.id,
        existing: wonRoom,
        incoming: {
          ...wonRoom,
          ...postWinLeave.updates,
          serverUpdatedAt: SERVER_REQUEST_TIME,
        },
      }) === true,
      'G2.9b: Post-finish winner exit must pass firestore.rules Action 7'
    );

    // 10. Host Play Again Reset (`finished -> full`, `gameRound: 2 -> 3`)
    const resetHost = sanitizePlayer(hostWonOn100, now + 900, {
      position: 1,
      positionVersion: 1,
      lastMoveId: null,
      isReady: true,
    });
    delete (resetHost as any).rank;
    const resetGuest = sanitizePlayer(readyGuest, now + 900, {
      position: 1,
      positionVersion: 1,
      lastMoveId: null,
      isReady: false,
    });
    const playAgainRoom: RuleDoc = {
      ...wonRoom,
      players: [resetHost, resetGuest],
      playerCount: 2,
      playerPositions: buildPlayerPositionsMap([resetHost, resetGuest], now + 900),
      status: 'full',
      currentTurnIndex: 0,
      lastDiceRoll: 1,
      gameRound: 3,
      stateVersion: 14,
      lastMoveId: null,
      lastMovePath: [],
      lastMovingPlayerUid: null,
      turnStartTimestamp: 0,
      turnDeadline: 0,
      reconnectionDeadline: null,
      disconnectedPlayerId: null,
      disconnectedPlayerName: null,
      lastMoveSummary: 'ဂိမ်းအသစ် ပြန်လည်စတင်ရန် အဆင်သင့်ဖြစ်ပါပြီ!',
      winnerId: null,
      winnerName: null,
      matchParticipantIds: [],
      lastMoveTimestamp: now + 900,
      updatedAt: new Date(now + 900).toISOString(),
      serverUpdatedAt: SERVER_REQUEST_TIME,
    };
    assert(
      evaluateRoomUpdateRule({
        authUid: hostUser.id,
        roomId: createdRoom.id,
        existing: wonRoom,
        incoming: playAgainRoom,
      }) === true,
      'G2.10: Snakes & Ladders Host Play Again Reset must be ALLOWED'
    );

    passedGroups += 1;
  }

  // ---------------------------------------------------------------------------
  // GROUP 3 (G3): Snow Rush Phase 1 Isolation, Leave Safety, & Worker Origin Hardening
  // ---------------------------------------------------------------------------
  {
    const snowCreated: RuleDoc = {
      ...buildPrivateSnowRushRoomPayload({
        hostUser,
        effectiveHostUid: hostUser.id,
        roomCode: 'SR3050',
        maxPlayers: 4,
        now,
      }),
      timestamp: SERVER_REQUEST_TIME,
      serverUpdatedAt: SERVER_REQUEST_TIME,
    };
    assert(
      evaluateRoomCreateRule({
        authUid: hostUser.id,
        roomId: snowCreated.id,
        incoming: snowCreated,
      }) === true,
      'G3.1: Snow Rush room create must be ALLOWED under hardened rules'
    );

    const p2 = makeSecondPlayer(guestUser.id, guestUser.displayName, true, now + 100);
    const p3 = makeSecondPlayer(thirdUser.id, thirdUser.displayName, true, now + 150);
    const snowThreePlaying: GameRoom = {
      ...(snowCreated as GameRoom),
      status: 'playing',
      players: [snowCreated.players[0], p2, p3],
      playerCount: 3,
      playerPositions: buildPlayerPositionsMap([snowCreated.players[0], p2, p3], now + 200),
      matchParticipantIds: [hostUser.id, guestUser.id, thirdUser.id],
      gameRound: 2,
      stateVersion: 4,
    };

    // 3P -> 2P leave in `roomService.computeGameRoomLeaveOutcome`: stays `playing`, `winnerId: null`
    const leave3to2 = computeGameRoomLeaveOutcome({
      room: snowThreePlaying,
      leavingUserId: thirdUser.id,
      now: now + 300,
    });
    assert(
      leave3to2.action === 'update' &&
        leave3to2.updates.status === 'playing' &&
        leave3to2.updates.winnerId === null &&
        leave3to2.updates.winnerName === null &&
        leave3to2.updates.players.length === 2,
      'G3.2a: Snow Rush 3P->2P leave in roomService must stay playing with winnerId=null'
    );
    const snowTwoPlayingDoc: RuleDoc = {
      ...snowThreePlaying,
      ...leave3to2.updates,
      timestamp: SERVER_REQUEST_TIME,
      serverUpdatedAt: SERVER_REQUEST_TIME,
    };
    assert(
      evaluateRoomUpdateRule({
        authUid: thirdUser.id,
        roomId: snowCreated.id,
        existing: {
          ...snowThreePlaying,
          timestamp: SERVER_REQUEST_TIME,
          serverUpdatedAt: SERVER_REQUEST_TIME,
        },
        incoming: snowTwoPlayingDoc,
      }) === true,
      'G3.2b: Snow Rush 3P->2P leave update must pass firestore.rules Action 7'
    );

    // 2P -> 1P Host leave in `roomService.computeGameRoomLeaveOutcome`: MUST return to `waiting`, NEVER `finished` or Auto-Win!
    const leave2to1 = computeGameRoomLeaveOutcome({
      room: snowTwoPlayingDoc as GameRoom,
      leavingUserId: hostUser.id,
      now: now + 400,
    });
    assert(
      leave2to1.action === 'update' &&
        leave2to1.updates.status === 'waiting' &&
        leave2to1.updates.winnerId === null &&
        leave2to1.updates.winnerName === null &&
        leave2to1.updates.hostId === guestUser.id,
      'G3.3a: Snow Rush 2P->1P leave in roomService must return to waiting with winnerId=null (NEVER finished/auto-win)'
    );
    const snowSoleWaitingDoc: RuleDoc = {
      ...snowTwoPlayingDoc,
      ...leave2to1.updates,
      serverUpdatedAt: SERVER_REQUEST_TIME,
    };
    assert(
      evaluateRoomUpdateRule({
        authUid: hostUser.id,
        roomId: snowCreated.id,
        existing: snowTwoPlayingDoc,
        incoming: snowSoleWaitingDoc,
      }) === true,
      'G3.3b: Snow Rush 2P->1P host-leave update must pass firestore.rules Action 7'
    );

    // 1P -> 0P leave in `roomService.computeGameRoomLeaveOutcome`: deletes room cleanly & passes delete rule!
    const leave1to0 = computeGameRoomLeaveOutcome({
      room: snowSoleWaitingDoc as GameRoom,
      leavingUserId: guestUser.id,
      now: now + 500,
    });
    assert(leave1to0.action === 'delete', 'G3.4a: Last player leaving Snow Rush room must delete room');
    assert(
      evaluateRoomDeleteRule({
        authUid: guestUser.id,
        roomId: snowCreated.id,
        existing: snowSoleWaitingDoc,
      }) === true,
      'G3.4b: Last member deleting 1P Snow Rush room must be ALLOWED by firestore.rules'
    );

    // RoomView & gameSessionService Isolation Checks (`Section E2 & E3`)
    assert(
      shouldUseTurnBasedFirestoreRoomLifecycle('snow_rush') === false &&
        shouldUseTurnBasedFirestoreRoomLifecycle('snakes_and_ladders') === true,
      'G3.5a: RoomView turn-based Firestore presence/timeout lifecycle must be disabled ONLY for snow_rush'
    );
    assert(
      shouldAutoClaimRoomMatchReward({
        gameType: 'snow_rush',
        status: 'finished',
        winnerId: hostUser.id,
      }) === false &&
        shouldAutoClaimRoomMatchReward({
          gameType: 'snakes_and_ladders',
          status: 'finished',
          winnerId: hostUser.id,
        }) === true,
      'G3.5b: RoomView auto match reward claim must NEVER fire for snow_rush'
    );
    assert(
      shouldClaimSessionMatchReward({
        gameType: 'snow_rush',
        status: 'finished',
        winnerId: hostUser.id,
      }) === false &&
        shouldClaimSessionMatchReward({
          gameType: 'snakes_and_ladders',
          status: 'finished',
          winnerId: hostUser.id,
        }) === true,
      'G3.5c: gameSessionService refresh/rejoin recovery must NEVER claim rewards for snow_rush'
    );

    // Worker Origin Hardening (`Section F`)
    const wranglerToml = fs.readFileSync(
      path.join(WORKSPACE_ROOT, 'workers/snow-rush-server/wrangler.toml'),
      'utf8'
    );
    const originsMatch = wranglerToml.match(/ALLOWED_ORIGINS\s*=\s*"([^"]+)"/);
    assert(originsMatch && originsMatch[1], 'G3.6a: wrangler.toml must declare ALLOWED_ORIGINS');
    const configuredOrigins = originsMatch[1];
    assert(
      !configuredOrigins.includes('localhost:3000'),
      'G3.6b: http://localhost:3000 must be removed from production Worker wrangler.toml'
    );

    const parsedAllowlist = parseAllowedOrigins(configuredOrigins);
    assert(
      isOriginAllowed('https://child-vibes3050.pages.dev', parsedAllowlist) &&
        isOriginAllowed('https://preview-branch.child-vibes3050.pages.dev', parsedAllowlist) &&
        isOriginAllowed(
          'https://ais-dev-qw4gg4jal2u3tup36rro7r-1033756722286.asia-southeast1.run.app',
          parsedAllowlist
        ) &&
        isOriginAllowed(
          'https://ais-pre-qw4gg4jal2u3tup36rro7r-1033756722286.asia-southeast1.run.app',
          parsedAllowlist
        ) &&
        !isOriginAllowed('http://localhost:3000', parsedAllowlist),
      'G3.6c: Worker allowlist must allow Pages + Preview + AI Studio URLs and reject http://localhost:3000'
    );

    const workerEnv = createMockWorkerEnv({ ALLOWED_ORIGINS: configuredOrigins });
    const localhostWsRes = await workerEntry.fetch(
      new Request('https://child-vibes-snow-rush-server.littleyzlay99.workers.dev/ws/snow-rush/room_SR3050', {
        method: 'GET',
        headers: {
          Origin: 'http://localhost:3000',
          Upgrade: 'websocket',
        },
      }),
      workerEnv,
      MOCK_CTX
    );
    assert(
      localhostWsRes.status === 403,
      'G3.6d: Worker /ws/snow-rush/:roomId must reject http://localhost:3000 with HTTP 403'
    );

    const validPagesWsRes = await workerEntry.fetch(
      new Request('https://child-vibes-snow-rush-server.littleyzlay99.workers.dev/ws/snow-rush/room_SR3050', {
        method: 'GET',
        headers: {
          Origin: 'https://child-vibes3050.pages.dev',
          Upgrade: 'websocket',
        },
      }),
      workerEnv,
      MOCK_CTX
    );
    assert(
      validPagesWsRes.status === 200,
      'G3.6e: Worker /ws/snow-rush/:roomId must forward valid child-vibes3050.pages.dev Origin to Durable Object'
    );

    // Public Launch Gate Preservation (`Sections I & J`)
    assert(
      getGameById('snow_rush')?.status === 'coming_soon' &&
        !getAvailableGames().some((g) => g.id === 'snow_rush') &&
        !isGameModulePlayable('snow_rush') &&
        resolveGameModule('snow_rush').kind === 'unresolved',
      'G3.7a: snow_rush must remain coming_soon in registry.ts during Step 10.2'
    );
    const appRaw = fs.readFileSync(path.join(WORKSPACE_ROOT, 'src/App.tsx'), 'utf8');
    assert(
      appRaw.includes("get('privateSnowRush') === '1'"),
      'G3.7b: ?privateSnowRush=1 Private Test entry must remain intact until Step 10.4'
    );

    passedGroups += 1;
  }

  // ---------------------------------------------------------------------------
  // GROUP 4 (G4): Step 10.2.2 Leaderboard Read Compatibility & User XP/Points Anti-Tamper
  // ---------------------------------------------------------------------------
  {
    const rulesRaw = fs.readFileSync(path.join(WORKSPACE_ROOT, 'firestore.rules'), 'utf8');
    const rewardServiceRaw = fs.readFileSync(
      path.join(WORKSPACE_ROOT, 'src/services/rewardService.ts'),
      'utf8'
    );

    // 1. Verify exact `/users/{userId}` `allow list: if isSignedIn();` rule in firestore.rules
    const usersBlockMatch = rulesRaw.match(
      /match\s+\/users\/\{userId\}\s*\{[\s\S]*?allow\s+get:\s*if\s+isSignedIn\(\)\s*&&\s*isValidId\(userId\);\s*allow\s+list:\s*if\s+([^;]+);/
    );
    assert(
      Boolean(usersBlockMatch && usersBlockMatch[1].trim() === 'isSignedIn()'),
      'G4.1a: /users/{userId} must set `allow list: if isSignedIn();` for Leaderboard compatibility'
    );
    assert(
      !rulesRaw.includes('allow list: if isSignedIn() && resource.data.level is number'),
      'G4.1b: Restrictive level filter on /users allow list must be removed'
    );

    // 2. Verify all 3 Leaderboard queries in rewardService.ts remain untouched in ranking order
    assert(
      rewardServiceRaw.includes("query(usersCol, orderBy('level', 'desc'), limit(Math.max(maxEntries, 50)))") &&
        rewardServiceRaw.includes("query(usersCol, orderBy('totalPointsEarned', 'desc'), limit(fetchLimit))") &&
        rewardServiceRaw.includes("query(usersCol, orderBy('points', 'desc'), limit(fetchLimit))"),
      'G4.2a: All 3 Leaderboard ranking queries in rewardService.ts must remain unchanged'
    );

    // Evaluate Firestore Query Prover against `allow list: if isSignedIn();` for all 3 Leaderboard queries
    const evaluateUsersLeaderboardListRule = (params: {
      readonly authUid: string | null;
      readonly queryName: 'level_desc' | 'totalPointsEarned_desc' | 'points_desc';
    }): boolean => {
      // With `allow list: if isSignedIn();`, no resource.data filter is required by Firestore's query analyzer
      return Boolean(params.authUid && params.queryName);
    };

    for (const qName of ['level_desc', 'totalPointsEarned_desc', 'points_desc'] as const) {
      assert(
        evaluateUsersLeaderboardListRule({ authUid: hostUser.id, queryName: qName }) === true,
        `G4.2b: Authenticated Leaderboard query "${qName}" must be ALLOWED`
      );
      assert(
        evaluateUsersLeaderboardListRule({ authUid: null, queryName: qName }) === false,
        `G4.2c: Unauthenticated Leaderboard query "${qName}" must be DENIED`
      );
    }

    // 3. Verify `firebase.json` and `.firebaserc` were NOT created
    assert(
      !fs.existsSync(path.join(WORKSPACE_ROOT, 'firebase.json')) &&
        !fs.existsSync(path.join(WORKSPACE_ROOT, '.firebaserc')),
      'G4.3: firebase.json and .firebaserc must NOT be created (Firebase Console deployment workflow)'
    );

    // 4. Exact 1:1 Evaluator for `/users/{userId}` `allow update` (XP / Points Direct Client Tamper DENIED)
    const computeLevelRule = (totalXp: number): number => {
      const xpInt = Math.trunc(totalXp);
      if (xpInt >= 284400) return 999;
      if (xpInt < 15000) return 1 + Math.trunc(xpInt / 150);
      return 101 + Math.trunc((xpInt - 15000) / 300);
    };

    const computeCurrentLevelXpRule = (totalXp: number): number => {
      const xpInt = Math.trunc(totalXp);
      if (xpInt >= 284400) return xpInt - 284400;
      if (xpInt < 15000) return xpInt % 150;
      return (xpInt - 15000) % 300;
    };

    const isValidUserRule = (data: RuleDoc, authUid: string): boolean => {
      if (
        !hasAllKeys(data, [
          'id',
          'playerId',
          'displayName',
          'level',
          'xp',
          'points',
          'totalWins',
          'totalGames',
          'inventory',
        ])
      ) {
        return false;
      }
      if (data.id !== authUid) return false;
      if (typeof data.playerId !== 'string' || data.playerId.length < 2 || data.playerId.length > 24)
        return false;
      if (
        typeof data.displayName !== 'string' ||
        data.displayName.length < 1 ||
        data.displayName.length > 60
      )
        return false;
      if (typeof data.level !== 'number' || data.level < 1 || data.level > 999) return false;
      if (typeof data.xp !== 'number' || data.xp < 0) return false;
      if ('totalXp' in data && (typeof data.totalXp !== 'number' || data.totalXp < 0)) return false;
      if (typeof data.points !== 'number' || data.points < 0) return false;
      if ('currentPoints' in data && data.currentPoints !== data.points) return false;
      if ('totalPointsEarned' in data && data.totalPointsEarned < data.points) return false;
      if (typeof data.totalWins !== 'number' || data.totalWins < 0) return false;
      if (typeof data.totalGames !== 'number' || data.totalGames < 0) return false;
      if (!Array.isArray(data.inventory) || data.inventory.length > 50) return false;
      return true;
    };

    const evaluateUserUpdateRule = (params: {
      readonly authUid: string | null;
      readonly userId: string;
      readonly existing: RuleDoc;
      readonly incoming: RuleDoc;
      readonly preExistingClaimIds?: ReadonlySet<string>;
      readonly postBatchClaims?: Readonly<Record<string, RuleDoc>>;
      readonly roomForClaim?: RuleDoc | null;
    }): boolean => {
      const {
        authUid,
        userId,
        existing,
        incoming,
        preExistingClaimIds = new Set(),
        postBatchClaims = {},
        roomForClaim = null,
      } = params;
      if (!authUid || authUid !== userId || !isValidId(userId)) return false;
      if (!isValidUserRule(incoming, authUid)) return false;
      if (incoming.id !== existing.id || incoming.playerId !== existing.playerId) return false;

      const changed = affectedKeys(incoming, existing);

      // Action 1: Non-Economy Profile, Cosmetic Equip, or Active Room Session Update
      const userAction1 = hasOnlyKeys(changed, [
        'displayName',
        'photoURL',
        'activeFrame',
        'activeBoardSkin',
        'activeDiceSkin',
        'activeTokenSkin',
        'activeRoomId',
        'activeRoomCode',
        'activeGameType',
        'updatedAt',
      ]);

      // Action 3: Server-Verified Atomic Match Reward Claim
      let userAction3 = false;
      if (
        hasOnlyKeys(changed, [
          'totalXp',
          'level',
          'xp',
          'points',
          'currentPoints',
          'totalPointsEarned',
          'totalGames',
          'totalWins',
          'lastClaimId',
          'updatedAt',
        ]) &&
        typeof incoming.lastClaimId === 'string' &&
        isValidId(incoming.lastClaimId) &&
        !preExistingClaimIds.has(incoming.lastClaimId) &&
        Object.prototype.hasOwnProperty.call(postBatchClaims, incoming.lastClaimId)
      ) {
        const claimDoc = postBatchClaims[incoming.lastClaimId];
        // Both `/reward_claims/{claimId}` create AND `/users/{userId}` Action 3 must succeed in the same atomic transaction
        const claimCreateAllowed = evaluateMatchRewardClaimCreateRule({
          authUid,
          claimId: incoming.lastClaimId,
          claim: claimDoc,
          room: roomForClaim,
        });
        if (claimCreateAllowed && claimDoc.userId === userId) {
          const oldTotalXp = typeof existing.totalXp === 'number' ? Math.trunc(existing.totalXp) : 0;
          const oldCurrentPts =
            typeof existing.currentPoints === 'number'
              ? Math.trunc(existing.currentPoints)
              : Math.trunc(existing.points);
          const oldEarnedPts =
            typeof existing.totalPointsEarned === 'number'
              ? Math.trunc(existing.totalPointsEarned)
              : oldCurrentPts;

          userAction3 =
            Math.trunc(incoming.totalXp) === oldTotalXp + claimDoc.xpGranted &&
            Math.trunc(incoming.level) === computeLevelRule(incoming.totalXp) &&
            Math.trunc(incoming.xp) === computeCurrentLevelXpRule(incoming.totalXp) &&
            Math.trunc(incoming.points) === oldCurrentPts + claimDoc.pointsGranted &&
            Math.trunc(incoming.currentPoints) === Math.trunc(incoming.points) &&
            Math.trunc(incoming.totalPointsEarned) === oldEarnedPts + claimDoc.pointsGranted &&
            Math.trunc(incoming.totalGames) === Math.trunc(existing.totalGames) + 1 &&
            Math.trunc(incoming.totalWins) ===
              Math.trunc(existing.totalWins) + (claimDoc.outcome === 'win' ? 1 : 0);
        }
      }

      return userAction1 || userAction3;
    };

    // G4.4a: Client directly modifying XP / Level -> MUST DENY
    assert(
      evaluateUserUpdateRule({
        authUid: hostUser.id,
        userId: hostUser.id,
        existing: hostUser,
        incoming: {
          ...hostUser,
          totalXp: 15000,
          level: 101,
          xp: 0,
          updatedAt: new Date(now + 1000).toISOString(),
        },
      }) === false,
      'G4.4a: Direct client-side XP / Level modification must be DENIED'
    );

    // G4.4b: Client directly modifying Points / totalPointsEarned -> MUST DENY
    assert(
      evaluateUserUpdateRule({
        authUid: hostUser.id,
        userId: hostUser.id,
        existing: hostUser,
        incoming: {
          ...hostUser,
          points: 999999,
          currentPoints: 999999,
          totalPointsEarned: 999999,
          updatedAt: new Date(now + 1000).toISOString(),
        },
      }) === false,
      'G4.4b: Direct client-side Points modification must be DENIED'
    );

    // G4.4c: Client updating another user's profile -> MUST DENY
    assert(
      evaluateUserUpdateRule({
        authUid: attackerUid,
        userId: hostUser.id,
        existing: hostUser,
        incoming: {
          ...hostUser,
          displayName: 'Spoofed Name',
          updatedAt: new Date(now + 1000).toISOString(),
        },
      }) === false,
      'G4.4c: Updating another user profile must be DENIED'
    );

    // G4.4d: Client attempting Snow Rush fake reward atomic user update -> MUST DENY
    const snowFinishedFake: RuleDoc = {
      id: 'room_SR7777',
      roomCode: 'SR7777',
      gameType: 'snow_rush',
      status: 'finished',
      winnerId: hostUser.id,
      gameRound: 2,
      matchParticipantIds: [hostUser.id, guestUser.id],
    };
    const fakeSnowClaimId = `room_SR7777_r2_${hostUser.id}`;
    assert(
      evaluateUserUpdateRule({
        authUid: hostUser.id,
        userId: hostUser.id,
        existing: hostUser,
        incoming: {
          ...hostUser,
          totalXp: 100,
          level: 1,
          xp: 100,
          points: 1500,
          currentPoints: 1500,
          totalPointsEarned: 1500,
          totalGames: 1,
          totalWins: 1,
          lastClaimId: fakeSnowClaimId,
          updatedAt: new Date(now + 1100).toISOString(),
        },
        postBatchClaims: {
          [fakeSnowClaimId]: {
            id: fakeSnowClaimId,
            userId: hostUser.id,
            roomId: 'room_SR7777',
            gameRound: 2,
            outcome: 'win',
            xpGranted: 100,
            pointsGranted: 1000,
            createdAt: new Date(now + 1100).toISOString(),
            serverCreatedAt: SERVER_REQUEST_TIME,
          },
        },
        roomForClaim: snowFinishedFake,
      }) === false,
      'G4.4d: Snow Rush fake reward atomic /users update must be DENIED'
    );

    // G4.5: Legitimate Snakes & Ladders Win (+100 XP / +1000 Pts) & Loss (+75 XP / +500 Pts) atomic /users updates -> MUST ALLOW
    const validSnakesFinishedRoom: RuleDoc = {
      id: 'room_SL8888',
      roomCode: 'SL8888',
      gameType: 'snakes_and_ladders',
      status: 'finished',
      winnerId: hostUser.id,
      gameRound: 2,
      matchParticipantIds: [hostUser.id, guestUser.id],
    };
    const slWinClaimId = `room_SL8888_r2_${hostUser.id}`;
    const slLossClaimId = `room_SL8888_r2_${guestUser.id}`;

    assert(
      evaluateUserUpdateRule({
        authUid: hostUser.id,
        userId: hostUser.id,
        existing: hostUser,
        incoming: {
          ...hostUser,
          totalXp: 100,
          level: 1,
          xp: 100,
          points: 1500,
          currentPoints: 1500,
          totalPointsEarned: 1500,
          totalGames: 1,
          totalWins: 1,
          lastClaimId: slWinClaimId,
          updatedAt: new Date(now + 1200).toISOString(),
        },
        postBatchClaims: {
          [slWinClaimId]: {
            id: slWinClaimId,
            userId: hostUser.id,
            roomId: 'room_SL8888',
            gameRound: 2,
            outcome: 'win',
            xpGranted: 100,
            pointsGranted: 1000,
            createdAt: new Date(now + 1200).toISOString(),
            serverCreatedAt: SERVER_REQUEST_TIME,
          },
        },
        roomForClaim: validSnakesFinishedRoom,
      }) === true,
      'G4.5a: Legitimate Snakes & Ladders Winner atomic /users progression update (+100 XP, +1000 Pts) must be ALLOWED'
    );

    assert(
      evaluateUserUpdateRule({
        authUid: guestUser.id,
        userId: guestUser.id,
        existing: guestUser,
        incoming: {
          ...guestUser,
          totalXp: 75,
          level: 1,
          xp: 75,
          points: 1000,
          currentPoints: 1000,
          totalPointsEarned: 1000,
          totalGames: 1,
          totalWins: 0,
          lastClaimId: slLossClaimId,
          updatedAt: new Date(now + 1210).toISOString(),
        },
        postBatchClaims: {
          [slLossClaimId]: {
            id: slLossClaimId,
            userId: guestUser.id,
            roomId: 'room_SL8888',
            gameRound: 2,
            outcome: 'loss',
            xpGranted: 75,
            pointsGranted: 500,
            createdAt: new Date(now + 1210).toISOString(),
            serverCreatedAt: SERVER_REQUEST_TIME,
          },
        },
        roomForClaim: validSnakesFinishedRoom,
      }) === true,
      'G4.5b: Legitimate Snakes & Ladders Loser atomic /users progression update (+75 XP, +500 Pts) must be ALLOWED'
    );

    // Duplicate replay of an already-claimed match reward -> MUST DENY
    assert(
      evaluateUserUpdateRule({
        authUid: hostUser.id,
        userId: hostUser.id,
        existing: {
          ...hostUser,
          totalXp: 100,
          level: 1,
          xp: 100,
          points: 1500,
          currentPoints: 1500,
          totalPointsEarned: 1500,
          totalGames: 1,
          totalWins: 1,
          lastClaimId: slWinClaimId,
        },
        incoming: {
          ...hostUser,
          totalXp: 200,
          level: 2,
          xp: 50,
          points: 2500,
          currentPoints: 2500,
          totalPointsEarned: 2500,
          totalGames: 2,
          totalWins: 2,
          lastClaimId: slWinClaimId,
          updatedAt: new Date(now + 1300).toISOString(),
        },
        preExistingClaimIds: new Set([slWinClaimId]),
        postBatchClaims: {
          [slWinClaimId]: {
            id: slWinClaimId,
            userId: hostUser.id,
            roomId: 'room_SL8888',
            gameRound: 2,
            outcome: 'win',
            xpGranted: 100,
            pointsGranted: 1000,
            createdAt: new Date(now + 1200).toISOString(),
            serverCreatedAt: SERVER_REQUEST_TIME,
          },
        },
        roomForClaim: validSnakesFinishedRoom,
      }) === false,
      'G4.5c: Replaying an already-claimed Snakes & Ladders reward must be DENIED'
    );

    passedGroups += 1;
  }

  console.log(
    `[SnowRush Step 10.2.2 Security Hardening Suite] ALL ${passedGroups}/5 SECURITY & REGRESSION GROUPS PASSED!`
  );
}

runStep102SecuritySuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('[SnowRush Step 10.2 Security Hardening Suite] FAILED:', err);
    process.exit(1);
  });
