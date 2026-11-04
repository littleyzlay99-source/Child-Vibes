import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  getRegisteredGameModuleIds,
  isGameModulePlayable,
  resolveGameModule,
} from '../../moduleResolver';
import { getAllGames, getAvailableGames, getGameById } from '../../registry';
import { snakesAndLaddersModule } from '../../snakes-and-ladders/SnakesAndLaddersModule';
import type { GameRoom, RoomPlayer } from '../../../types';
import type { GameModuleGameplayProps } from '../../types';
import { COURSE_CHECKPOINT_METERS, COURSE_LENGTH_KM_TEXT, COURSE_LENGTH_M } from '../constants';
import { RaceProgressBar } from '../components/RaceProgressBar';
import { SnowRushMultiplayerPodium } from '../components/SnowRushMultiplayerPodium';
import {
  SnowRushNetworkStatusBanner,
  resolveNetworkBannerDescriptor,
} from '../components/SnowRushNetworkStatusBanner';
import {
  buildMultiplayerSnapshot,
  createInitialMultiplayerRaceState,
  finalizeMultiplayerRace,
  startMultiplayerCountdown,
  stepMultiplayerSnowRushTick,
} from '../engine/multiplayerSimulation';
import {
  buildMultiplayerHudSnapshot,
  deriveRacerPaletteFromHex,
  formatMultiplayerFinishReasonMm,
  reconstructMultiplayerSceneData,
  translateMultiplayerEventsForClient,
} from '../multiplayerHud';
import {
  resolveSnowRushWorkerWsUrl,
  SNOW_RUSH_PROTOCOL_VERSION,
  SNOW_RUSH_WS_CLOSE_CODES,
} from '../network/protocol';
import { SnowRushSnapshotInterpolator } from '../network/snapshotInterpolation';
import {
  SnowRushSocketClient,
  type SnowRushConnectionStatus,
  type SnowRushSocketLike,
} from '../network/SnowRushSocketClient';
import { SnowRushOnlineInputController } from '../onlineInputController';
import {
  buildHudSnapshot,
  createInitialSnowRushState,
  startCountdownState,
  stepSnowRushSimulation,
} from '../simulation';
import {
  SnowRushMultiplayerView,
  evaluateMultiplayerRoomGuard,
} from '../SnowRushMultiplayerView';
import { SnowRushPrototypeView } from '../SnowRushGame';
import { snowRushModule } from '../SnowRushModule';

/**
 * Snow Rush: Avalanche Escape — Step 4.8 Automated Frontend Integration & Regression Suite
 *
 * Covers all 13 verification scenarios required by Step 4.8:
 * 1. Empty `VITE_SNOW_RUSH_WS_URL=""` safety (no WebSocket opened, Burmese unconfigured UI)
 * 2. Local Offline Preview (`?devSnowRush=1` simulation + Offline Demo Bots) intact
 * 3. `snow_rush` remains `coming_soon` & hidden from `getAvailableGames()` while registered in `REGISTERED_GAME_MODULES`
 * 4. `kart_racing`, `snakes_and_ladders`, and unknown game types behave identically with zero silent fallback
 * 5. Online Mode strictly excludes Offline Demo Bots (`showOfflineBots: false`, `bots: []`)
 * 6. Authoritative WebSocket snapshot maps 2–4 human racers, colors, items, projectiles, traps & shields
 * 7. `SnowRushSnapshotInterpolator` smooth 60 FPS lerp + `> 12m` Snow Tumble recovery snap
 * 8. `SnowRushOnlineInputController` + `SnowRushSocketClient` monotonic `seq`, anti-repeat item trigger, and disconnect gate
 * 9. Complete Burmese Network Status Banner & terminal auth/room reject non-looping behavior
 * 10. Authoritative `race_finished` Podium UI (Winner Name, Rank 1–4, Distance/Time, Burmese Finish Reason)
 * 11. Clean socket, ping timer, input flush timer, and reconnect timer disposal on disconnect/unmount
 * 12. Zero Firestore room writes, zero `claimMatchReward()`, and zero `resetRoomToPlayAgain()` in Snow Rush codebase
 * 13. Snakes & Ladders module regression check
 */

class MockWebSocket implements SnowRushSocketLike {
  public readyState = 0; // CONNECTING
  public onopen: ((ev: unknown) => void) | null = null;
  public onmessage: ((ev: { readonly data: unknown }) => void) | null = null;
  public onclose: ((ev: { readonly code: number; readonly reason: string }) => void) | null = null;
  public onerror: ((ev: unknown) => void) | null = null;
  public readonly sentFrames: string[] = [];
  public closedCount = 0;
  public lastCloseCode: number | undefined;
  public lastCloseReason: string | undefined;

  public constructor(public readonly url: string) {}

  public send(data: string): void {
    this.sentFrames.push(data);
  }

  public close(code?: number, reason?: string): void {
    this.closedCount += 1;
    this.lastCloseCode = code;
    this.lastCloseReason = reason;
    this.readyState = 3; // CLOSED
  }

  public triggerOpen(): void {
    this.readyState = 1; // OPEN
    this.onopen?.({});
  }

