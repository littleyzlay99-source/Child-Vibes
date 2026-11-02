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
  buildInitialGameRoom,
  computeGameRoomLeaveOutcome,
  computeLobbyStatus,
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
    console.log('PASS [10/10] Firestore Security Rules allow create 1:1 compliance (Snow Rush + Snakes & Ladders + Negative Security)');
  }

  console.log(`\nStep 10.5 Public Activation Code-Level Verification: ${passed}/10 test groups PASSED.`);
}

runStep105PublicActivationTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Step 10.5 Public Activation test failed:', err);
    process.exit(1);
  });
