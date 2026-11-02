/**
 * Step 10.5 — Snow Rush: Avalanche Escape Public Lobby Activation Test Suite
 * Phase 1: Public Casual Gameplay Without XP / Points Rewards
 *
 * Run with:
 *   npx tsx src/games/snow-rush/__tests__/snowRushStep105PublicActivation.test.ts
 *
 * NOTE: These are deterministic Code-Level Verification Tests (registry, shared roomService,
 * moduleResolver, UI markup, route protection, reward locks, and Snakes & Ladders regression).
 * They are explicitly distinct from Real Live 2–4 Player Browser Multiplayer Tests on production.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  getAllGames,
  getAvailableGames,
  getGameById,
} from '../../registry';
import {
  isGameModulePlayable,
  resolveGameModule,
} from '../../moduleResolver';
import {
  snowRushModule,
  getSnowRushRuleSummary,
  SNOW_RUSH_INSTRUCTIONS_MM,
} from '../SnowRushModule';
import { COURSE_LENGTH_M } from '../constants';
import {
  FIREBASE_DATABASE_ID,
  FIREBASE_PROJECT_ID,
  OperationType,
  auth,
  handleFirestoreError,
  redactFirestorePath,
  redactPiiFromMessage,
} from '../../../lib/firebase';
import {
  RoomJoinError,
  buildInitialGameRoom,
  classifyRoomOperationError,
  computeGameRoomLeaveOutcome,
  computeLobbyStatus,
  createGameRoom,
  resolveCreateGameRoomInput,
} from '../../../services/roomService';
import {
  buildCreateRoomOptionsForGame,
  getAllowedPlayerCountsForGame,
  resolveSelectableGameId,
} from '../../../components/Multiplayer/CreateRoomModal';
import {
  filterRoomsByGameType,
  normalizeRoomGameType,
} from '../../../components/Multiplayer/RoomsBrowseView';
import {
  shouldAutoClaimRoomMatchReward,
  shouldUseTurnBasedFirestoreRoomLifecycle,
} from '../../../components/Multiplayer/RoomView';
import { shouldClaimSessionMatchReward } from '../../../services/gameSessionService';
import { SharedRoomLobby } from '../../../components/Multiplayer/SharedRoomLobby';
import { SnowRushMultiplayerPodium } from '../components/SnowRushMultiplayerPodium';
import {
  buildMultiplayerSnapshot,
  createInitialMultiplayerRaceState,
  finalizeMultiplayerRace,
} from '../engine/multiplayerSimulation';
import type { GameRoom, UserProfile } from '../../../types';

const WORKSPACE_ROOT = process.cwd();

function makeHostProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'uid_host_105',
    playerId: 'CV105001',
    displayName: 'အောင်မြင့်',
    email: 'host105@example.com',
    photoURL: '',
    xp: 250,
    level: 3,
    points: 400,
    totalWins: 5,
    totalGames: 12,
    inventory: ['token_crown'],
    activeFrame: 'frame_default',
    activeBoardSkin: 'board_classic',
    activeDiceSkin: 'dice_classic',
    activeTokenSkin: 'token_crown',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function runStep105PublicActivationTests(): Promise<void> {
  let passed = 0;

  // ---------------------------------------------------------------------------
  // Test 1: Public Game Registry returns `snow_rush` as `available` with 1.50 KM & Phase 1 metadata
  // ---------------------------------------------------------------------------
  {
    const snowEntry = getGameById('snow_rush');
    assert.ok(snowEntry, 'snow_rush entry exists in Central Game Registry');
    assert.equal(snowEntry.id, 'snow_rush');
    assert.equal(snowEntry.status, 'available', 'snow_rush status MUST be available');
    assert.equal(snowEntry.sortOrder, 8, 'snow_rush sortOrder preserved as 8');
    assert.equal(snowEntry.category, 'racing', 'snow_rush category preserved as racing');
    assert.equal(snowEntry.minPlayers, 2, 'snow_rush minPlayers preserved as 2');
    assert.equal(snowEntry.maxPlayers, 4, 'snow_rush maxPlayers preserved as 4');
    assert.ok(
      snowEntry.title.includes('Snow Rush: Avalanche Escape'),
      'snow_rush title includes Snow Rush: Avalanche Escape'
    );
    assert.ok(
      snowEntry.description.includes('1.50 KM') &&
        snowEntry.description.includes('Real-time Multiplayer') &&
        snowEntry.description.includes('Phase 1') &&
        snowEntry.description.includes('XP / Points ဆုကြေး မပါဝင်သေးပါ') &&
        !snowEntry.description.includes('မကြာမီလာမည်'),
      'snow_rush description reflects 1.50 KM, Real-time Multiplayer, and Phase 1 no-rewards'
    );

    const availableIds = getAvailableGames().map((g) => g.id);
    assert.deepEqual(availableIds, ['snakes_and_ladders', 'snow_rush']);

    const comingSoonIds = getAllGames()
      .filter((g) => g.status === 'coming_soon')
      .map((g) => g.id);
    assert.ok(!comingSoonIds.includes('snow_rush'), 'snow_rush is no longer coming_soon');
    assert.equal(getAllGames().length, 8);

    passed += 1;
    console.log('PASS [1/9] Public Game Registry activates snow_rush (available, 1.50 KM, 2–4 players, Phase 1)');
  }

  // ---------------------------------------------------------------------------
  // Test 2: Public Create Room flow works for `snow_rush` via shared `roomService.ts`
  // ---------------------------------------------------------------------------
  {
    const snowEntry = getGameById('snow_rush')!;
    assert.equal(resolveSelectableGameId('snow_rush'), 'snow_rush');
    assert.deepEqual(getAllowedPlayerCountsForGame(snowEntry), [2, 3, 4]);

    const modalOptions = buildCreateRoomOptionsForGame('snow_rush', {
      maxPlayers: 4,
      exactFinish: true, // must be stripped/ignored for snow_rush
    });
    assert.deepEqual(modalOptions, { maxPlayers: 4 });

    for (const count of [2, 3, 4]) {
      const resolved = resolveCreateGameRoomInput('snow_rush', { maxPlayers: count });
      assert.equal(resolved.gameType, 'snow_rush');
      assert.equal(resolved.maxPlayers, count);
      assert.equal(resolved.exactFinish, false, 'snow_rush rooms always set exactFinish = false');

      const host = makeHostProfile();
      const initialRoom = buildInitialGameRoom({
        hostUser: host,
        effectiveHostUid: host.id,
        roomCode: `SR10${count}A`,
        resolved,
        now: 1760000000000,
      });

      assert.equal(initialRoom.id, `room_SR10${count}A`);
      assert.equal(initialRoom.gameType, 'snow_rush');
      assert.equal(initialRoom.status, 'waiting');
      assert.equal(initialRoom.maxPlayers, count);
      assert.equal(initialRoom.playerCount, 1);
      assert.equal(initialRoom.players.length, 1);
      assert.equal(initialRoom.players[0].uid, host.id);
      assert.equal(initialRoom.players[0].isReady, true);
      assert.equal(initialRoom.winnerId, null);
      assert.equal(initialRoom.exactFinish, false);
    }

    passed += 1;
    console.log('PASS [2/9] Public Create Room builds valid snow_rush rooms (2–4 players) via shared roomService.ts');
  }

  // ---------------------------------------------------------------------------
  // Test 3: Public Browse Rooms lists & filters `snow_rush` rooms cleanly alongside `snakes_and_ladders`
  // ---------------------------------------------------------------------------
  {
    const host = makeHostProfile();
    const snowRoom = buildInitialGameRoom({
      hostUser: host,
      effectiveHostUid: host.id,
      roomCode: 'SR8899',
      resolved: resolveCreateGameRoomInput('snow_rush', { maxPlayers: 4 }),
      now: 1760000001000,
    });
    const snakesRoom = buildInitialGameRoom({
      hostUser: host,
      effectiveHostUid: host.id,
      roomCode: 'SL2233',
      resolved: resolveCreateGameRoomInput('snakes_and_ladders', {
        maxPlayers: 4,
        exactFinish: true,
      }),
      now: 1760000002000,
    });

    assert.equal(normalizeRoomGameType(snowRoom.gameType), 'snow_rush');
    assert.equal(normalizeRoomGameType(snakesRoom.gameType), 'snakes_and_ladders');
    assert.equal(normalizeRoomGameType(undefined), 'snakes_and_ladders');

    const lobbyRooms: GameRoom[] = [snowRoom, snakesRoom];
    // Simulate RoomsBrowseView snapshot admission check (`getGameById(effectiveGameId)?.status === 'available'`)
    const admittedRooms = lobbyRooms.filter(
      (r) => getGameById(normalizeRoomGameType(r.gameType))?.status === 'available'
    );
    assert.equal(admittedRooms.length, 2, 'Both snow_rush and snakes_and_ladders rooms are admitted in Public Browse');

    assert.equal(filterRoomsByGameType(admittedRooms, 'all').length, 2);
    assert.deepEqual(
      filterRoomsByGameType(admittedRooms, 'snow_rush').map((r) => r.id),
      ['room_SR8899']
    );
    assert.deepEqual(
      filterRoomsByGameType(admittedRooms, 'snakes_and_ladders').map((r) => r.id),
      ['room_SL2233']
    );

    passed += 1;
    console.log('PASS [3/9] Public Browse Rooms lists & filters snow_rush and snakes_and_ladders rooms cleanly');
  }

  // ---------------------------------------------------------------------------
  // Test 4: Public Room Lifecycle — Join / Ready / Host Start / Leave for `snow_rush` (No auto-win / No finished write)
  // ---------------------------------------------------------------------------
  {
    assert.equal(computeLobbyStatus(1, 4), 'waiting');
    assert.equal(computeLobbyStatus(3, 4), 'waiting');
    assert.equal(computeLobbyStatus(4, 4), 'full');
    assert.equal(computeLobbyStatus(2, 2), 'full');

    const host = makeHostProfile({ id: 'uid_p1', displayName: 'ကစားသမား ၁' });
    const baseRoom = buildInitialGameRoom({
      hostUser: host,
      effectiveHostUid: host.id,
      roomCode: 'SR4P00',
      resolved: resolveCreateGameRoomInput('snow_rush', { maxPlayers: 4 }),
      now: 1760000010000,
    });

    const fourPlayers = [
      baseRoom.players[0],
      { ...baseRoom.players[0], uid: 'uid_p2', playerId: 'CV105002', displayName: 'ကစားသမား ၂', color: '#10B981' },
      { ...baseRoom.players[0], uid: 'uid_p3', playerId: 'CV105003', displayName: 'ကစားသမား ၃', color: '#3B82F6' },
      { ...baseRoom.players[0], uid: 'uid_p4', playerId: 'CV105004', displayName: 'ကစားသမား ၄', color: '#F59E0B' },
    ];

    // Active playing Snow Rush room: 4P -> 3P -> 2P -> 1P -> 0P (deleted)
    const playing4P: GameRoom = {
      ...baseRoom,
      status: 'playing',
      players: fourPlayers,
      playerCount: 4,
      matchParticipantIds: fourPlayers.map((p) => p.uid),
    };

    const leave4To3 = computeGameRoomLeaveOutcome({
      room: playing4P,
      leavingUserId: 'uid_p1', // Host leaves -> host transfers to uid_p2
      now: 1760000020000,
    });
    assert.equal(leave4To3.action, 'update');
    if (leave4To3.action === 'update') {
      assert.equal(leave4To3.updates.status, 'playing');
      assert.equal(leave4To3.updates.hostId, 'uid_p2');
      assert.equal(leave4To3.updates.winnerId, null);
      assert.equal(leave4To3.updates.playerCount, 3);
    }

    const playing2P: GameRoom = {
      ...playing4P,
      hostId: 'uid_p2',
      players: [fourPlayers[1], fourPlayers[2]],
      playerCount: 2,
      matchParticipantIds: ['uid_p2', 'uid_p3'],
    };

    // Critical Step 10.2 / 10.5 rule: 2P -> 1P in Snow Rush transitions back to 'waiting' with winnerId=null (NEVER status='finished' or forfeit win)
    const leave2To1 = computeGameRoomLeaveOutcome({
      room: playing2P,
      leavingUserId: 'uid_p3',
      now: 1760000030000,
    });
    assert.equal(leave2To1.action, 'update');
    if (leave2To1.action === 'update') {
      assert.equal(leave2To1.updates.status, 'waiting', 'Snow Rush 2P->1P leave resets status = waiting (never finished)');
      assert.notEqual(leave2To1.updates.status, 'finished', 'Snow Rush leave must NEVER set status = finished');
      assert.equal(leave2To1.updates.winnerId, null, 'Snow Rush 2P->1P leave must keep winnerId = null');
      assert.equal(leave2To1.updates.winnerName, null);
      assert.equal(leave2To1.updates.playerCount, 1);
    }

    // Last player leaving deletes the room cleanly
    const playing1P: GameRoom = {
      ...playing2P,
      players: [fourPlayers[1]],
      playerCount: 1,
    };
    const leave1To0 = computeGameRoomLeaveOutcome({
      room: playing1P,
      leavingUserId: 'uid_p2',
      now: 1760000040000,
    });
    assert.equal(leave1To0.action, 'delete', 'Last player leaving deletes Snow Rush room cleanly');

    passed += 1;
    console.log('PASS [4/9] Public Room Lifecycle (4P->3P->2P->1P->0P) preserves Firestore Security Rules invariants');
  }

  // ---------------------------------------------------------------------------
  // Test 5: `resolveGameModule('snow_rush')` & Public UI Polish (`SharedRoomLobby` + `SnowRushMultiplayerPodium`)
  // ---------------------------------------------------------------------------
  {
    const resolution = resolveGameModule('snow_rush');
    assert.equal(resolution.kind, 'resolved');
    if (resolution.kind === 'resolved') {
      assert.equal(resolution.module, snowRushModule);
      assert.equal(
        resolution.registryEntry.title,
        'နှင်းတောင်ဆင်းပြိုင်ပွဲ (Snow Rush: Avalanche Escape)'
      );
    }
    assert.equal(isGameModulePlayable('snow_rush'), true);

    const ruleSummary = getSnowRushRuleSummary({ exactFinish: false, maxPlayers: 4 });
    assert.ok(
      ruleSummary.includes('1.50 KM') &&
        ruleSummary.includes('Real-time Multiplayer') &&
        ruleSummary.includes('XP / Points ဆုကြေး မပါဝင်သေးပါ'),
      'getSnowRushRuleSummary includes 1.50 KM, Real-time Multiplayer, and Phase 1 no-reward notice'
    );
    assert.ok(
      SNOW_RUSH_INSTRUCTIONS_MM.includes('1.50 KM') &&
        SNOW_RUSH_INSTRUCTIONS_MM.includes('Real-time Multiplayer') &&
        SNOW_RUSH_INSTRUCTIONS_MM.includes('XP / Points ဆုကြေး မပါဝင်သေးပါ')
    );

    const host = makeHostProfile();
    const sampleRoom = buildInitialGameRoom({
      hostUser: host,
      effectiveHostUid: host.id,
      roomCode: 'SR5566',
      resolved: resolveCreateGameRoomInput('snow_rush', { maxPlayers: 4 }),
      now: 1760000050000,
    });

    const lobbyHtml = renderToStaticMarkup(
      React.createElement(SharedRoomLobby, {
        roomCode: sampleRoom.roomCode,
        roomStatus: 'waiting',
        gameTitle: getGameById('snow_rush')!.title,
        gameIcon: getGameById('snow_rush')!.icon,
        ruleSummary,
        instructionsText: SNOW_RUSH_INSTRUCTIONS_MM,
        hostId: sampleRoom.hostId,
        hostName: sampleRoom.hostName,
        currentUserId: host.id,
        players: sampleRoom.players,
        minPlayers: 2,
        maxPlayers: 4,
        isHost: true,
        canStartGame: false,
        copiedCode: false,
        copiedLink: false,
        onCopyCode: () => {},
        onCopyLink: () => {},
        onToggleReady: () => {},
        onStartGame: () => {},
        onLeaveRoom: () => {},
      })
    );

    assert.ok(lobbyHtml.includes('Snow Rush: Avalanche Escape'), 'Lobby shows Snow Rush: Avalanche Escape');
    assert.ok(lobbyHtml.includes('1.50 KM'), 'Lobby shows 1.50 KM');
    assert.ok(lobbyHtml.includes('Real-time Multiplayer'), 'Lobby shows Real-time Multiplayer');
    assert.ok(lobbyHtml.includes('XP / Points ဆုကြေး မပါဝင်သေးပါ'), 'Lobby shows Phase 1 no-reward notice');
    assert.ok(!lobbyHtml.includes('Private Test'), 'Lobby has zero Private Test text');
    assert.ok(!lobbyHtml.includes('Development'), 'Lobby has zero Development text');

    // Verify Podium renders public Phase 1 notice & 1.50 km finish
    let race = createInitialMultiplayerRaceState({
      players: [
        { uid: 'uid_a', displayName: 'အောင်အောင်', color: '#EF4444' },
        { uid: 'uid_b', displayName: 'ကျော်ကျော်', color: '#10B981' },
      ],
      trackSeed: 105001,
    });
    race.phase = 'racing';
    race.elapsedRaceMs = 68500;
    race.racers.uid_a.distanceM = COURSE_LENGTH_M;
    race.racers.uid_a.finishTimeMs = 68500;
    race.racers.uid_a.finishRank = 1;
    race.racers.uid_b.distanceM = 1420.5;
    race = finalizeMultiplayerRace(race, 'post_winner_timeout');
    const finalSnapshot = buildMultiplayerSnapshot(race);

    let exitClicked = 0;
    const podiumHtml = renderToStaticMarkup(
      React.createElement(SnowRushMultiplayerPodium, {
        finishState: finalSnapshot.finishState,
        snapshot: finalSnapshot,
        currentUserId: 'uid_a',
        connectionStatus: 'connected',
        rttMs: 42,
        isExiting: false,
        onExitRoom: () => {
          exitClicked += 1;
        },
      })
    );
    assert.equal(exitClicked, 0);
    assert.ok(podiumHtml.includes('Snow Rush: Avalanche Escape'));
    assert.ok(podiumHtml.includes('1.50 KM'));
    assert.ok(podiumHtml.includes('1.50 km'));
    assert.ok(podiumHtml.includes('No XP / Points Rewards in Phase 1'));
    assert.ok(!podiumHtml.includes('Private Test'));
    assert.ok(!podiumHtml.includes('Development'));
    assert.ok(!podiumHtml.includes('Display-Only Multiplayer'));

    passed += 1;
    console.log('PASS [5/9] resolveGameModule(snow_rush), SharedRoomLobby & Podium display clean Public Phase 1 UI');
  }

  // ---------------------------------------------------------------------------
  // Test 6: `?privateSnowRush=1` Private Test Route is disabled in `src/App.tsx`
  // ---------------------------------------------------------------------------
  {
    const appRaw = fs.readFileSync(path.join(WORKSPACE_ROOT, 'src/App.tsx'), 'utf8');
    assert.ok(
      !appRaw.includes('SnowRushPrivateTestView'),
      'src/App.tsx must not import or render SnowRushPrivateTestView'
    );
    assert.ok(
      !appRaw.includes('LazySnowRushPrivateTestView'),
      'src/App.tsx must not lazy-load SnowRushPrivateTestView'
    );
    assert.ok(
      !appRaw.includes('showPrivateSnowRush'),
      'src/App.tsx must not retain showPrivateSnowRush route branch'
    );
    assert.ok(
      !appRaw.includes('snowRushPrivateRoomService'),
      'src/App.tsx must not reference snowRushPrivateRoomService'
    );
    assert.ok(
      appRaw.includes("params.delete('privateSnowRush')"),
      'src/App.tsx strips any stale ?privateSnowRush=1 query param cleanly to MainApp'
    );

    passed += 1;
    console.log('PASS [6/9] ?privateSnowRush=1 Private Test Route is disabled in src/App.tsx');
  }

  // ---------------------------------------------------------------------------
  // Test 7: `?devSnowRush=1` Local Dev Preview remains strictly behind `import.meta.env.DEV`
  // ---------------------------------------------------------------------------
  {
    const appRaw = fs.readFileSync(path.join(WORKSPACE_ROOT, 'src/App.tsx'), 'utf8');
    const strippedComments = appRaw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    assert.ok(
      /if\s*\(\s*import\.meta\.env\.DEV\s*\)\s*\{\s*LazySnowRushDevPreview\s*=\s*React\.lazy\(\(\)\s*=>\s*import\(['"]\.\/games\/snow-rush\/SnowRushDevPreview['"]\)\);\s*\}/.test(
        strippedComments
      ),
      'LazySnowRushDevPreview must be gated behind if (import.meta.env.DEV)'
    );
    assert.ok(
      /if\s*\(\s*import\.meta\.env\.DEV\s*&&\s*typeof\s+window\s*!==\s*['"]undefined['"]\s*\)\s*\{[\s\S]*?get\(['"]devSnowRush['"]\)\s*===\s*['"]1['"]/.test(
        strippedComments
      ),
      'devSnowRush query check must be strictly inside if (import.meta.env.DEV)'
    );
    assert.ok(
      /if\s*\(\s*import\.meta\.env\.DEV\s*&&\s*showDevSnowRush\s*&&\s*LazySnowRushDevPreview\s*\)/.test(
        strippedComments
      ),
      'LazySnowRushDevPreview render branch must require import.meta.env.DEV'
    );

    passed += 1;
    console.log('PASS [7/9] ?devSnowRush=1 remains strictly guarded behind import.meta.env.DEV');
  }

  // ---------------------------------------------------------------------------
  // Test 8: Phase 1 Snow Rush Reward Lock & Public UI Cleanliness Scan
  // ---------------------------------------------------------------------------
  {
    // Runtime reward & turn-based lifecycle locks
    assert.equal(shouldUseTurnBasedFirestoreRoomLifecycle('snow_rush'), false);
    for (const status of ['waiting', 'full', 'playing', 'finished'] as const) {
      assert.equal(
        shouldAutoClaimRoomMatchReward({
          gameType: 'snow_rush',
          status,
          winnerId: 'uid_any',
        }),
        false,
        `RoomView must never auto-claim rewards for snow_rush (status=${status})`
      );
      assert.equal(
        shouldClaimSessionMatchReward({
          gameType: 'snow_rush',
          status,
          winnerId: 'uid_any',
        }),
        false,
        `gameSessionService must never claim rewards for snow_rush (status=${status})`
      );
    }

    // Static scan across public Snow Rush gameplay files: zero rewardService / Firestore room writes / private service imports
    const snowPublicFiles = [
      'src/games/snow-rush/SnowRushModule.ts',
      'src/games/snow-rush/SnowRushGame.tsx',
      'src/games/snow-rush/SnowRushMultiplayerView.tsx',
      'src/games/snow-rush/components/SnowRushMultiplayerPodium.tsx',
      'src/games/snow-rush/components/RaceProgressBar.tsx',
      'src/games/snow-rush/network/SnowRushSocketClient.ts',
    ];
    for (const relPath of snowPublicFiles) {
      const content = fs.readFileSync(path.join(WORKSPACE_ROOT, relPath), 'utf8');
      assert.ok(!content.includes('rewardService'), `${relPath} must not import rewardService`);
      assert.ok(!content.includes('claimMatchReward'), `${relPath} must not call claimMatchReward`);
      assert.ok(!content.includes('claimRoomMatchReward'), `${relPath} must not call claimRoomMatchReward`);
      assert.ok(!content.includes('snowRushPrivateRoomService'), `${relPath} must not import snowRushPrivateRoomService`);
      assert.ok(!content.includes('SnowRushPrivateTestView'), `${relPath} must not reference SnowRushPrivateTestView`);
    }

    // Public UI components scan: zero "Private Test" or "Development" strings in public UI
    const publicUiFiles = [
      'src/games/registry.ts',
      'src/components/Home/HomeView.tsx',
      'src/components/Games/GamesListView.tsx',
      'src/components/Multiplayer/CreateRoomModal.tsx',
      'src/components/Multiplayer/RoomsBrowseView.tsx',
      'src/components/Multiplayer/SharedRoomLobby.tsx',
      'src/components/Multiplayer/RoomView.tsx',
      'src/games/snow-rush/SnowRushModule.ts',
      'src/games/snow-rush/SnowRushGame.tsx',
      'src/games/snow-rush/SnowRushMultiplayerView.tsx',
      'src/games/snow-rush/components/SnowRushMultiplayerPodium.tsx',
    ];
    for (const relPath of publicUiFiles) {
      const raw = fs.readFileSync(path.join(WORKSPACE_ROOT, relPath), 'utf8');
      const stripped = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      assert.ok(!stripped.includes('Private Test'), `${relPath} must contain zero "Private Test" text`);
      assert.ok(!stripped.includes('Development'), `${relPath} must contain zero "Development" text`);
      assert.ok(!stripped.includes('snowRushPrivateRoomService'), `${relPath} must not import snowRushPrivateRoomService`);
    }

    passed += 1;
    console.log('PASS [8/9] Phase 1 Snow Rush Reward Lock & Public UI Cleanliness verified');
  }

  // ---------------------------------------------------------------------------
  // Test 9: Snakes & Ladders 100% Regression Check
  // ---------------------------------------------------------------------------
  {
    const snakesEntry = getGameById('snakes_and_ladders');
    assert.ok(snakesEntry);
    assert.equal(snakesEntry.status, 'available');
    assert.equal(snakesEntry.sortOrder, 1);
    assert.equal(isGameModulePlayable('snakes_and_ladders'), true);
    assert.equal(resolveGameModule('snakes_and_ladders').kind, 'resolved');

    assert.equal(shouldUseTurnBasedFirestoreRoomLifecycle('snakes_and_ladders'), true);
    assert.equal(
      shouldAutoClaimRoomMatchReward({
        gameType: 'snakes_and_ladders',
        status: 'finished',
        winnerId: 'uid_winner_snakes',
      }),
      true,
      'Snakes & Ladders finished room auto-claims XP / Points match rewards'
    );
    assert.equal(
      shouldClaimSessionMatchReward({
        gameType: 'snakes_and_ladders',
        status: 'finished',
        winnerId: 'uid_winner_snakes',
      }),
      true,
      'Snakes & Ladders session recovery claims unclaimed finished match rewards'
    );

    const host = makeHostProfile({ id: 'uid_sl_1', displayName: 'မောင်မောင်' });
    const snakesRoom = buildInitialGameRoom({
      hostUser: host,
      effectiveHostUid: host.id,
      roomCode: 'SL9900',
      resolved: resolveCreateGameRoomInput('snakes_and_ladders', {
        maxPlayers: 2,
        exactFinish: true,
      }),
      now: 1760000090000,
    });
    assert.equal(snakesRoom.exactFinish, true);

    const snakesPlaying2P: GameRoom = {
      ...snakesRoom,
      status: 'playing',
      players: [
        snakesRoom.players[0],
        {
          ...snakesRoom.players[0],
          uid: 'uid_sl_2',
          playerId: 'CV105099',
          displayName: 'စုစု',
          color: '#10B981',
        },
      ],
      playerCount: 2,
      matchParticipantIds: ['uid_sl_1', 'uid_sl_2'],
    };

    const snakesForfeit = computeGameRoomLeaveOutcome({
      room: snakesPlaying2P,
      leavingUserId: 'uid_sl_2',
      now: 1760000095000,
    });
    assert.equal(snakesForfeit.action, 'update');
    if (snakesForfeit.action === 'update') {
      assert.equal(snakesForfeit.updates.status, 'finished', 'Snakes & Ladders 2P->1P leave preserves forfeit win');
      assert.equal(snakesForfeit.updates.winnerId, 'uid_sl_1');
    }

    passed += 1;
    console.log('PASS [9/10] Snakes & Ladders gameplay, room lifecycle & XP/Points rewards 100% intact');
  }

  // ---------------------------------------------------------------------------
  // Test 10: Firestore Security Rules `allow create` 1:1 Payload Compliance
  //          (Snow Rush 2–4P + Oversized Profile Edge Cases + Snakes & Ladders + Negative Blocks)
  // ---------------------------------------------------------------------------
  {
    const SERVER_TIME = { __serverTimestamp: true } as const;
    const ALLOWED_PLAYER_KEYS = new Set([
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
    ]);
    const ALLOWED_ROOM_KEYS = new Set([
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
    ]);

    const evaluateFirestoreRoomAllowCreate = (
      roomId: string,
      authUid: string | null,
      data: Record<string, any>
    ): boolean => {
      if (!authUid) return false;
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(roomId)) return false;
      const requiredRoomKeys = [
        'id',
        'roomCode',
        'gameType',
        'hostId',
        'status',
        'maxPlayers',
        'players',
      ];
      if (!requiredRoomKeys.every((k) => k in data)) return false;
      if (!Object.keys(data).every((k) => ALLOWED_ROOM_KEYS.has(k))) return false;
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
      if (!Array.isArray(data.players) || data.players.length !== 1) return false;

      const p = data.players[0];
      if (!p || typeof p !== 'object') return false;
      if (!['uid', 'displayName', 'isReady', 'position'].every((k) => k in p)) return false;
      if (!Object.keys(p).every((k) => ALLOWED_PLAYER_KEYS.has(k))) return false;
      if (typeof p.uid !== 'string' || p.uid.length < 1 || p.uid.length > 128) return false;
      if ('playerId' in p && (typeof p.playerId !== 'string' || p.playerId.length > 32)) return false;
      if (typeof p.displayName !== 'string' || p.displayName.length < 1 || p.displayName.length > 60)
        return false;
      if ('photoURL' in p && (typeof p.photoURL !== 'string' || p.photoURL.length > 1000))
        return false;
      if (typeof p.isReady !== 'boolean') return false;
      if ('color' in p && (typeof p.color !== 'string' || p.color.length > 24)) return false;
      if (typeof p.position !== 'number' || p.position < 1 || p.position > 100) return false;
      if ('positionVersion' in p && (typeof p.positionVersion !== 'number' || p.positionVersion < 1))
        return false;
      if (
        'activeTokenSkin' in p &&
        (typeof p.activeTokenSkin !== 'string' || p.activeTokenSkin.length > 50)
      )
        return false;

      if ('playerCount' in data && data.playerCount !== 1) return false;
      if ('lastMoveSummary' in data && (typeof data.lastMoveSummary !== 'string' || data.lastMoveSummary.length > 500))
        return false;
      if ('winnerId' in data && data.winnerId !== null) return false;
      if ('winnerName' in data && data.winnerName !== null) return false;
      if (!('gameRound' in data) || data.gameRound !== 1) return false;
      if (!('stateVersion' in data) || data.stateVersion !== 1) return false;
      if ('timestamp' in data && data.timestamp !== SERVER_TIME) return false;
      if ('serverUpdatedAt' in data && data.serverUpdatedAt !== SERVER_TIME) return false;

      // Snow Rush Phase 1 Lock inside isValidGameRoom
      if (
        data.gameType === 'snow_rush' &&
        (!['waiting', 'full', 'playing'].includes(data.status) ||
          data.winnerId !== null ||
          data.winnerName !== null)
      ) {
        return false;
      }

      // allow create invariants
      return (
        data.id === roomId &&
        roomId === `room_${data.roomCode}` &&
        data.hostId === authUid &&
        data.status === 'waiting' &&
        p.uid === authUid &&
        p.position === 1
      );
    };

    // 10a. Snow Rush 2/3/4 player rooms with normal AND oversized Google/custom profile fields
    const edgeCaseHost = makeHostProfile({
      id: 'JerguuEmgjZJ6ZvamqsucN08vds1',
      playerId: 'SG-999999-EXTREMELY-LONG-PLAYER-ID-OVER-32-CHARS',
      displayName: 'အောင်မြင့်ထွန်း '.repeat(10), // > 60 chars before sanitization
      photoURL: 'data:image/png;base64,' + 'A'.repeat(2500), // > 1000 chars before sanitization
      activeTokenSkin: 'token_crown_' + 'x'.repeat(80), // > 50 chars before sanitization
    });

    for (const maxPlayers of [2, 3, 4]) {
      const resolvedSnow = resolveCreateGameRoomInput('snow_rush', { maxPlayers });
      const snowPayload = {
        ...buildInitialGameRoom({
          hostUser: edgeCaseHost,
          effectiveHostUid: edgeCaseHost.id,
          roomCode: `SR0${maxPlayers}OK`,
          resolved: resolvedSnow,
          now: 1760000100000,
        }),
        timestamp: SERVER_TIME,
        serverUpdatedAt: SERVER_TIME,
      };
      assert.equal(
        evaluateFirestoreRoomAllowCreate(`room_SR0${maxPlayers}OK`, edgeCaseHost.id, snowPayload),
        true,
        `Snow Rush maxPlayers=${maxPlayers} room create payload MUST pass firestore.rules allow create`
      );
    }

    // 10b. Snakes & Ladders 2/3/4 player rooms (exactFinish false & true)
    for (const exactFinish of [false, true]) {
      const resolvedSnakes = resolveCreateGameRoomInput('snakes_and_ladders', {
        maxPlayers: 4,
        exactFinish,
      });
      const snakesPayload = {
        ...buildInitialGameRoom({
          hostUser: edgeCaseHost,
          effectiveHostUid: edgeCaseHost.id,
          roomCode: exactFinish ? 'SL4EX1' : 'SL4EX0',
          resolved: resolvedSnakes,
          now: 1760000110000,
        }),
        timestamp: SERVER_TIME,
        serverUpdatedAt: SERVER_TIME,
      };
      assert.equal(
        evaluateFirestoreRoomAllowCreate(snakesPayload.id, edgeCaseHost.id, snakesPayload),
        true,
        `Snakes & Ladders exactFinish=${exactFinish} room create payload MUST pass firestore.rules allow create`
      );
    }

    // 10c. Security negative checks: forged status='finished', forged winnerId, mismatched hostId, unauthenticated
    const baseValidSnow = {
      ...buildInitialGameRoom({
        hostUser: makeHostProfile(),
        effectiveHostUid: 'uid_host_105',
        roomCode: 'SRSEC1',
        resolved: resolveCreateGameRoomInput('snow_rush', { maxPlayers: 4 }),
        now: 1760000120000,
      }),
      timestamp: SERVER_TIME,
      serverUpdatedAt: SERVER_TIME,
    };
    assert.equal(
      evaluateFirestoreRoomAllowCreate('room_SRSEC1', null, baseValidSnow),
      false,
      'Unauthenticated room create MUST be rejected'
    );
    assert.equal(
      evaluateFirestoreRoomAllowCreate('room_SRSEC1', 'uid_impersonator', baseValidSnow),
      false,
      'Impersonated hostId != request.auth.uid MUST be rejected'
    );
    assert.equal(
      evaluateFirestoreRoomAllowCreate('room_SRSEC1', 'uid_host_105', {
        ...baseValidSnow,
        status: 'finished',
      }),
      false,
      'Snow Rush room create with status=finished MUST be rejected'
    );
    assert.equal(
      evaluateFirestoreRoomAllowCreate('room_SRSEC1', 'uid_host_105', {
        ...baseValidSnow,
        winnerId: 'uid_host_105',
      }),
      false,
      'Snow Rush room create with non-null winnerId MUST be rejected'
    );

    passed += 1;
    console.log('PASS [10/13] Firestore Security Rules allow create 1:1 compliance (Snow Rush + Snakes & Ladders + Negative Security)');
  }

  // ---------------------------------------------------------------------------
  // Test 11: Step 10.5.2 — Firebase Project ID, Named Firestore DB & Pre-Write Auth Check
  // ---------------------------------------------------------------------------
  {
    assert.equal(
      FIREBASE_PROJECT_ID,
      'gen-lang-client-0335200904',
      'Firebase Project ID must match gen-lang-client-0335200904'
    );
    assert.equal(
      FIREBASE_DATABASE_ID,
      'ai-studio-47dffdd9-9dac-40e5-b320-95d71826db89',
      'Named Firestore Database ID must match ai-studio-47dffdd9-9dac-40e5-b320-95d71826db89'
    );
    assert.equal(
      auth.currentUser,
      null,
      'In headless node environment without signed-in session, auth.currentUser is null'
    );

    let thrownAuthErr: unknown = null;
    try {
      await createGameRoom(makeHostProfile(), 'snow_rush', { maxPlayers: 4 });
    } catch (err) {
      thrownAuthErr = err;
    }
    assert.ok(thrownAuthErr instanceof RoomJoinError, 'Unauthenticated createGameRoom throws RoomJoinError');
    assert.equal(
      (thrownAuthErr as RoomJoinError).code,
      'AUTH_REQUIRED',
      'Missing auth.currentUser.uid must throw AUTH_REQUIRED before setDoc()'
    );

    passed += 1;
    console.log('PASS [11/13] Firebase Project ID, Named Firestore Database ID, and AUTH_REQUIRED pre-write guard verified');
  }

  // ---------------------------------------------------------------------------
  // Test 12: Step 10.5.2 — Distinct Firebase Error Classification & Strict Zero-PII Logging
  // ---------------------------------------------------------------------------
  {
    const SENSITIVE_EMAIL = 'littleyzlay99@gmail.com';
    const SENSITIVE_UID = 'JerguuEmgjZJ6ZvamqsucN08vds1';
    const SENSITIVE_JWT = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJKZXJndXVFbWdqWko2WnZhbXFzdWNOMDh2ZHMxIn0.signature_secret_12345';
    const SENSITIVE_BEARER = 'Bearer ya29.a0AfH6SMBxSecretAccessTokenValue987654321';

    const capturedConsoleErrors: string[] = [];
    const origConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      capturedConsoleErrors.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };

    try {
      // 12a. permission-denied -> PERMISSION_DENIED (exact Burmese message under investigation)
      const permErr = classifyRoomOperationError(
        {
          code: 'permission-denied',
          message: `FirebaseError: Missing or insufficient permissions for ${SENSITIVE_EMAIL} (${SENSITIVE_UID}) token=${SENSITIVE_JWT}`,
        },
        'rooms/room_SR1234',
        'create'
      );
      assert.equal(permErr.code, 'PERMISSION_DENIED');
      assert.equal(permErr.firebaseCode, 'permission-denied');
      assert.equal(
        permErr.message,
        'အခန်းဖန်တီးရန် ခွင့်ပြုချက် စစ်ဆေးရာတွင် အဆင်မပြေဖြစ်သွားပါသည်။ အကောင့်ပြန်စစ်ဆေးပြီး ထပ်မံကြိုးစားပေးပါ။'
      );

      // 12b. unauthenticated / expired token -> AUTH_REQUIRED
      const unauthErr = classifyRoomOperationError(
        { code: 'unauthenticated', message: `Unauthenticated request ${SENSITIVE_BEARER}` },
        'rooms/room_SR1234',
        'create'
      );
      assert.equal(unauthErr.code, 'AUTH_REQUIRED');
      assert.equal(unauthErr.firebaseCode, 'unauthenticated');

      const expiredTokenErr = classifyRoomOperationError(
        { code: 'auth/user-token-expired', message: 'User token expired' },
        'rooms/room_SR1234',
        'create'
      );
      assert.equal(expiredTokenErr.code, 'AUTH_REQUIRED');

      // 12c. failed-precondition -> FAILED_PRECONDITION
      const precondErr = classifyRoomOperationError(
        { code: 'failed-precondition', message: 'The query requires an index or precondition failed' },
        'rooms/room_SR1234',
        'create'
      );
      assert.equal(precondErr.code, 'FAILED_PRECONDITION');
      assert.equal(precondErr.firebaseCode, 'failed-precondition');

      // 12d. aborted -> TRANSACTION_CONFLICT
      const abortedErr = classifyRoomOperationError(
        { code: 'aborted', message: 'Transaction lock contention' },
        'rooms/room_SR1234',
        'join'
      );
      assert.equal(abortedErr.code, 'TRANSACTION_CONFLICT');

      // 12e. resource-exhausted -> QUOTA_EXCEEDED
      const quotaErr = classifyRoomOperationError(
        { code: 'resource-exhausted', message: 'Quota exceeded' },
        'rooms/room_SR1234',
        'create'
      );
      assert.equal(quotaErr.code, 'QUOTA_EXCEEDED');

      // 12f. invalid-argument -> INVALID_PAYLOAD
      const invalidArgErr = classifyRoomOperationError(
        { code: 'invalid-argument', message: 'Invalid field value' },
        'rooms/room_SR1234',
        'create'
      );
      assert.equal(invalidArgErr.code, 'INVALID_PAYLOAD');

      // 12g. unavailable -> NETWORK_ERROR
      const netErr = classifyRoomOperationError(
        { code: 'unavailable', message: 'Backend unavailable' },
        'rooms/room_SR1234',
        'create'
      );
      assert.equal(netErr.code, 'NETWORK_ERROR');

      // 12h. unexpected error -> UNKNOWN_ERROR
      const unknownErr = classifyRoomOperationError(
        { code: 'internal', message: `Internal error for ${SENSITIVE_EMAIL}` },
        'rooms/room_SR1234',
        'create'
      );
      assert.equal(unknownErr.code, 'UNKNOWN_ERROR');

      // 12i. handleFirestoreError must redact path + message and exclude email/userId/tokens
      let handledJson = '';
      try {
        handleFirestoreError(
          new Error(`Permission denied for ${SENSITIVE_EMAIL} ${SENSITIVE_JWT} ${SENSITIVE_BEARER}`),
          OperationType.WRITE,
          `users/${SENSITIVE_UID}`
        );
      } catch (e) {
        handledJson = (e as Error).message;
      }
      assert.ok(handledJson.length > 0, 'handleFirestoreError throws structured JSON diagnostic');
      const parsedDiag = JSON.parse(handledJson);
      assert.equal(parsedDiag.path, 'users/[redacted-user]', 'User UID path segment must be redacted');
      assert.ok(!('userId' in parsedDiag), 'FirestoreErrorInfo must not include userId');
      assert.ok(!('email' in parsedDiag), 'FirestoreErrorInfo must not include email');
      assert.ok(!('providerInfo' in parsedDiag), 'FirestoreErrorInfo must not include providerInfo');

      const allLoggedOutput = [...capturedConsoleErrors, handledJson].join('\n');
      assert.ok(!allLoggedOutput.includes(SENSITIVE_EMAIL), 'Logs MUST NOT contain email PII');
      assert.ok(!allLoggedOutput.includes(SENSITIVE_UID), 'Logs MUST NOT contain UID PII');
      assert.ok(!allLoggedOutput.includes(SENSITIVE_JWT), 'Logs MUST NOT contain JWT tokens');
      assert.ok(!allLoggedOutput.includes('ya29.a0AfH6SMBxSecretAccessTokenValue987654321'), 'Logs MUST NOT contain Bearer tokens');

      assert.equal(redactFirestorePath(`users/${SENSITIVE_UID}/claims/c1`), 'users/[redacted-user]/claims/c1');
      assert.ok(!redactPiiFromMessage(`email=${SENSITIVE_EMAIL} token=${SENSITIVE_JWT}`).includes(SENSITIVE_EMAIL));
    } finally {
      console.error = origConsoleError;
    }

    passed += 1;
    console.log('PASS [12/13] Distinct Firebase error classification & strict zero-PII redaction verified');
  }

  // ---------------------------------------------------------------------------
  // Test 13: Step 10.5.2 — Real ANTLR4 `/firestore.rules` CEL Evaluation & < 1,000 Expression Limit Proof
  // ---------------------------------------------------------------------------
  {
    const req = createRequire(path.join(WORKSPACE_ROOT, 'package.json'));
    const rulesParser = req(
      path.join(WORKSPACE_ROOT, 'node_modules/@firebase/eslint-plugin-security-rules/dist/parser.cjs')
    );
    const rulesSource = fs.readFileSync(path.join(WORKSPACE_ROOT, 'firestore.rules'), 'utf8');
    const parsedRules = rulesParser.parseForESLint(rulesSource);
    const tree = parsedRules.services.tree;

    // Extract service-level helper functions & match /rooms/{roomId} permissions from the ANTLR4 parse tree
    type FnDef = { params: string[]; lets: Array<{ name: string; expr: any }>; retExpr: any };
    const functions = new Map<string, FnDef>();
    const roomPerms = new Map<string, any>();

    const walkSetup = (node: any) => {
      if (!node) return;
      const ctor = node.constructor?.name ?? '';
      if (ctor === 'FunctionDeclarationContext') {
        let fnName = '';
        const params: string[] = [];
        const lets: Array<{ name: string; expr: any }> = [];
        let retExpr: any = null;
        for (const ch of node.children ?? []) {
          const cName = ch.constructor?.name ?? '';
          if (cName === 'LocalFunctionIdContext') fnName = ch.getText();
          if (cName === 'FunctionSignatureContext') {
            for (const sc of ch.children ?? []) {
              if (sc.constructor?.name === 'ParamListContext') {
                for (const pc of sc.children ?? []) {
                  if (pc.constructor?.name === 'LocalVariableIdContext') params.push(pc.getText());
                }
              }
            }
          }
          if (cName === 'FunctionBodyContext') {
            for (const bc of ch.children ?? []) {
              const bName = bc.constructor?.name ?? '';
              if (bName === 'BindingDeclarationContext') {
                let vName = '';
                let vExpr: any = null;
                for (const lc of bc.children ?? []) {
                  if (lc.constructor?.name === 'LocalVariableIdContext') vName = lc.getText();
                  if ((lc.constructor?.name ?? '').endsWith('ExpressionContext')) vExpr = lc;
                }
                lets.push({ name: vName, expr: vExpr });
              }
              if (bName === 'ReturnStatementContext') {
                for (const rc of bc.children ?? []) {
                  if ((rc.constructor?.name ?? '').endsWith('ExpressionContext')) retExpr = rc;
                }
              }
            }
          }
        }
        if (fnName && retExpr) functions.set(fnName, { params, lets, retExpr });
        return;
      }
      if (ctor === 'MatchRuleDeclarationContext' && node.getText().startsWith('match/rooms/{roomId}{')) {
        for (const ch of node.children ?? []) {
          if (ch.constructor?.name === 'MatchStatementContext') {
            for (const mc of ch.children ?? []) {
              if (mc.constructor?.name === 'PermissionDeclarationContext') {
                const ops: string[] = [];
                let bodyExpr: any = null;
                for (const pc of mc.children ?? []) {
                  if (pc.constructor?.name === 'OperationIdContext') {
                    ops.push(...pc.getText().split(',').map((s: string) => s.trim()).filter(Boolean));
                  }
                  if (pc.constructor?.name === 'PermissionBodyContext') {
                    for (const bc of pc.children ?? []) {
                      if ((bc.constructor?.name ?? '').endsWith('ExpressionContext')) bodyExpr = bc;
                    }
                  }
                }
                for (const op of ops) roomPerms.set(op, bodyExpr);
              }
            }
          }
        }
      }
      for (const ch of node.children ?? []) walkSetup(ch);
    };
    walkSetup(tree);

    // Enforce Firestore's hard limit of <= 10 let-bindings per function
    let maxLetsPerFunc = 0;
    for (const [fnName, def] of functions.entries()) {
      maxLetsPerFunc = Math.max(maxLetsPerFunc, def.lets.length);
      assert.ok(
        def.lets.length <= 10,
        `Function ${fnName} has ${def.lets.length} let bindings (Firestore hard max is 10)`
      );
    }

    const TIMESTAMP_TAG = { __celType: 'timestamp', ms: 1760000100000 };
    const celEq = (a: any, b: any): boolean => {
      if (a === b) return true;
      if (a == null || b == null) return a === b;
      if (typeof a !== typeof b) return false;
      if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => celEq(v, b[i]));
      }
      if (a.__celSet && b.__celSet) {
        return a.items.length === b.items.length && a.items.every((k: string) => b.items.includes(k));
      }
      if (typeof a === 'object' && typeof b === 'object') {
        if (a.__celType || b.__celType) return a.__celType === b.__celType && a.ms === b.ms;
        const ka = Object.keys(a);
        const kb = Object.keys(b);
        return ka.length === kb.length && ka.every((k) => k in b && celEq(a[k], b[k]));
      }
      return false;
    };

    const makeDiff = (incMap: Record<string, any>, extMap: Record<string, any>) => {
      const affected = new Set<string>();
      for (const k of new Set([...Object.keys(incMap), ...Object.keys(extMap)])) {
        if (!(k in incMap) || !(k in extMap) || !celEq(incMap[k], extMap[k])) {
          affected.add(k);
        }
      }
      return {
        __celDiff: true,
        affectedKeys: () => ({ __celSet: true, items: Array.from(affected) }),
      };
    };

    const evaluateRoomOp = (
      op: 'create' | 'update' | 'delete',
      ctx: {
        roomId: string;
        authUid: string | null;
        incData?: Record<string, any> | null;
        extData?: Record<string, any> | null;
      }
    ) => {
      let totalExpr = 0;
      let nonLitExpr = 0;

      const rootEnv: Record<string, any> = {
        roomId: ctx.roomId,
        database: 'ai-studio-47dffdd9-9dac-40e5-b320-95d71826db89',
        request: {
          auth: ctx.authUid ? { uid: ctx.authUid, token: { email_verified: true } } : null,
          resource: ctx.incData ? { data: ctx.incData } : null,
          time: TIMESTAMP_TAG,
        },
        resource: ctx.extData ? { data: ctx.extData } : null,
      };

      const evalExprList = (exprListNode: any, env: Record<string, any>): any[] => {
        if (!exprListNode) return [];
        const out: any[] = [];
        for (const ch of exprListNode.children ?? []) {
          if ((ch.constructor?.name ?? '').endsWith('ExpressionContext')) {
            out.push(evalNode(ch, env));
          }
        }
        return out;
      };

      const invokeCelMethod = (target: any, methodName: string, args: any[]): any => {
        if (methodName === 'size') {
          if (typeof target === 'string' || Array.isArray(target)) return target.length;
          if (target?.__celSet) return target.items.length;
          if (target && typeof target === 'object') return Object.keys(target).length;
          throw new Error('Invalid .size() target');
        }
        if (methodName === 'keys') return Object.keys(target);
        if (methodName === 'get') {
          const [k, defVal] = args;
          return target && Object.prototype.hasOwnProperty.call(target, k) ? target[k] : defVal;
        }
        if (methodName === 'diff') return makeDiff(target, args[0]);
        if (methodName === 'affectedKeys') return target.affectedKeys();
        if (methodName === 'hasAll') {
          const items: any[] = Array.isArray(target) ? target : target.items;
          return (args[0] as any[]).every((x) => items.includes(x));
        }
        if (methodName === 'hasOnly') {
          const items: any[] = Array.isArray(target) ? target : target.items;
          const allowed: any[] = args[0];
          return items.every((x) => allowed.includes(x));
        }
        if (methodName === 'hasAny') {
          const items: any[] = Array.isArray(target) ? target : target.items;
          const check: any[] = args[0];
          return items.some((x) => check.includes(x));
        }
        if (methodName === 'matches') {
          return new RegExp(`^(?:${args[0]})$`).test(String(target));
        }
        if (methodName === 'toMillis') {
          return Number(target.ms);
        }
        throw new Error(`Unsupported CEL method .${methodName}()`);
      };

      const evalNode = (node: any, env: Record<string, any>): any => {
        if (!node) return null;
        const ctor = node.constructor?.name ?? '';
        const kids = node.children ?? [];

        if (ctor === 'PrimaryExpressionContext' || ctor === 'IndexLookupContext') {
          return evalNode(kids[0], env);
        }
        if (ctor === 'ParenSimpleExpressionContext') {
          return evalNode(kids[1], env);
        }
        if (ctor === 'LiteralExpressionContext') {
          return evalNode(kids[0], env);
        }
        if (ctor === 'LiteralContext') {
          totalExpr += 1;
          const txt = node.getText();
          if (txt === 'true') return true;
          if (txt === 'false') return false;
          if (txt === 'null') return null;
          if ((txt.startsWith("'") && txt.endsWith("'")) || (txt.startsWith('"') && txt.endsWith('"'))) {
            return txt.slice(1, -1);
          }
          return Number(txt);
        }
        if (ctor === 'VariableSimpleExpressionContext') {
          totalExpr += 1;
          const ident = node.getText();
          if (Object.prototype.hasOwnProperty.call(env, ident)) return env[ident];
          throw new Error(`Unbound identifier ${ident}`);
        }
        if (ctor === 'ListSimpleExpressionContext') {
          totalExpr += 1;
          nonLitExpr += 1;
          const listChild = kids.find((k: any) => k.constructor?.name === 'ExpressionListContext');
          return evalExprList(listChild, env);
        }
        if (ctor === 'FunctionCallSimpleExpressionContext') {
          totalExpr += 1;
          nonLitExpr += 1;
          const fnName = kids[0].getText();
          const listChild = kids.find((k: any) => k.constructor?.name === 'ExpressionListContext');
          const args = evalExprList(listChild, env);
          if (fnName === 'int') return Math.trunc(Number(args[0]));
          if (fnName === 'string') return String(args[0]);
          const fnDef = functions.get(fnName);
          if (!fnDef) throw new Error(`Unknown rules function ${fnName}`);
          const fnEnv: Record<string, any> = { ...rootEnv };
          fnDef.params.forEach((pName, idx) => {
            fnEnv[pName] = args[idx];
          });
          for (const lb of fnDef.lets) {
            fnEnv[lb.name] = evalNode(lb.expr, fnEnv);
          }
          return evalNode(fnDef.retExpr, fnEnv);
        }
        if (ctor === 'MemberLookupSimpleExpressionContext') {
          totalExpr += 1;
          nonLitExpr += 1;
          const target = evalNode(kids[0], env);
          const prop = kids[2].getText();
          if (target == null || !Object.prototype.hasOwnProperty.call(target, prop)) {
            throw new Error(`Missing property ${prop}`);
          }
          return target[prop];
        }
        if (ctor === 'ListLookupSimpleExpressionContext') {
          totalExpr += 1;
          nonLitExpr += 1;
          const target = evalNode(kids[0], env);
          const idx = evalNode(kids[2], env);
          if (target == null || !(idx in target)) throw new Error(`Index ${idx} out of bounds`);
          return target[idx];
        }
        if (ctor === 'IdMemberFunctionCallSimpleExpressionContext') {
          // Variable lookup + method call
          totalExpr += 2;
          nonLitExpr += 1;
          const ident = kids[0].getText();
          if (!Object.prototype.hasOwnProperty.call(env, ident)) throw new Error(`Unbound identifier ${ident}`);
          const target = env[ident];
          const methodName = kids[2].getText();
          const listChild = kids.find((k: any) => k.constructor?.name === 'ExpressionListContext');
          const args = evalExprList(listChild, env);
          return invokeCelMethod(target, methodName, args);
        }
        if (ctor === 'MemberFunctionCallSimpleExpressionContext') {
          totalExpr += 1;
          nonLitExpr += 1;
          const target = evalNode(kids[0], env);
          const methodName = kids[2].getText();
          const listChild = kids.find((k: any) => k.constructor?.name === 'ExpressionListContext');
          const args = evalExprList(listChild, env);
          return invokeCelMethod(target, methodName, args);
        }
        if (ctor === 'NotExpressionContext' || ctor === 'UnaryExpressionContext') {
          totalExpr += 1;
          nonLitExpr += 1;
          const opTok = kids[0].getText();
          const inner = evalNode(kids[1], env);
          return opTok === '!' ? !inner : -inner;
        }
        if (ctor === 'TernaryExpressionContext') {
          totalExpr += 1;
          nonLitExpr += 1;
          const cond = evalNode(kids[0], env);
          return cond ? evalNode(kids[2], env) : evalNode(kids[4], env);
        }
        if (ctor === 'LogicalOrExpressionContext') {
          let acc = Boolean(evalNode(kids[0], env));
          for (let i = 2; i < kids.length; i += 2) {
            totalExpr += 1;
            nonLitExpr += 1;
            if (acc) return true;
            acc = Boolean(evalNode(kids[i], env));
          }
          return acc;
        }
        if (ctor === 'LogicalAndExpressionContext') {
          let acc = Boolean(evalNode(kids[0], env));
          for (let i = 2; i < kids.length; i += 2) {
            totalExpr += 1;
            nonLitExpr += 1;
            if (!acc) return false;
            acc = Boolean(evalNode(kids[i], env));
          }
          return acc;
        }
        if (ctor === 'EqualityExpressionContext') {
          totalExpr += 1;
          nonLitExpr += 1;
          const left = evalNode(kids[0], env);
          const opTok = kids[1].getText();
          const right = evalNode(kids[2], env);
          return opTok === '==' ? celEq(left, right) : !celEq(left, right);
        }
        if (ctor === 'ExprIsTypeIdExpressionContext') {
          totalExpr += 1;
          nonLitExpr += 1;
          const left = evalNode(kids[0], env);
          const typeName = kids[2].getText();
          if (typeName === 'string') return typeof left === 'string';
          if (typeName === 'number' || typeName === 'int' || typeName === 'float')
            return typeof left === 'number' && !Number.isNaN(left);
          if (typeName === 'bool') return typeof left === 'boolean';
          if (typeName === 'list') return Array.isArray(left);
          if (typeName === 'map')
            return left !== null && typeof left === 'object' && !Array.isArray(left) && !left.__celType && !left.__celSet;
          if (typeName === 'timestamp') return Boolean(left && left.__celType === 'timestamp');
          return false;
        }
        if (ctor === 'ExprInExpressionContext') {
          totalExpr += 1;
          nonLitExpr += 1;
          const left = evalNode(kids[0], env);
          const right = evalNode(kids[2], env);
          if (Array.isArray(right)) return right.some((item) => celEq(left, item));
          if (right && right.__celSet) return right.items.some((item: any) => celEq(left, item));
          if (right && typeof right === 'object') return Object.prototype.hasOwnProperty.call(right, String(left));
          return false;
        }
        if (ctor === 'RelationalExpressionContext') {
          totalExpr += 1;
          nonLitExpr += 1;
          const left = evalNode(kids[0], env);
          const opTok = kids[1].getText();
          const right = evalNode(kids[2], env);
          if (typeof left !== 'number' || typeof right !== 'number' || Number.isNaN(left) || Number.isNaN(right)) {
            throw new Error('CEL relational comparison requires numeric operands');
          }
          if (opTok === '<') return left < right;
          if (opTok === '<=') return left <= right;
          if (opTok === '>') return left > right;
          if (opTok === '>=') return left >= right;
        }
        if (ctor === 'AdditiveExpressionContext' || ctor === 'MultiplicativeExpressionContext') {
          let val = evalNode(kids[0], env);
          for (let i = 2; i < kids.length; i += 2) {
            totalExpr += 1;
            nonLitExpr += 1;
            const opTok = kids[i - 1].getText();
            const rhs = evalNode(kids[i], env);
            if (opTok === '+') val = val + rhs;
            else if (opTok === '-') val = val - rhs;
            else if (opTok === '*') val = val * rhs;
            else if (opTok === '/') val = Math.trunc(val / rhs);
            else if (opTok === '%') val = val % rhs;
          }
          return val;
        }
        if (kids.length === 1) return evalNode(kids[0], env);
        throw new Error(`Unhandled AST node ${ctor}`);
      };

      const expr = roomPerms.get(op);
      assert.ok(expr, `Permission ${op} must exist on /rooms/{roomId}`);
      try {
        const res = Boolean(evalNode(expr, rootEnv));
        return { res, totalExpr, nonLitExpr };
      } catch {
        return { res: false, totalExpr, nonLitExpr };
      }
    };

    const host = makeHostProfile({ id: 'uid_p1', displayName: 'အောင်အောင်' });

    // 13a. Snow Rush 2/3/4 Player Room Create — must evaluate true AND stay well under 1,000 expressions
    for (const maxPlayers of [2, 3, 4]) {
      const roomCode = `SR${maxPlayers}CEL`;
      const payload = {
        ...buildInitialGameRoom({
          hostUser: host,
          effectiveHostUid: host.id,
          roomCode,
          resolved: resolveCreateGameRoomInput('snow_rush', { maxPlayers }),
          now: 1760000100000,
        }),
        timestamp: TIMESTAMP_TAG,
        serverUpdatedAt: TIMESTAMP_TAG,
      };
      const evalRes = evaluateRoomOp('create', {
        roomId: `room_${roomCode}`,
        authUid: host.id,
        incData: payload,
      });
      assert.equal(evalRes.res, true, `Snow Rush ${maxPlayers}P create must pass real firestore.rules AST`);
      assert.ok(
        evalRes.nonLitExpr < 850 && evalRes.totalExpr < 1000,
        `Snow Rush ${maxPlayers}P create (${evalRes.nonLitExpr} ops / ${evalRes.totalExpr} AST tokens) MUST be < 1,000`
      );
    }

    // 13b. Snakes & Ladders 2/3/4 Player Room Create — must evaluate true AND stay well under 1,000 expressions
    for (const maxPlayers of [2, 3, 4]) {
      const roomCode = `SL${maxPlayers}CEL`;
      const payload = {
        ...buildInitialGameRoom({
          hostUser: host,
          effectiveHostUid: host.id,
          roomCode,
          resolved: resolveCreateGameRoomInput('snakes_and_ladders', { maxPlayers, exactFinish: true }),
          now: 1760000100000,
        }),
        timestamp: TIMESTAMP_TAG,
        serverUpdatedAt: TIMESTAMP_TAG,
      };
      const evalRes = evaluateRoomOp('create', {
        roomId: `room_${roomCode}`,
        authUid: host.id,
        incData: payload,
      });
      assert.equal(evalRes.res, true, `Snakes & Ladders ${maxPlayers}P create must pass real firestore.rules AST`);
      assert.ok(
        evalRes.nonLitExpr < 850 && evalRes.totalExpr < 1000,
        `Snakes & Ladders ${maxPlayers}P create (${evalRes.nonLitExpr} ops / ${evalRes.totalExpr} AST tokens) MUST be < 1,000`
      );
    }

    // 13c. Worst-case 4-Player Room Updates (Join, Ready, Host Start, Snakes Dice Roll, Host Leave, Play Again)
    const baseSnow4 = {
      ...buildInitialGameRoom({
        hostUser: host,
        effectiveHostUid: 'uid_p1',
        roomCode: 'SR4UPD',
        resolved: resolveCreateGameRoomInput('snow_rush', { maxPlayers: 4 }),
        now: 1760000100000,
      }),
      timestamp: TIMESTAMP_TAG,
      serverUpdatedAt: TIMESTAMP_TAG,
    };
    const mkPlayer = (uid: string, name: string, isReady = false, pos = 1, updatedAtMs = 1760000100000) => ({
      ...baseSnow4.players[0],
      uid,
      displayName: name,
      isReady,
      position: pos,
      updatedAtMs,
    });

    // Action 2: 4th player joins waiting 3P Snow Rush room -> full 4P
    const snow3Waiting = {
      ...baseSnow4,
      players: [mkPlayer('uid_p1', 'P1'), mkPlayer('uid_p2', 'P2', true), mkPlayer('uid_p3', 'P3', true)],
      playerCount: 3,
      stateVersion: 3,
    };
    const snow4Joined = {
      ...snow3Waiting,
      players: [...snow3Waiting.players, mkPlayer('uid_p4', 'P4', false)],
      playerCount: 4,
      status: 'full',
      stateVersion: 4,
      serverUpdatedAt: TIMESTAMP_TAG,
    };
    const join4Res = evaluateRoomOp('update', {
      roomId: 'room_SR4UPD',
      authUid: 'uid_p4',
      extData: snow3Waiting,
      incData: snow4Joined,
    });
    assert.equal(join4Res.res, true, '4th player joining Snow Rush must pass firestore.rules');
    assert.ok(join4Res.nonLitExpr < 850, `4P Join CEL ops (${join4Res.nonLitExpr}) MUST be < 850 (< 1,000 hard limit)`);

    // Action 3: 4th player toggles Ready
    const snow4AllReady = {
      ...snow4Joined,
      players: [
        snow4Joined.players[0],
        snow4Joined.players[1],
        snow4Joined.players[2],
        { ...snow4Joined.players[3], isReady: true, updatedAtMs: 1760000105000 },
      ],
      stateVersion: 5,
    };
    const ready4Res = evaluateRoomOp('update', {
      roomId: 'room_SR4UPD',
      authUid: 'uid_p4',
      extData: snow4Joined,
      incData: snow4AllReady,
    });
    assert.equal(ready4Res.res, true, '4th player toggling Ready must pass firestore.rules');
    assert.ok(ready4Res.nonLitExpr < 850, `4P Ready CEL ops (${ready4Res.nonLitExpr}) MUST be < 850 (< 1,000 hard limit)`);

    // Action 4: Host starts 4P Snow Rush (all 4 players mutated simultaneously)
    const snow4Started = {
      ...snow4AllReady,
      status: 'playing',
      players: snow4AllReady.players.map((p) => ({
        ...p,
        position: 1,
        positionVersion: 2,
        lastMoveId: null,
        updatedAtMs: 1760000110000,
      })),
      matchParticipantIds: ['uid_p1', 'uid_p2', 'uid_p3', 'uid_p4'],
      gameRound: 2,
      stateVersion: 6,
      turnStartTimestamp: 1760000110000,
      turnDeadline: 1760000140000,
    };
    const start4Res = evaluateRoomOp('update', {
      roomId: 'room_SR4UPD',
      authUid: 'uid_p1',
      extData: snow4AllReady,
      incData: snow4Started,
    });
    assert.equal(start4Res.res, true, 'Host starting 4P Snow Rush must pass firestore.rules');
    assert.ok(start4Res.nonLitExpr < 850, `4P Host Start CEL ops (${start4Res.nonLitExpr}) MUST be < 850 (< 1,000 hard limit)`);

    // Action 5: Snakes & Ladders 4P Active Turn Dice Roll
    const snakes4Playing = {
      ...snow4Started,
      id: 'room_SL4UPD',
      roomCode: 'SL4UPD',
      gameType: 'snakes_and_ladders',
      currentTurnIndex: 0,
    };
    const snakes4Moved = {
      ...snakes4Playing,
      players: [
        { ...snakes4Playing.players[0], position: 14, positionVersion: 3, lastMoveId: 'mv_1', updatedAtMs: 1760000115000 },
        snakes4Playing.players[1],
        snakes4Playing.players[2],
        snakes4Playing.players[3],
      ],
      lastDiceRoll: 3,
      lastMoveId: 'mv_1',
      lastMovingPlayerUid: 'uid_p1',
      currentTurnIndex: 1,
      stateVersion: 7,
    };
    const move4Res = evaluateRoomOp('update', {
      roomId: 'room_SL4UPD',
      authUid: 'uid_p1',
      extData: snakes4Playing,
      incData: snakes4Moved,
    });
    assert.equal(move4Res.res, true, '4P Snakes & Ladders turn move must pass firestore.rules');
    assert.ok(move4Res.nonLitExpr < 850, `4P Snakes Move CEL ops (${move4Res.nonLitExpr}) MUST be < 850 (< 1,000 hard limit)`);

    // Action 7: 4P -> 3P Host Leave in Snow Rush
    const leaveOutcome = computeGameRoomLeaveOutcome({
      room: snow4Started as unknown as GameRoom,
      leavingUserId: 'uid_p1',
      now: 1760000120000,
    });
    assert.equal(leaveOutcome.action, 'update');
    if (leaveOutcome.action === 'update') {
      const snow3AfterHostLeave = {
        ...snow4Started,
        ...leaveOutcome.updates,
        stateVersion: 7,
        serverUpdatedAt: TIMESTAMP_TAG,
      };
      const leave4Res = evaluateRoomOp('update', {
        roomId: 'room_SR4UPD',
        authUid: 'uid_p1',
        extData: snow4Started,
        incData: snow3AfterHostLeave,
      });
      assert.equal(leave4Res.res, true, '4P -> 3P Snow Rush Host Leave must pass firestore.rules');
      assert.ok(leave4Res.nonLitExpr < 850, `4P Host Leave CEL ops (${leave4Res.nonLitExpr}) MUST be < 850 (< 1,000 hard limit)`);
    }

    // Action 8: Snakes & Ladders 4P Play Again Reset
    const snakes4Finished = {
      ...snakes4Moved,
      status: 'finished',
      winnerId: 'uid_p1',
      winnerName: 'P1',
    };
    const snakes4PlayAgain = {
      ...snakes4Finished,
      status: 'full',
      winnerId: null,
      winnerName: null,
      players: snakes4Finished.players.map((p, idx) => ({
        ...p,
        isReady: idx === 0,
        position: 1,
        positionVersion: 4,
        lastMoveId: null,
        updatedAtMs: 1760000130000,
      })),
      gameRound: 3,
      stateVersion: 8,
    };
    const playAgain4Res = evaluateRoomOp('update', {
      roomId: 'room_SL4UPD',
      authUid: 'uid_p1',
      extData: snakes4Finished,
      incData: snakes4PlayAgain,
    });
    assert.equal(playAgain4Res.res, true, '4P Snakes & Ladders Play Again must pass firestore.rules');
    assert.ok(
      playAgain4Res.nonLitExpr < 850,
      `4P Play Again CEL ops (${playAgain4Res.nonLitExpr}) MUST be < 850 (< 1,000 hard limit)`
    );

    // 13d. Preserved Security Protections (Non-member Update/Delete, Fake Winner, Snow Rush finished)
    const nonMemberUpdate = evaluateRoomOp('update', {
      roomId: 'room_SR4UPD',
      authUid: 'uid_attacker',
      extData: snow4Started,
      incData: { ...snow4Started, stateVersion: 99 },
    });
    assert.equal(nonMemberUpdate.res, false, 'Non-member room update MUST remain blocked');

    const nonMemberDelete = evaluateRoomOp('delete', {
      roomId: 'room_SR4UPD',
      authUid: 'uid_attacker',
      extData: baseSnow4,
    });
    assert.equal(nonMemberDelete.res, false, 'Non-member room delete MUST remain blocked');

    const fakeWinnerMove = evaluateRoomOp('update', {
      roomId: 'room_SL4UPD',
      authUid: 'uid_p1',
      extData: snakes4Playing, // uid_p1 is at position 1 (< 94)
      incData: {
        ...snakes4Moved,
        players: [
          { ...snakes4Playing.players[0], position: 100, positionVersion: 3 },
          snakes4Playing.players[1],
          snakes4Playing.players[2],
          snakes4Playing.players[3],
        ],
        status: 'finished',
        winnerId: 'uid_p1',
        winnerName: 'P1',
      },
    });
    assert.equal(fakeWinnerMove.res, false, 'Fake Winner jump from pos 1 -> 100 MUST remain blocked');

    const snowRushFinishedAttempt = evaluateRoomOp('update', {
      roomId: 'room_SR4UPD',
      authUid: 'uid_p1',
      extData: snow4Started,
      incData: { ...snow4Started, status: 'finished', stateVersion: 7 },
    });
    assert.equal(snowRushFinishedAttempt.res, false, 'Snow Rush status=finished MUST remain blocked');

    passed += 1;
    const createSnow4Res = evaluateRoomOp('create', { roomId: 'room_SR4UPD', authUid: 'uid_p1', incData: baseSnow4 });
    console.log(
      `PASS [13/13] Real ANTLR4 firestore.rules CEL evaluation & <1,000 expression budget verified (Create=${createSnow4Res.nonLitExpr} ops/${createSnow4Res.totalExpr} tokens, 4P Join=${join4Res.nonLitExpr}/${join4Res.totalExpr}, 4P Ready=${ready4Res.nonLitExpr}/${ready4Res.totalExpr}, 4P Start=${start4Res.nonLitExpr}/${start4Res.totalExpr}, 4P Move=${move4Res.nonLitExpr}/${move4Res.totalExpr}, 4P PlayAgain=${playAgain4Res.nonLitExpr}/${playAgain4Res.totalExpr}, maxLets=${maxLetsPerFunc})`
    );
  }

  console.log(`\nStep 10.5 / 10.5.2 Public Activation & Permission Diagnosis Verification: ${passed}/13 test groups PASSED.`);
}

runStep105PublicActivationTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Step 10.5 Public Activation test failed:', err);
    process.exit(1);
  });