  public triggerServerJson(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  public triggerServerClose(code: number, reason: string): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

function createSampleSnowRushRoom(overrides?: Partial<GameRoom>): GameRoom {
  const players: RoomPlayer[] = [
    {
      uid: 'uid_host',
      playerId: 'SG-100001',
      displayName: 'အောင်အောင်',
      photoURL: '',
      isReady: true,
      color: '#EF4444',
      position: 1,
      isConnected: true,
      lastSeen: 1000,
    },
    {
      uid: 'uid_guest',
      playerId: 'SG-100002',
      displayName: 'မေသက်',
      photoURL: '',
      isReady: true,
      color: '#0EA5E9',
      position: 1,
      isConnected: true,
      lastSeen: 1005,
    },
  ];

  return {
    id: 'ROOM48',
    roomCode: '480001',
    gameType: 'snow_rush',
    hostId: 'uid_host',
    hostName: 'အောင်အောင်',
    status: 'playing',
    maxPlayers: 4,
    playerCount: 2,
    players,
    currentTurnIndex: 0,
    lastDiceRoll: 0,
    lastMoveSummary: '',
    winnerId: null,
    winnerName: null,
    exactFinish: false,
    gameRound: 1,
    turnStartTimestamp: 1000,
    turnDeadline: 31000,
    reconnectionDeadline: null,
    disconnectedPlayerId: null,
    disconnectedPlayerName: null,
    lastMoveTimestamp: 1000,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z',
    ...overrides,
  };
}

function createDummyGameplayProps(room: GameRoom, currentUserId: string | null): GameModuleGameplayProps {
  const matchedPlayer = currentUserId
    ? room.players.find((p) => p.uid === currentUserId)
    : undefined;
  return {
    room,
    currentUserId,
    currentUserDisplayName: matchedPlayer?.displayName ?? null,
    currentPlayer: matchedPlayer,
    isHost: currentUserId === room.hostId,
    isOnline: true,
    reconnectCountdown: 0,
    cosmetics: {
      activeBoardSkin: 'classic',
      activeDiceSkin: 'classic',
      activeTokenSkin: 'classic',
      activeFrame: 'none',
    },
    rewardOutcome: null,
    fallbackProgress: {
      level: 1,
      totalXp: 0,
      currentLevelXp: 0,
      xpForNextLevel: 150,
      xpRemainingForNextLevel: 150,
      progressPercent: 0,
      isMaxLevel: false,
    },
    isClaimingReward: false,
    isExiting: false,
    onCommitRoomState: () => {
      throw new Error('Snow Rush Step 4.8 must NEVER call onCommitRoomState');
    },
    onTurnTimeout: async () => {},
    onPlayAgain: async () => {
      throw new Error('Snow Rush Step 4.8 must NEVER call onPlayAgain / resetRoomToPlayAgain');
    },
    onRequestExit: () => {},
    onLeaveAfterFinish: async () => {},
  };
}

function collectFilesRecursively(dirPath: string): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      results.push(...collectFilesRecursively(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

async function runTests(): Promise<void> {
  let passed = 0;

  // ---------------------------------------------------------------------------
  // Test 1: Empty `VITE_SNOW_RUSH_WS_URL=""` safety & Burmese unconfigured UI
  // ---------------------------------------------------------------------------
  {
    assert.equal(resolveSnowRushWorkerWsUrl('ROOM48', ''), null);
    assert.equal(resolveSnowRushWorkerWsUrl('ROOM48', '   '), null);
    assert.equal(resolveSnowRushWorkerWsUrl('ROOM48', null), null);
    assert.equal(
      resolveSnowRushWorkerWsUrl('ROOM48', 'https://snow-rush.example.workers.dev/'),
      'wss://snow-rush.example.workers.dev/ws/snow-rush/ROOM48'
    );

    let wsFactoryCalled = 0;
    const room = createSampleSnowRushRoom();
    const gameplayProps = createDummyGameplayProps(room, 'uid_host');
    const html = renderToStaticMarkup(
      React.createElement(SnowRushMultiplayerView, {
        ...gameplayProps,
        workerBaseUrlOverride: '',
        createWebSocketOverride: () => {
          wsFactoryCalled += 1;
          return new MockWebSocket('wss://unexpected.example.com');
        },
      })
    );

    assert.equal(wsFactoryCalled, 0, 'Must NEVER open WebSocket when VITE_SNOW_RUSH_WS_URL is empty');
    assert.ok(
      html.includes('Online Multiplayer မချိတ်ဆက်ရသေးပါ'),
      'Must render clear Burmese unconfigured headline'
    );
    assert.ok(
      html.includes('Multiplayer Server မသတ်မှတ်ရသေးပါ'),
      'Must render clear Burmese server unconfigured notice'
    );
    passed += 1;
    console.log('PASS [1/13] Empty VITE_SNOW_RUSH_WS_URL safety & Burmese unconfigured UI');
  }

  // ---------------------------------------------------------------------------
  // Test 2: Local Offline Preview (`?devSnowRush=1`) simulation & Offline Bots intact
  // ---------------------------------------------------------------------------
  {
    let localState = createInitialSnowRushState({
      playerName: 'စမ်းသပ်သူ',
      showOfflineBots: true,
      trackSeed: 20260408,
    });
    assert.equal(localState.showOfflineBots, true);
    assert.equal(localState.offlineDemoBots.length, 2);

    localState = startCountdownState(localState, {
      playerName: 'စမ်းသပ်သူ',
      showOfflineBots: true,
      trackSeed: 20260408,
    });
    for (let i = 0; i < 90; i += 1) {
      localState = stepSnowRushSimulation(
        localState,
        { steerLeft: false, steerRight: true, jumpPressed: false, useItemPressed: false },
        1 / 30
      );
    }
    assert.equal(localState.phase, 'racing');
    assert.ok(localState.player.distanceM > 0, 'Local player advances cleanly offline');
    const localHud = buildHudSnapshot(localState);
    assert.equal(localHud.showOfflineBots, true);
    assert.equal(localHud.bots.length, 2);

    const localBarHtml = renderToStaticMarkup(
      React.createElement(RaceProgressBar, {
        hud: localHud,
        soundEnabled: true,
        onToggleSound: () => {},
        onRestartDemo: () => {},
      })
    );
    assert.ok(localBarHtml.includes('Restart Demo'), 'Local mode keeps Restart Demo button');
    passed += 1;
    console.log('PASS [2/13] Local Offline Preview (?devSnowRush=1) & Offline Demo Bots intact');
  }

  // ---------------------------------------------------------------------------
  // Test 3: `snow_rush` activated as `available` in `registry.ts` & resolved in `moduleResolver` (Step 10.5)
  // ---------------------------------------------------------------------------
  {
    const snowEntry = getGameById('snow_rush');
    assert.ok(snowEntry);
    assert.equal(snowEntry.status, 'available', 'snow_rush MUST be available in registry.ts (Step 10.5)');

    const availableIds = getAvailableGames().map((g) => g.id);
    assert.deepEqual(
      availableIds,
      ['snakes_and_ladders', 'snow_rush'],
      'Both snakes_and_ladders and snow_rush are available in production'
    );
    assert.ok(availableIds.includes('snow_rush'), 'snow_rush appears in getAvailableGames()');

    const registeredModuleIds = getRegisteredGameModuleIds();
    assert.ok(
      registeredModuleIds.includes('snow_rush'),
      'snow_rush module is wired in REGISTERED_GAME_MODULES'
    );
    assert.equal(snowRushModule.id, 'snow_rush');

    const snowResolution = resolveGameModule('snow_rush');
    assert.equal(snowResolution.kind, 'resolved');
    if (snowResolution.kind === 'resolved') {
      assert.equal(snowResolution.module, snowRushModule);
    }
    assert.equal(isGameModulePlayable('snow_rush'), true);
    passed += 1;
    console.log('PASS [3/14] snow_rush activated as available & resolved in moduleResolver (Step 10.5)');
  }

  // ---------------------------------------------------------------------------
  // Test 4: `kart_racing`, `snakes_and_ladders`, and unknown game type invariants
  // ---------------------------------------------------------------------------
  {
    const kartEntry = getGameById('kart_racing');
    assert.ok(kartEntry);
    assert.equal(kartEntry.status, 'coming_soon');
    const kartRes = resolveGameModule('kart_racing');
    assert.equal(kartRes.kind, 'unresolved');
    if (kartRes.kind === 'unresolved') {
      assert.equal(kartRes.reason, 'coming_soon');
    }

    const snakesRes = resolveGameModule('snakes_and_ladders');
    assert.equal(snakesRes.kind, 'resolved');
    if (snakesRes.kind === 'resolved') {
      assert.equal(snakesRes.module, snakesAndLaddersModule);
    }

    const unknownRes = resolveGameModule('non_existent_game_xyz');
    assert.equal(unknownRes.kind, 'unresolved');
    if (unknownRes.kind === 'unresolved') {
      assert.equal(unknownRes.reason, 'unknown_game');
    }

    assert.equal(getAllGames().length, 8);
    passed += 1;
    console.log('PASS [4/13] kart_racing, snakes_and_ladders & unknown game type guards unchanged');
  }

  // ---------------------------------------------------------------------------
  // Test 5: Online Mode strictly excludes Offline Demo Bots
  // ---------------------------------------------------------------------------
  {
    let mpState = createInitialMultiplayerRaceState({
      players: [
        { uid: 'u1', displayName: 'ကိုကို', color: '#EF4444' },
        { uid: 'u2', displayName: 'ညီညီ', color: '#10B981' },
      ],
      trackSeed: 998877,
    });
    mpState = startMultiplayerCountdown(mpState);
    const snapshot = buildMultiplayerSnapshot(mpState);

    const { hud, extras } = buildMultiplayerHudSnapshot(snapshot, 'u1');
    assert.equal(hud.showOfflineBots, false, 'Online HUD must NEVER enable Offline Bots');
    assert.equal(hud.bots.length, 0, 'Online HUD bots list must ALWAYS be empty');
    assert.equal(extras.remoteRacers.length, 1);
    assert.equal(extras.remoteRacers[0].uid, 'u2');

    const mpBarHtml = renderToStaticMarkup(
      React.createElement(RaceProgressBar, {
        hud,
        soundEnabled: true,
        onToggleSound: () => {},
        isMultiplayer: true,
        multiplayerExtras: extras,
        onRequestExit: () => {},
      })
    );
    assert.ok(!mpBarHtml.includes('Restart Demo'), 'Multiplayer HUD must NOT show Restart Demo');
    assert.ok(!mpBarHtml.includes('Offline'), 'Multiplayer HUD must NOT show Offline bot markers');
    assert.ok(mpBarHtml.includes('ထွက်မည်'), 'Multiplayer HUD shows Exit button');
    passed += 1;
    console.log('PASS [5/13] Online Mode strictly excludes Offline Demo Bots');
  }

  // ---------------------------------------------------------------------------
  // Test 6: Authoritative Snapshot maps 4 Human Players, Colors, Items, Projectiles, Traps & Shield
  // ---------------------------------------------------------------------------
  {
    let state4p = createInitialMultiplayerRaceState({
      players: [
        { uid: 'p1', displayName: 'အောင်', color: '#EF4444' },
        { uid: 'p2', displayName: 'မေ', color: '#0EA5E9' },
        { uid: 'p3', displayName: 'ကျော်', color: '#10B981' },
        { uid: 'p4', displayName: 'စု', color: '#F59E0B' },
      ],
      trackSeed: 4082026,
    });
    state4p = startMultiplayerCountdown(state4p);
    // Advance past 2.7s countdown (55 ticks @ 20 Hz)
    for (let t = 0; t < 60; t += 1) {
      state4p = stepMultiplayerSnowRushTick(state4p, {}, 0.05);
    }
    assert.equal(state4p.phase, 'racing');

    // Equip items on authoritative state to verify snapshot -> HUD & event translation
    state4p.racers.p1.heldItem = 'snowball_attack';
    state4p.racers.p1.itemArmingTimerSec = 0;
    state4p.racers.p2.shieldTimerSec = 4.2;
    state4p.projectiles.push({
      id: 'proj_test_1',
      ownerId: 'p1',
      distanceM: state4p.racers.p1.distanceM + 8,
      startDistanceM: state4p.racers.p1.distanceM,
      maxRangeM: 180,
      laneOffset: state4p.racers.p1.laneOffset,
      speedMps: 34,
      active: true,
    });
    state4p.traps.push({
      id: 'trap_test_1',
      ownerId: 'p3',
      distanceM: state4p.racers.p3.distanceM - 3,
      laneOffset: state4p.racers.p3.laneOffset,
      halfLengthM: 1.15,
      halfWidthLane: 0.115,
      remainingSec: 15,
      ageSec: 1,
      active: true,
    });

    const snap4p = buildMultiplayerSnapshot(state4p);
    const interp = new SnowRushSnapshotInterpolator();
    interp.pushSnapshot(snap4p, 1000);
    const sampled = interp.sample(1100);
    assert.ok(sampled);

    const { hud: p1Hud, extras: p1Extras } = buildMultiplayerHudSnapshot(sampled, 'p1');
    assert.equal(p1Hud.totalRacers, 4);
    assert.equal(p1Hud.heldItem, 'snowball_attack');
    assert.equal(p1Hud.isItemReady, true);
    assert.equal(p1Extras.remoteRacers.length, 3);

    const { hud: p2Hud } = buildMultiplayerHudSnapshot(sampled, 'p2');
    assert.ok(p2Hud.shieldRemainingSec > 4.0);

    const scene = reconstructMultiplayerSceneData(sampled, null, 'p1');
    assert.equal(scene.track.seed, 4082026);
    assert.equal(sampled.activeProjectiles.length, 1);
    assert.equal(sampled.activeTraps.length, 1);

    const p1Palette = deriveRacerPaletteFromHex('#EF4444', true);
    const p3Palette = deriveRacerPaletteFromHex('#10B981', false);
    assert.notEqual(p1Palette.jacketColor, p3Palette.jacketColor);

    const translated = translateMultiplayerEventsForClient(
      [
        { type: 'item_pickup', uid: 'p1', itemId: 'nitro_boost', boxId: snap4p.itemBoxStatuses[0].id },
        { type: 'snowball_hit', attackerId: 'p1', targetId: 'p2' },
        { type: 'shield_break', uid: 'p2', reason: 'snowball' },
      ],
      snap4p,
      'p1',
      1
    );
    assert.equal(translated.bursts.length, 3);
    assert.ok(translated.soundCues.some((c) => c.kind === 'item_pickup'));
    assert.ok(translated.soundCues.some((c) => c.kind === 'snowball_hit'));
    passed += 1;
    console.log('PASS [6/13] 4-player snapshot -> HUD, palettes, items, projectiles, traps & bursts');
  }

  // ---------------------------------------------------------------------------
  // Test 7: Snapshot Interpolator smooth lerp & `> 12m` Snow Tumble teleport snap
  // ---------------------------------------------------------------------------
  {
    let baseState = createInitialMultiplayerRaceState({
      players: [
        { uid: 'uA', displayName: 'A', color: '#EF4444' },
        { uid: 'uB', displayName: 'B', color: '#0EA5E9' },
      ],
      trackSeed: 123456,
    });
    baseState = startMultiplayerCountdown(baseState);
    baseState.phase = 'racing';
    baseState.serverTick = 10;
    baseState.racers.uA.distanceM = 100;
    baseState.racers.uB.distanceM = 120;
    const snap1 = buildMultiplayerSnapshot(baseState);

    baseState.serverTick = 12;
    baseState.racers.uA.distanceM = 104; // +4m normal motion (<= 12m -> smooth lerp)
    baseState.racers.uB.distanceM = 148; // +28m Snow Tumble recovery (> 12m -> instant snap!)
    const snap2 = buildMultiplayerSnapshot(baseState);

    const interpolator = new SnowRushSnapshotInterpolator(100);
    interpolator.pushSnapshot(snap1, 1000);
    interpolator.pushSnapshot(snap2, 1100);

    // Sample at nowMs = 1150 -> renderTimeMs = 1050 -> alpha = 0.5
    const midFrame = interpolator.sample(1150);
    assert.ok(midFrame);
    assert.equal(midFrame.racers.uA.distanceM, 102, 'Normal motion lerps smoothly at alpha=0.5');
    assert.equal(
      midFrame.racers.uB.distanceM,
      148,
      'Snow Tumble recovery >12m snaps cleanly without lerping through obstacles'
    );
    passed += 1;
    console.log('PASS [7/13] Snapshot interpolation smooth lerp & >12m recovery teleport snap');
  }

  // ---------------------------------------------------------------------------
  // Test 8: Online Input Controller + SocketClient (`seq`, anti-repeat, disconnect gate)
  // ---------------------------------------------------------------------------
  {
    let fakeClockMs = 5000;
    const sockets: MockWebSocket[] = [];
    const client = new SnowRushSocketClient({
      roomId: 'ROOM48',
      workerBaseUrl: 'https://snow-rush.example.workers.dev',
      nowMs: () => fakeClockMs,
      getIdToken: async () => 'x'.repeat(64),
      createWebSocket: (url) => {
        const ws = new MockWebSocket(url);
        sockets.push(ws);
        return ws;
      },
    });

    const controller = new SnowRushOnlineInputController((intent) => {
      client.sendInput(intent);
    });

    // Disconnected gate: inputs while idle/connecting must NOT send anything
    controller.setKeySteerLeft(true);
    controller.triggerManualItem({ isRepeat: false, fromKeyboard: true });
    controller.resetAllInputs();
    assert.equal(sockets.length, 0);

    client.connect();
    assert.equal(sockets.length, 1);
    sockets[0].triggerOpen();
    await Promise.resolve();
    await Promise.resolve();

    // Verify auth frame sent first
    assert.equal(sockets[0].sentFrames.length, 1);
    const authPayload = JSON.parse(sockets[0].sentFrames[0]) as { type: string };
    assert.equal(authPayload.type, 'auth');

    // Server sends `welcome` in active `racing` phase
    let mpState = createInitialMultiplayerRaceState({
      players: [
        { uid: 'uid_host', displayName: 'အောင်', color: '#EF4444' },
        { uid: 'uid_guest', displayName: 'မေ', color: '#0EA5E9' },
      ],
      trackSeed: 777,
    });
    mpState.phase = 'racing';
    const welcomeSnap = buildMultiplayerSnapshot(mpState);

    sockets[0].triggerServerJson({
      type: 'welcome',
      protocolVersion: SNOW_RUSH_PROTOCOL_VERSION,
      roomId: 'ROOM48',
      gameRound: 1,
      uid: 'uid_host',
      snapshotHz: 10,
      serverTimeMs: fakeClockMs,
      snapshot: welcomeSnap,
    });

    assert.equal(client.getStatus(), 'connected');
    controller.updateGate({
      connectionStatus: 'connected',
      racePhase: 'racing',
      localFinished: false,
    });

    const beforeInputCount = sockets[0].sentFrames.length;
    fakeClockMs += 60;
    controller.setKeySteerRight(true);
    assert.equal(sockets[0].sentFrames.length, beforeInputCount + 1);
    const firstInput = JSON.parse(sockets[0].sentFrames[beforeInputCount]) as {
      type: string;
      seq: number;
      steer: number;
      useItemPressed: boolean;
    };
    assert.equal(firstInput.type, 'input');
    assert.equal(firstInput.seq, 1);
    assert.equal(firstInput.steer, 1);
    assert.equal(firstInput.useItemPressed, false);

    // Manual item key press: first press fires, held-down key auto-repeats MUST NOT fire!
    fakeClockMs += 60;
    const firedFirst = controller.triggerManualItem({ isRepeat: false, fromKeyboard: true });
    const firedRepeat1 = controller.triggerManualItem({ isRepeat: true, fromKeyboard: true });
    const firedHeldDuplicate = controller.triggerManualItem({ isRepeat: false, fromKeyboard: true });
    assert.equal(firedFirst, true);
    assert.equal(firedRepeat1, false, 'e.repeat MUST NOT fire item again');
    assert.equal(firedHeldDuplicate, false, 'Held item key MUST NOT fire again before keyup');

    const secondInput = JSON.parse(sockets[0].sentFrames[beforeInputCount + 1]) as {
      seq: number;
      useItemPressed: boolean;
    };
    assert.equal(secondInput.seq, 2);
    assert.equal(secondInput.useItemPressed, true);

    // Release key -> next fresh press works cleanly
    controller.releaseItemKey();
    fakeClockMs += 60;
    assert.equal(controller.triggerManualItem({ isRepeat: false, fromKeyboard: true }), true);

    client.dispose();
    passed += 1;
    console.log('PASS [8/13] Online input controller seq, anti-repeat item trigger & disconnect gate');
  }

  // ---------------------------------------------------------------------------
  // Test 9: Complete Burmese Network Status Banner & terminal reject non-looping
  // ---------------------------------------------------------------------------
  {
    const statesToVerify: Array<{
      props: Parameters<typeof resolveNetworkBannerDescriptor>[0];
      expectedSubstring: string;
    }> = [
      { props: { status: 'connecting' }, expectedSubstring: 'ချိတ်ဆက်နေသည်' },
      { props: { status: 'authenticating' }, expectedSubstring: 'Authentication စစ်ဆေးနေသည်' },
      { props: { status: 'connected', rttMs: 42 }, expectedSubstring: 'ချိတ်ဆက်ပြီး' },
      { props: { status: 'disconnected' }, expectedSubstring: 'Network ပြတ်တောက်နေသည်' },
      { props: { status: 'reconnecting', reconnectAttempt: 2 }, expectedSubstring: 'ပြန်လည်ချိတ်ဆက်နေသည်' },
      { props: { status: 'rejected', isRoomExited: true }, expectedSubstring: 'အခန်းမှ ထွက်သွားရပြီ' },
      {
        props: { status: 'rejected', errorCode: 'ROOM_NOT_FOUND' },
        expectedSubstring: 'Room မမှန်ကန်ပါ',
      },
      {
        props: { status: 'error', errorCode: 'WS_UNCONFIGURED' },
        expectedSubstring: 'Multiplayer Server မသတ်မှတ်ရသေးပါ',
      },
      {
        props: { status: 'error', errorCode: 'CONNECTION_FAILED' },
        expectedSubstring: 'Multiplayer Server ချိတ်ဆက်မှု မအောင်မြင်ပါ',
      },
    ];

    for (const item of statesToVerify) {
      const desc = resolveNetworkBannerDescriptor(item.props);
      assert.equal(desc.visible, true);
      assert.ok(
        desc.headlineMm.includes(item.expectedSubstring),
        `Expected "${item.expectedSubstring}" in "${desc.headlineMm}"`
      );
      const bannerHtml = renderToStaticMarkup(
        React.createElement(SnowRushNetworkStatusBanner, item.props)
      );
      assert.ok(bannerHtml.includes(item.expectedSubstring));
    }

    assert.equal(
      resolveNetworkBannerDescriptor({ status: 'error', errorCode: 'WS_UNCONFIGURED' })
        .canManualRetry,
      false,
      'WS_UNCONFIGURED must not expose manual retry'
    );
    assert.equal(
      resolveNetworkBannerDescriptor({ status: 'error', errorCode: 'CONNECTION_FAILED' })
        .canManualRetry,
      true,
      'CONNECTION_FAILED must expose manual retry button when Worker URL is configured'
    );

    // Verify terminal 4401 / 4403 / 4404 close codes do NOT schedule reconnect loops
    const createdSockets: MockWebSocket[] = [];
    const statusHistory: SnowRushConnectionStatus[] = [];
    const rejectedClient = new SnowRushSocketClient({
      roomId: 'ROOM48',
      workerBaseUrl: 'https://snow-rush.example.workers.dev',
      reconnectDelaysMs: [10, 10, 10],
      getIdToken: async () => 'y'.repeat(64),
      createWebSocket: (url) => {
        const ws = new MockWebSocket(url);
        createdSockets.push(ws);
        return ws;
      },
      onStatusChange: (st) => statusHistory.push(st),
    });

    rejectedClient.connect();
    assert.equal(createdSockets.length, 1);
    createdSockets[0].triggerOpen();
    await Promise.resolve();
    createdSockets[0].triggerServerJson({
      type: 'error',
      code: 'NOT_ROOM_MEMBER',
      message: 'Not a room member',
      fatal: true,
    });
    createdSockets[0].triggerServerClose(
      SNOW_RUSH_WS_CLOSE_CODES.FORBIDDEN_ROOM,
      'Not a room member'
    );

    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(
      createdSockets.length,
      1,
      'Terminal auth/room rejection MUST NOT enter reconnect loop'
    );
    assert.equal(rejectedClient.getStatus(), 'rejected');
    rejectedClient.dispose();

    // Also verify room preflight guard helper
    const validRoom = createSampleSnowRushRoom();
    assert.equal(evaluateMultiplayerRoomGuard(validRoom, 'uid_host'), null);
    assert.equal(evaluateMultiplayerRoomGuard(validRoom, 'stranger_uid'), 'NOT_ROOM_MEMBER');
    assert.equal(
      evaluateMultiplayerRoomGuard({ ...validRoom, status: 'waiting' }, 'uid_host'),
      'ROOM_NOT_PLAYING'
    );
    assert.equal(
      evaluateMultiplayerRoomGuard({ ...validRoom, gameType: 'snakes_and_ladders' }, 'uid_host'),
      'WRONG_GAME_TYPE'
    );

    passed += 1;
    console.log('PASS [9/13] All 8 Burmese network states & zero reconnect loop on terminal reject');
  }

  // ---------------------------------------------------------------------------
  // Test 10: Authoritative `race_finished` Podium UI rendering
  // ---------------------------------------------------------------------------
  {
    let race = createInitialMultiplayerRaceState({
      players: [
        { uid: 'uid_1', displayName: 'သီဟ', color: '#EF4444' },
        { uid: 'uid_2', displayName: 'ချမ်းမြေ့', color: '#0EA5E9' },
        { uid: 'uid_3', displayName: 'မင်းခန့်', color: '#10B981' },
      ],
      trackSeed: 555666,
    });
    race.phase = 'racing';
    race.elapsedRaceMs = 74250;
    race.racers.uid_1.distanceM = COURSE_LENGTH_M;
    race.racers.uid_1.finishTimeMs = 71800;
    race.racers.uid_1.finishRank = 1;
    race.racers.uid_2.distanceM = COURSE_LENGTH_M;
    race.racers.uid_2.finishTimeMs = 74250;
    race.racers.uid_2.finishRank = 2;
    race.racers.uid_3.distanceM = 1312.4;

    race = finalizeMultiplayerRace(race, 'post_winner_timeout');
    const finalSnap = buildMultiplayerSnapshot(race);

    const podiumHtml = renderToStaticMarkup(
      React.createElement(SnowRushMultiplayerPodium, {
        finishState: finalSnap.finishState,
        snapshot: finalSnap,
        currentUserId: 'uid_2',
        connectionStatus: 'connected',
        rttMs: 55,
        isExiting: false,
        onExitRoom: () => {},
      })
    );

    assert.ok(podiumHtml.includes('သီဟ'), 'Winner name rendered');
    assert.ok(podiumHtml.includes('ချမ်းမြေ့ (သင်)'), 'Local player tag rendered');
    assert.ok(podiumHtml.includes('မင်းခန့်'), 'Rank 3 player rendered');
    assert.ok(podiumHtml.includes('#1') && podiumHtml.includes('#2') && podiumHtml.includes('#3'));
    assert.ok(podiumHtml.includes('1.50 km'), 'Finished racers display 1.50 km');
    assert.ok(!podiumHtml.includes('1.00 km'), 'Old 1.00 km finish label is completely removed');
    assert.ok(
      podiumHtml.includes(formatMultiplayerFinishReasonMm('post_winner_timeout')),
      'Burmese finish reason rendered'
    );
    assert.ok(
      podiumHtml.includes('No XP / Points Rewards in Phase 1') &&
        podiumHtml.includes('XP / Points ဆုကြေး မပါဝင်သေးပါ') &&
        !podiumHtml.includes('Display-Only Multiplayer'),
      'Public Phase 1 no-reward notice rendered without private test text'
    );
    assert.ok(podiumHtml.includes('အခန်းမှ ထွက်မည်'), 'Exit Room button rendered');
    passed += 1;
    console.log('PASS [10/14] Authoritative race_finished Podium UI renders Winner, 1.50 km & Exit');
  }

  // ---------------------------------------------------------------------------
  // Test 11: Client disconnect / unmount cleans up socket and all timers
  // ---------------------------------------------------------------------------
  {
    const sockets: MockWebSocket[] = [];
    const client = new SnowRushSocketClient({
      roomId: 'ROOM48',
      workerBaseUrl: 'https://snow-rush.example.workers.dev',
      reconnectDelaysMs: [25, 50],
      getIdToken: async () => 'z'.repeat(64),
      createWebSocket: (url) => {
        const ws = new MockWebSocket(url);
        sockets.push(ws);
        return ws;
      },
    });

    client.connect();
    assert.equal(sockets.length, 1);
    // Simulate unexpected transient drop to arm reconnect timer
    sockets[0].triggerServerClose(1006, 'Abnormal closure');
    assert.equal(client.getStatus(), 'reconnecting');

    // Immediately dispose (as on component unmount / room exit)
    client.dispose();
    assert.equal(client.getStatus(), 'disconnected');

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(
      sockets.length,
      1,
      'Disposed client MUST NOT open reconnect sockets after unmount'
    );
    passed += 1;
    console.log('PASS [11/13] Unmount / dispose cancels active socket and pending reconnect timers');
  }

  // ---------------------------------------------------------------------------
  // Test 12: Static Security & No-Settlement Audit across `src/games/snow-rush/`
  // ---------------------------------------------------------------------------
  {
    const snowRushRoot = path.resolve(process.cwd(), 'src/games/snow-rush');
    const prodFiles = collectFilesRecursively(snowRushRoot);
    assert.ok(prodFiles.length >= 12);

    const forbiddenPatterns: Array<{ regex: RegExp; label: string }> = [
      { regex: /\bclaimMatchReward\b/, label: 'claimMatchReward()' },
      { regex: /\bresetRoomToPlayAgain\b/, label: 'resetRoomToPlayAgain()' },
      { regex: /\bupdateDoc\s*\(/, label: 'Firestore updateDoc()' },
      { regex: /\bsetDoc\s*\(/, label: 'Firestore setDoc()' },
      { regex: /\brunTransaction\s*\(/, label: 'Firestore runTransaction()' },
      { regex: /\bdeleteDoc\s*\(/, label: 'Firestore deleteDoc()' },
    ];

    for (const filePath of prodFiles) {
      const rawSource = fs.readFileSync(filePath, 'utf8');
      const codeOnly = rawSource
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const rule of forbiddenPatterns) {
        assert.equal(
          rule.regex.test(codeOnly),
          false,
          `Forbidden ${rule.label} found in ${path.relative(process.cwd(), filePath)}`
        );
      }
    }
    passed += 1;
    console.log('PASS [12/13] Zero Firestore writes, zero claimMatchReward & zero resetRoomToPlayAgain');
  }

  // ---------------------------------------------------------------------------
  // Test 13: Snakes & Ladders Regression Check
  // ---------------------------------------------------------------------------
  {
    assert.equal(snakesAndLaddersModule.id, 'snakes_and_ladders');
    assert.equal(typeof snakesAndLaddersModule.GameplayComponent, 'function');
    const ruleSummary = snakesAndLaddersModule.getRuleSummaryMm?.({
      exactFinish: true,
      maxPlayers: 4,
    });
    assert.ok(typeof ruleSummary === 'string' && ruleSummary.length > 0);
    passed += 1;
    console.log('PASS [13/14] Snakes & Ladders module regression check');
  }

  // ---------------------------------------------------------------------------
  // Test 14: 1.50 KM (1,500 m) HUD Progress, Quarter-KM Checkpoints & Local/MP Copy
  // ---------------------------------------------------------------------------
  {
    assert.equal(COURSE_LENGTH_M, 1500);
    assert.equal(COURSE_LENGTH_KM_TEXT, '1.50');
    assert.deepEqual(COURSE_CHECKPOINT_METERS, [250, 500, 750, 1000, 1250]);

    assert.ok(snowRushModule.instructionsMm.includes('1.50 km'));
    assert.ok(!snowRushModule.instructionsMm.includes('1.00 km'));
    const snowRuleSummary = snowRushModule.getRuleSummaryMm?.({
      exactFinish: false,
      maxPlayers: 4,
    });
    assert.ok(snowRuleSummary?.includes('၁.၅၀ ကီလိုမီတာ'));
    assert.ok(formatMultiplayerFinishReasonMm('all_finished').includes('1.50 km'));

    // Progress at 1,000m is 66.7% (NOT 100%) and race remains in 'racing' phase
    let mpAt1000 = createInitialMultiplayerRaceState({
      players: [
        { uid: 'u1', displayName: 'အောင်', color: '#EF4444' },
        { uid: 'u2', displayName: 'မေ', color: '#0EA5E9' },
      ],
      trackSeed: 150099,
    });
    mpAt1000.phase = 'racing';
    mpAt1000.racers.u1.distanceM = 1000;
    mpAt1000.racers.u2.distanceM = 750;
    const snap1000 = buildMultiplayerSnapshot(mpAt1000);
    const { hud: hud1000, extras: extras1000 } = buildMultiplayerHudSnapshot(snap1000, 'u1');
    assert.equal(hud1000.distanceKmText, '1.00');
    assert.equal(hud1000.courseLengthKmText, '1.50');
    assert.ok(Math.abs(hud1000.progressPercent - 66.6667) < 0.05);
    assert.equal(extras1000.localFinished, false);

    const barHtml = renderToStaticMarkup(
      React.createElement(RaceProgressBar, {
        hud: hud1000,
        soundEnabled: true,
        onToggleSound: () => {},
        isMultiplayer: true,
        multiplayerExtras: extras1000,
      })
    );
    assert.ok(barHtml.includes('aria-valuemax="1500"'), 'Progress bar aria-valuemax is 1500');
    assert.ok(barHtml.includes('1.50 km'), 'Finish line label shows 1.50 km');
    for (const cp of ['0.25 km (250 m)', '0.50 km (500 m)', '0.75 km (750 m)', '1.00 km (1000 m)', '1.25 km (1250 m)']) {
      assert.ok(barHtml.includes(cp), `Progress bar includes checkpoint marker ${cp}`);
    }

    // Local Prototype View ready overlay shows 1.50 km (1,500 m)
    const protoHtml = renderToStaticMarkup(
      React.createElement(SnowRushPrototypeView, {
        playerDisplayName: 'စမ်းသပ်သူ',
        instructionsMm: snowRushModule.instructionsMm,
      })
    );
    assert.ok(protoHtml.includes('1.50 km'), 'Local Prototype View shows 1.50 km');
    assert.ok(protoHtml.includes('1,500 m'), 'Local Prototype View shows 1,500 m');
    assert.ok(protoHtml.includes('Start 1.50 km Race'), 'Start button shows Start 1.50 km Race');

    passed += 1;
    console.log('PASS [14/14] 1.50 KM (1,500 m) HUD, quarter-km checkpoints & Local/MP UI verified');
  }

  console.log(`\nStep 4.8 + 1.50 KM Automated Frontend Integration Suite: ${passed}/14 PASSED.`);
}

runTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Step 4.8 Frontend Integration Test FAILED:', err);
    process.exit(1);
  });
