import {
  AVALANCHE_BASE_SPEED_MPS,
  AVALANCHE_CATCHUP_MAX_GAP_M,
  AVALANCHE_MAX_SPEED_MPS,
  AVALANCHE_SAFE_GRACE_SEC,
  COURSE_LENGTH_KM_TEXT,
  COURSE_LENGTH_M,
  ITEM_ARMING_DELAY_SEC,
  ITEM_BOX_OBSTACLE_CLEARANCE_M,
  ITEM_BOX_ROW_DISTANCES_M,
  MERCY_INVULN_DURATION_SEC,
  MULTIPLAYER_TICK_DT_SEC,
  NITRO_MAX_SPEED_CAP_MPS,
  POST_WINNER_FINISH_WINDOW_SEC,
  RACER_COLLISION_HALF_LANE,
  SNOW_TUMBLE_DURATION_SEC,
  SNOW_TUMBLE_MAX_RECOVERY_M,
  SNOW_TUMBLE_RECOVERY_AHEAD_M,
  STARTING_GRID_LANES_2P,
  STARTING_GRID_LANES_3P,
  STARTING_GRID_LANES_4P,
  TRACK_OBSTACLE_END_M,
  TRACK_OBSTACLE_START_M,
  TRACK_SAFE_LANE_LIMIT,
} from '../constants';
import {
  buildHudSnapshot,
  createInitialSnowRushState,
  formatDistanceKm,
  startCountdownState,
  stepSnowRushSimulation,
} from '../simulation';
import type { SnowRushObstacleKind } from '../types';
import {
  buildMultiplayerSnapshot,
  computeRaceStandings,
  createInitialMultiplayerRaceState,
  createStartingGrid,
  resolveMultiplayerCollisions,
  resolveSimultaneousItemPickup,
  restoreMultiplayerStateFromSnapshot,
  sanitizeClientInputPayload,
  setMultiplayerRacerConnection,
  startMultiplayerCountdown,
  stepMultiplayerSnowRushTick,
} from './index';
import type {
  AuthoritativeRacerState,
  MultiplayerPlayerInit,
  MultiplayerRaceEvent,
  MultiplayerRaceState,
  SnowRushInputFrame,
} from './index';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, message: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `Assertion failed: ${message} (expected ~${expected} ±${tolerance}, received ${actual})`
    );
  }
}

function advanceThroughCountdown(state: MultiplayerRaceState): MultiplayerRaceState {
  let current =
    state.phase === 'countdown' ? state : startMultiplayerCountdown(state);
  let safety = 0;
  while (current.phase === 'countdown' && safety < 100) {
    current = stepMultiplayerSnowRushTick(current, {}, MULTIPLAYER_TICK_DT_SEC);
    safety += 1;
  }
  assert(current.phase === 'racing', 'Race should transition from countdown to racing');
  return current;
}

const TEST_PLAYERS_2: readonly MultiplayerPlayerInit[] = [
  { uid: 'uid_alpha', displayName: 'အယ်လ်ဖာ' },
  { uid: 'uid_bravo', displayName: 'ဘရာဗို' },
];

const TEST_PLAYERS_3: readonly MultiplayerPlayerInit[] = [
  { uid: 'uid_alpha', displayName: 'အယ်လ်ဖာ' },
  { uid: 'uid_bravo', displayName: 'ဘရာဗို' },
  { uid: 'uid_charlie', displayName: 'ချာလီ' },
];

const TEST_PLAYERS_4: readonly MultiplayerPlayerInit[] = [
  { uid: 'uid_alpha', displayName: 'အယ်လ်ဖာ' },
  { uid: 'uid_bravo', displayName: 'ဘရာဗို' },
  { uid: 'uid_charlie', displayName: 'ချာလီ' },
  { uid: 'uid_delta', displayName: 'ဒယ်လ်တာ' },
];

export interface AutomatedTestResult {
  readonly id: number;
  readonly name: string;
  readonly status: 'PASS' | 'FAIL';
  readonly error?: string;
}

export function runSnowRushMultiplayerEngineTests(): AutomatedTestResult[] {
  const results: AutomatedTestResult[] = [];

  const registerTest = (id: number, name: string, fn: () => void) => {
    try {
      fn();
      results.push({ id, name, status: 'PASS' });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({ id, name, status: 'FAIL', error: errorMsg });
    }
  };

  // 1. 2 Players, 3 Players, 4 Players Initial State မှန်ကန်စွာ တည်ဆောက်နိုင်ခြင်း
  registerTest(
    1,
    '2 Players, 3 Players, 4 Players Initial State မှန်ကန်စွာ တည်ဆောက်နိုင်ခြင်း',
    () => {
      const s2 = createInitialMultiplayerRaceState({ players: TEST_PLAYERS_2, trackSeed: 101 });
      const s3 = createInitialMultiplayerRaceState({ players: TEST_PLAYERS_3, trackSeed: 101 });
      const s4 = createInitialMultiplayerRaceState({ players: TEST_PLAYERS_4, trackSeed: 101 });

      assert(Object.keys(s2.racers).length === 2 && s2.racerOrder.length === 2, '2P count');
      assert(Object.keys(s3.racers).length === 3 && s3.racerOrder.length === 3, '3P count');
      assert(Object.keys(s4.racers).length === 4 && s4.racerOrder.length === 4, '4P count');
      assert(s4.phase === 'ready' && s4.serverTick === 0 && s4.elapsedRaceMs === 0, 'Initial ready state');
      assert(s4.finishState.winnerId === null && s4.finishState.standings.length === 4, 'Initial standings');

      let rejected1P = false;
      try {
        createInitialMultiplayerRaceState({ players: [TEST_PLAYERS_2[0]], trackSeed: 101 });
      } catch {
        rejected1P = true;
      }
      assert(rejected1P, 'Must reject < 2 players');

      let rejected5P = false;
      try {
        createInitialMultiplayerRaceState({
          players: [...TEST_PLAYERS_4, { uid: 'uid_echo', displayName: 'Echo' }],
          trackSeed: 101,
        });
      } catch {
        rejected5P = true;
      }
      assert(rejected5P, 'Must reject > 4 players');
    }
  );

  // 2. Starting Grid Lanes သည် 2/3/4 Players အတွက် မထပ်ဘဲ Safe Bounds အတွင်း ရှိခြင်း
  registerTest(
    2,
    'Starting Grid Lanes သည် 2/3/4 Players အတွက် မထပ်ဘဲ Safe Bounds အတွင်း ရှိခြင်း',
    () => {
      const g2 = createStartingGrid(TEST_PLAYERS_2, 20260406);
      const g3 = createStartingGrid(TEST_PLAYERS_3, 20260406);
      const g4 = createStartingGrid(TEST_PLAYERS_4, 20260406);

      assert(
        JSON.stringify(g2.map((s) => s.laneOffset)) === JSON.stringify(STARTING_GRID_LANES_2P),
        '2P exact grid lanes [-0.32, +0.32]'
      );
      assert(
        JSON.stringify(g3.map((s) => s.laneOffset)) === JSON.stringify(STARTING_GRID_LANES_3P),
        '3P exact grid lanes [-0.48, 0, +0.48]'
      );
      assert(
        JSON.stringify(g4.map((s) => s.laneOffset)) === JSON.stringify(STARTING_GRID_LANES_4P),
        '4P exact grid lanes [-0.64, -0.22, +0.22, +0.64]'
      );

      for (const grid of [g2, g3, g4]) {
        for (let i = 0; i < grid.length; i += 1) {
          assert(
            Math.abs(grid[i].laneOffset) <= TRACK_SAFE_LANE_LIMIT,
            'Lane must stay within [-0.86, +0.86]'
          );
          for (let j = i + 1; j < grid.length; j += 1) {
            const sep = Math.abs(grid[i].laneOffset - grid[j].laneOffset);
            assert(
              sep > RACER_COLLISION_HALF_LANE * 2 + 0.2,
              `Racers must never overlap laterally at start (sep=${sep})`
            );
          }
        }
      }
    }
  );

  // 3. Shared trackSeed မှ Deterministic Obstacles နှင့် Item Boxes တူညီစွာ ထွက်ခြင်း
  registerTest(
    3,
    'Shared trackSeed မှ Deterministic Obstacles နှင့် Item Boxes တူညီစွာ ထွက်ခြင်း',
    () => {
      const stateA = createInitialMultiplayerRaceState({
        players: TEST_PLAYERS_4,
        trackSeed: 88442211,
      });
      const stateB = createInitialMultiplayerRaceState({
        players: TEST_PLAYERS_2,
        trackSeed: 88442211,
      });
      const stateDifferent = createInitialMultiplayerRaceState({
        players: TEST_PLAYERS_4,
        trackSeed: 99113355,
      });

      assert(
        JSON.stringify(stateA.track) === JSON.stringify(stateB.track),
        'Identical seed must generate identical obstacles and itemBoxes'
      );
      assert(
        JSON.stringify(stateA.track.obstacles) !== JSON.stringify(stateDifferent.track.obstacles),
        'Different seed must generate distinct obstacle layout'
      );

      const seenKinds = new Set<SnowRushObstacleKind>();
      for (const obs of stateA.track.obstacles) {
        seenKinds.add(obs.kind);
        assert(obs.openLaneCenters.length >= 2, 'Every obstacle row must keep >= 2 open lanes');
      }
      assert(seenKinds.size === 6, 'All 6 Snow Rush obstacle kinds must be generated');
      assert(stateA.itemBoxes.length >= 30, '10 Item Box rows x 3..4 boxes must be present');
    }
  );

  // 4. Object Key Order မတူသော်လည်း Simulation Output တူညီခြင်း
  registerTest(
    4,
    'Object Key Order မတူသော်လည်း Simulation Output တူညီခြင်း',
    () => {
      let stateForward = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_4,
          trackSeed: 555001,
          initialPhase: 'countdown',
        })
      );

      let stateReversed = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: [...TEST_PLAYERS_4].reverse(),
          trackSeed: 555001,
          initialPhase: 'countdown',
        })
      );

      // Deliberately reverse `racers` object property insertion order on stateReversed
      const reversedRacersObj: Record<string, AuthoritativeRacerState> = {};
      const revKeys = [...Object.keys(stateReversed.racers)].reverse();
      for (const k of revKeys) {
        reversedRacersObj[k] = stateReversed.racers[k];
      }
      stateReversed = { ...stateReversed, racers: reversedRacersObj };

      for (let tick = 1; tick <= 120; tick += 1) {
        const steerA: -1 | 0 | 1 = tick % 3 === 0 ? -1 : tick % 3 === 1 ? 1 : 0;
        const steerB: -1 | 0 | 1 = tick % 2 === 0 ? 1 : -1;

        const inputsForward: Record<string, SnowRushInputFrame> = {
          uid_alpha: { steer: steerA, jumpPressed: tick === 20, useItemPressed: tick === 50, seq: tick },
          uid_bravo: { steer: steerB, jumpPressed: tick === 25, useItemPressed: tick === 55, seq: tick },
          uid_charlie: { steer: 0, jumpPressed: tick === 30, useItemPressed: tick === 60, seq: tick },
          uid_delta: { steer: steerA, jumpPressed: false, useItemPressed: tick === 65, seq: tick },
        };

        const inputsReversed: Record<string, SnowRushInputFrame> = {
          uid_delta: inputsForward.uid_delta,
          uid_charlie: inputsForward.uid_charlie,
          uid_bravo: inputsForward.uid_bravo,
          uid_alpha: inputsForward.uid_alpha,
        };

        stateForward = stepMultiplayerSnowRushTick(stateForward, inputsForward);
        stateReversed = stepMultiplayerSnowRushTick(stateReversed, inputsReversed);
      }

      const snapForward = buildMultiplayerSnapshot(stateForward);
      const snapReversed = buildMultiplayerSnapshot(stateReversed);
      assert(
        JSON.stringify(snapForward) === JSON.stringify(snapReversed),
        'Snapshots must be byte-for-byte identical regardless of player/object key order'
      );
    }
  );

  // 5. Two Racers တစ်ပြိုင်နက် Item Box ဝင်ချိန် 1 ယောက်သာ ရခြင်း + Deterministic Tie-break
  registerTest(
    5,
    'Two Racers တစ်ပြိုင်နက် Item Box ဝင်ချိန် 1 ယောက်သာ ရခြင်း + Deterministic Tie-break',
    () => {
      const base = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 707070,
          initialPhase: 'countdown',
        })
      );
      const targetBox = base.itemBoxes[0];

      // Exact simultaneous tie: identical prevDistM, distanceM, and laneOffset === targetBox.laneOffset
      const racersOrderA: Record<string, AuthoritativeRacerState> = {
        uid_alpha: {
          ...base.racers.uid_alpha,
          distanceM: targetBox.distanceM + 0.2,
          laneOffset: targetBox.laneOffset,
          heldItem: null,
        },
        uid_bravo: {
          ...base.racers.uid_bravo,
          distanceM: targetBox.distanceM + 0.2,
          laneOffset: targetBox.laneOffset,
          heldItem: null,
        },
      };
      const racersOrderB: Record<string, AuthoritativeRacerState> = {
        uid_bravo: racersOrderA.uid_bravo,
        uid_alpha: racersOrderA.uid_alpha,
      };
      const prevDists = {
        uid_alpha: targetBox.distanceM - 1.5,
        uid_bravo: targetBox.distanceM - 1.5,
      };

      const eventsA: MultiplayerRaceEvent[] = [];
      const resA = resolveSimultaneousItemPickup({
        racers: racersOrderA,
        prevDistancesByUid: prevDists,
        itemBoxes: base.itemBoxes.map((b) => ({ ...b })),
        trackSeed: base.trackSeed,
        serverTick: 42,
        nextEntitySerial: 1,
        events: eventsA,
      });

      const eventsB: MultiplayerRaceEvent[] = [];
      const resB = resolveSimultaneousItemPickup({
        racers: racersOrderB,
        prevDistancesByUid: prevDists,
        itemBoxes: base.itemBoxes.map((b) => ({ ...b })),
        trackSeed: base.trackSeed,
        serverTick: 42,
        nextEntitySerial: 1,
        events: eventsB,
      });

      const alphaGotA = resA.racers.uid_alpha.heldItem !== null;
      const bravoGotA = resA.racers.uid_bravo.heldItem !== null;
      assert(alphaGotA !== bravoGotA, 'Exactly ONE racer must win the contested Item Box');
      assert(
        resA.itemBoxes[0].pickedUpByRacerId !== null,
        'Item Box must record winning racer uid'
      );
      assert(
        resA.itemBoxes[0].pickedUpByRacerId === resB.itemBoxes[0].pickedUpByRacerId,
        'Deterministic tie-break winner must not depend on object key order'
      );

      // Sub-check: Earlier crossing time beats closer center offset
      const racersCrossingTest: Record<string, AuthoritativeRacerState> = {
        uid_alpha: {
          ...base.racers.uid_alpha,
          distanceM: targetBox.distanceM + 0.8,
          laneOffset: targetBox.laneOffset + 0.08, // Slightly off-center, but crossed earlier
          heldItem: null,
        },
        uid_bravo: {
          ...base.racers.uid_bravo,
          distanceM: targetBox.distanceM - 1.9,
          laneOffset: targetBox.laneOffset, // Dead center, but crossed later
          heldItem: null,
        },
      };
      const crossingRes = resolveSimultaneousItemPickup({
        racers: racersCrossingTest,
        prevDistancesByUid: {
          uid_alpha: targetBox.distanceM - 1.8,
          uid_bravo: targetBox.distanceM - 2.6,
        },
        itemBoxes: base.itemBoxes.map((b) => ({ ...b })),
        trackSeed: base.trackSeed,
        serverTick: 43,
        nextEntitySerial: 1,
        events: [],
      });
      assert(
        crossingRes.itemBoxes[0].pickedUpByRacerId === 'uid_alpha',
        'Racer with earlier box-entry crossing fraction must win the box'
      );

      // Sub-check: Full inventory racer never overwrites held item or consumes box
      const racersFullSlotTest: Record<string, AuthoritativeRacerState> = {
        uid_alpha: {
          ...base.racers.uid_alpha,
          distanceM: targetBox.distanceM + 0.5,
          laneOffset: targetBox.laneOffset,
          heldItem: 'ice_shield',
        },
        uid_bravo: {
          ...base.racers.uid_bravo,
          distanceM: targetBox.distanceM + 0.1,
          laneOffset: targetBox.laneOffset,
          heldItem: null,
        },
      };
      const fullSlotRes = resolveSimultaneousItemPickup({
        racers: racersFullSlotTest,
        prevDistancesByUid: prevDists,
        itemBoxes: base.itemBoxes.map((b) => ({ ...b })),
        trackSeed: base.trackSeed,
        serverTick: 44,
        nextEntitySerial: 1,
        events: [],
      });
      assert(
        fullSlotRes.racers.uid_alpha.heldItem === 'ice_shield' &&
          fullSlotRes.itemBoxes[0].pickedUpByRacerId === 'uid_bravo' &&
          fullSlotRes.racers.uid_bravo.heldItem !== null,
        'Full-slot racer must keep existing item while trailing empty-slot racer gets box'
      );
    }
  );

  // 6. Item Pickup သည် Auto-use မဖြစ်ဘဲ Held Slot ထဲသို့ ဝင်ခြင်း
  registerTest(
    6,
    'Item Pickup သည် Auto-use မဖြစ်ဘဲ Held Slot ထဲသို့ ဝင်ခြင်း',
    () => {
      let state = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 314159,
          initialPhase: 'countdown',
        })
      );
      const box = state.itemBoxes[0];
      state = {
        ...state,
        racers: {
          ...state.racers,
          uid_alpha: {
            ...state.racers.uid_alpha,
            distanceM: box.distanceM - 0.6,
            laneOffset: box.laneOffset,
            speedMps: 20,
          },
        },
      };

      state = stepMultiplayerSnowRushTick(state, {
        uid_alpha: { steer: 0, jumpPressed: false, useItemPressed: false, seq: 1 },
      });

      const pickedItem = state.racers.uid_alpha.heldItem;
      assert(pickedItem !== null, 'Item must enter heldItem slot upon crossing box');
      assert(state.racers.uid_alpha.itemsUsedCount === 0, 'Item must NOT auto-activate on pickup');

      // Step 30 more ticks (1.5s > 0.4s arming delay) without pressing useItemPressed
      for (let i = 2; i <= 31; i += 1) {
        state = stepMultiplayerSnowRushTick(state, {
          uid_alpha: { steer: 0, jumpPressed: false, useItemPressed: false, seq: i },
        });
      }
      assert(
        state.racers.uid_alpha.heldItem === pickedItem &&
          state.racers.uid_alpha.itemsUsedCount === 0,
        'Held item must remain stored in slot until player manually activates it'
      );
    }
  );

  // 7. 0.4s Arming Delay အတွင်း Item မပစ်ထွက်ခြင်း
  registerTest(
    7,
    '0.4s Arming Delay အတွင်း Item မပစ်ထွက်ခြင်း',
    () => {
      let state = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 271828,
          initialPhase: 'countdown',
        })
      );
      state = {
        ...state,
        racers: {
          ...state.racers,
          uid_alpha: {
            ...state.racers.uid_alpha,
            heldItem: 'snowball_attack',
            itemArmingTimerSec: ITEM_ARMING_DELAY_SEC, // 0.4s
          },
        },
      };

      // First 7 ticks = 0.35s (< 0.40s): pressing useItemPressed must NOT fire
      for (let tick = 1; tick <= 7; tick += 1) {
        state = stepMultiplayerSnowRushTick(state, {
          uid_alpha: { steer: 0, jumpPressed: false, useItemPressed: true, seq: tick },
        });
        assert(
          state.racers.uid_alpha.heldItem === 'snowball_attack' &&
            state.projectiles.length === 0,
          `Item must not fire while arming timer > 0 (tick ${tick})`
        );
      }

      // Tick 8 finishes the 0.40s arming countdown; Tick 9 manual press fires immediately!
      state = stepMultiplayerSnowRushTick(state, {
        uid_alpha: { steer: 0, jumpPressed: false, useItemPressed: false, seq: 8 },
      });
      assertApprox(state.racers.uid_alpha.itemArmingTimerSec, 0, 1e-6, 'Arming delay reaches 0 at 0.4s');

      state = stepMultiplayerSnowRushTick(state, {
        uid_alpha: { steer: 0, jumpPressed: false, useItemPressed: true, seq: 9 },
      });
      assert(
        state.racers.uid_alpha.heldItem === null && state.projectiles.length === 1,
        'Armed item must fire cleanly once 0.4s arming delay has elapsed'
      );
    }
  );

  // 8. Manual Use လုပ်မှ Item အသက်ဝင်ပြီး Slot Empty ဖြစ်ခြင်း
  registerTest(
    8,
    'Manual Use လုပ်မှ Item အသက်ဝင်ပြီး Slot Empty ဖြစ်ခြင်း',
    () => {
      const base = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 161803,
          initialPhase: 'countdown',
        })
      );

      // A. Nitro Boost
      let nitroState: MultiplayerRaceState = {
        ...base,
        racers: {
          ...base.racers,
          uid_alpha: {
            ...base.racers.uid_alpha,
            distanceM: 50,
            speedMps: 20,
            heldItem: 'nitro_boost',
            itemArmingTimerSec: 0,
          },
        },
      };
      nitroState = stepMultiplayerSnowRushTick(nitroState, {
        uid_alpha: { steer: 0, jumpPressed: false, useItemPressed: true, seq: 1 },
      });
      assert(
        nitroState.racers.uid_alpha.heldItem === null &&
          nitroState.racers.uid_alpha.nitroTimerSec > 2.0 &&
          nitroState.racers.uid_alpha.speedMps <= NITRO_MAX_SPEED_CAP_MPS,
        'Nitro Boost activates, caps <= 30 m/s, and empties slot'
      );

      // B. Snowball Attack
      let snowState: MultiplayerRaceState = {
        ...base,
        racers: {
          ...base.racers,
          uid_alpha: {
            ...base.racers.uid_alpha,
            distanceM: 50,
            heldItem: 'snowball_attack',
            itemArmingTimerSec: 0,
          },
        },
      };
      snowState = stepMultiplayerSnowRushTick(snowState, {
        uid_alpha: { steer: 0, jumpPressed: false, useItemPressed: true, seq: 1 },
      });
      assert(
        snowState.racers.uid_alpha.heldItem === null && snowState.projectiles.length === 1,
        'Snowball Attack spawns projectile and empties slot'
      );

      // C. Snow Trap
      let trapState: MultiplayerRaceState = {
        ...base,
        racers: {
          ...base.racers,
          uid_alpha: {
            ...base.racers.uid_alpha,
            distanceM: 50,
            heldItem: 'snow_trap',
            itemArmingTimerSec: 0,
          },
        },
      };
      trapState = stepMultiplayerSnowRushTick(trapState, {
        uid_alpha: { steer: 0, jumpPressed: false, useItemPressed: true, seq: 1 },
      });
      assert(
        trapState.racers.uid_alpha.heldItem === null && trapState.traps.length === 1,
        'Snow Trap places trap behind racer and empties slot'
      );

      // D. Ice Shield + Empty Slot safe press
      let shieldState: MultiplayerRaceState = {
        ...base,
        racers: {
          ...base.racers,
          uid_alpha: {
            ...base.racers.uid_alpha,
            distanceM: 50,
            heldItem: 'ice_shield',
            itemArmingTimerSec: 0,
          },
        },
      };
      shieldState = stepMultiplayerSnowRushTick(shieldState, {
        uid_alpha: { steer: 0, jumpPressed: false, useItemPressed: true, seq: 1 },
      });
      assert(
        shieldState.racers.uid_alpha.heldItem === null &&
          shieldState.racers.uid_alpha.shieldTimerSec > 4.8,
        'Ice Shield activates 5.0s barrier and empties slot'
      );

      shieldState = stepMultiplayerSnowRushTick(shieldState, {
        uid_alpha: { steer: 0, jumpPressed: false, useItemPressed: true, seq: 2 },
      });
      assert(
        shieldState.events.some((e) => e.type === 'item_empty' && e.uid === 'uid_alpha'),
        'Pressing useItem on empty slot emits clean item_empty event without error'
      );
    }
  );

  // 9. Snowball သည် Owner ကို မထိဘဲ Nearest Valid Target 1 ဦးသာ ထိပြီး Despawn ဖြစ်ခြင်း
  registerTest(
    9,
    'Snowball သည် Owner ကို မထိဘဲ Nearest Valid Target 1 ဦးသာ ထိပြီး Despawn ဖြစ်ခြင်း',
    () => {
      const base = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_3,
          trackSeed: 404040,
          initialPhase: 'countdown',
        })
      );

      const events: MultiplayerRaceEvent[] = [];
      const racers: Record<string, AuthoritativeRacerState> = {
        uid_alpha: {
          ...base.racers.uid_alpha,
          distanceM: 100,
          laneOffset: 0,
          speedMps: 20,
        },
        uid_bravo: {
          ...base.racers.uid_bravo,
          distanceM: 101.2, // Nearest target directly ahead
          laneOffset: 0,
          speedMps: 20,
        },
        uid_charlie: {
          ...base.racers.uid_charlie,
          distanceM: 101.6, // Further target in same lane — must NOT also get hit by single-hit snowball
          laneOffset: 0,
          speedMps: 20,
        },
      };

      const res = resolveMultiplayerCollisions({
        racers,
        prevDistancesByUid: { uid_alpha: 100, uid_bravo: 101.2, uid_charlie: 101.6 },
        projectiles: [
          {
            id: 'proj_1',
            ownerId: 'uid_alpha',
            distanceM: 100.2,
            startDistanceM: 100.2,
            maxRangeM: 180,
            laneOffset: 0,
            speedMps: 34,
            active: true,
          },
        ],
        traps: [],
        subDtSec: 0.05,
        trackSeed: base.trackSeed,
        serverTick: 10,
        events,
      });

      assert(res.racers.uid_alpha.attacksTakenCount === 0, 'Owner must never be hit by own Snowball');
      assert(res.racers.uid_bravo.attacksTakenCount === 1, 'Nearest aligned target must be hit');
      assertApprox(
        res.racers.uid_bravo.mercyInvulnTimerSec,
        MERCY_INVULN_DURATION_SEC,
        1e-6,
        'Hit target receives 2.0s Mercy Invulnerability'
      );
      assert(
        res.racers.uid_charlie.attacksTakenCount === 0,
        'Second target behind nearest target must NOT be hit'
      );
      assert(res.projectiles.length === 0, 'Snowball must despawn immediately upon single hit');

      // Follow-up Snowball during 2.0s Mercy Invulnerability must ignore uid_bravo (no stun-lock!)
      const followUp = resolveMultiplayerCollisions({
        racers: res.racers,
        prevDistancesByUid: { uid_alpha: 100, uid_bravo: 101.2, uid_charlie: 105 },
        projectiles: [
          {
            id: 'proj_2',
            ownerId: 'uid_alpha',
            distanceM: 101.0,
            startDistanceM: 101.0,
            maxRangeM: 180,
            laneOffset: 0,
            speedMps: 34,
            active: true,
          },
        ],
        traps: [],
        subDtSec: 0.01,
        trackSeed: base.trackSeed,
        serverTick: 11,
        events: [],
      });
      assert(
        followUp.racers.uid_bravo.attacksTakenCount === 1,
        '2.0s Mercy Invulnerability must prevent Snowball stun-lock'
      );
    }
  );

  // 10. Trap သည် Placer ကို ချက်ချင်းမထိဘဲ နောက်လိုက်လာသူကိုသာ ထိခြင်း
  registerTest(
    10,
    'Trap သည် Placer ကို ချက်ချင်းမထိဘဲ နောက်လိုက်လာသူကိုသာ ထိခြင်း',
    () => {
      let state = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 505050,
          initialPhase: 'countdown',
        })
      );

      state = {
        ...state,
        racers: {
          uid_alpha: {
            ...state.racers.uid_alpha,
            distanceM: 120,
            laneOffset: 0,
            speedMps: 20,
            heldItem: 'snow_trap',
            itemArmingTimerSec: 0,
          },
          uid_bravo: {
            ...state.racers.uid_bravo,
            distanceM: 116.8,
            laneOffset: 0,
            speedMps: 20.5,
          },
        },
      };

      // Tick 1: uid_alpha drops trap at ~117.4m; uid_alpha does NOT self-hit, trailing uid_bravo hits it!
      state = stepMultiplayerSnowRushTick(state, {
        uid_alpha: { steer: 0, jumpPressed: false, useItemPressed: true, seq: 1 },
        uid_bravo: { steer: 0, jumpPressed: false, useItemPressed: false, seq: 1 },
      });

      assert(
        state.racers.uid_alpha.attacksTakenCount === 0 &&
          state.racers.uid_alpha.spinTimerSec === 0,
        'Trap placer must NEVER immediately hit their own trap'
      );
      assert(
        state.racers.uid_bravo.attacksTakenCount === 1 &&
          state.racers.uid_bravo.spinTimerSec > 0 &&
          state.traps.length === 0,
        'Trailing chaser must trigger trap slip/spin and remove trap'
      );
    }
  );

  // 11. Ice Shield သည် Attack / Trap / Solid Obstacle 1 ချက်ကာပြီး ပျက်ခြင်း၊ သို့သော် Avalanche ကို မကာနိုင်ခြင်း
  registerTest(
    11,
    'Ice Shield သည် Attack / Trap / Solid Obstacle 1 ချက်ကာပြီး ပျက်ခြင်း၊ သို့သော် Avalanche ကို မကာနိုင်ခြင်း',
    () => {
      const base = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 606060,
          initialPhase: 'countdown',
        })
      );

      // 11A. Blocks 1 Snowball
      const snowBlockEvents: MultiplayerRaceEvent[] = [];
      const snowBlock = resolveMultiplayerCollisions({
        racers: {
          uid_alpha: { ...base.racers.uid_alpha, distanceM: 90, laneOffset: 0 },
          uid_bravo: {
            ...base.racers.uid_bravo,
            distanceM: 92,
            laneOffset: 0,
            speedMps: 20,
            shieldTimerSec: 4.5,
          },
        },
        prevDistancesByUid: { uid_alpha: 90, uid_bravo: 92 },
        projectiles: [
          {
            id: 'p_shield',
            ownerId: 'uid_alpha',
            distanceM: 91.5,
            startDistanceM: 91.5,
            maxRangeM: 180,
            laneOffset: 0,
            speedMps: 34,
            active: true,
          },
        ],
        traps: [],
        subDtSec: 0.05,
        trackSeed: base.trackSeed,
        serverTick: 5,
        events: snowBlockEvents,
      });
      assert(
        snowBlock.racers.uid_bravo.shieldTimerSec === 0 &&
          snowBlock.racers.uid_bravo.shieldBlocksCount === 1 &&
          snowBlock.racers.uid_bravo.attackSlowTimerSec === 0,
        'Ice Shield must block 1 Snowball with 0 slow and break immediately'
      );

      // 11B. Blocks 1 Snow Trap
      const trapBlock = resolveMultiplayerCollisions({
        racers: {
          uid_alpha: { ...base.racers.uid_alpha, distanceM: 110, laneOffset: 0 },
          uid_bravo: {
            ...base.racers.uid_bravo,
            distanceM: 95.2,
            laneOffset: 0,
            speedMps: 20,
            shieldTimerSec: 4.5,
          },
        },
        prevDistancesByUid: { uid_alpha: 110, uid_bravo: 94.0 },
        projectiles: [],
        traps: [
          {
            id: 't_shield',
            ownerId: 'uid_alpha',
            distanceM: 95.0,
            laneOffset: 0,
            halfLengthM: 1.15,
            halfWidthLane: 0.115,
            remainingSec: 15,
            ageSec: 5,
            active: true,
          },
        ],
        subDtSec: 0.05,
        trackSeed: base.trackSeed,
        serverTick: 6,
        events: [],
      });
      assert(
        trapBlock.racers.uid_bravo.shieldTimerSec === 0 &&
          trapBlock.racers.uid_bravo.shieldBlocksCount === 1 &&
          trapBlock.racers.uid_bravo.spinTimerSec === 0,
        'Ice Shield must block 1 Snow Trap with 0 spin/slow and break immediately'
      );

      // 11C. Blocks 1 Solid Obstacle (find first pine_tree/rock/snow_mound)
      const solidObs = base.track.obstacles.find(
        (o) => o.kind === 'pine_tree' || o.kind === 'rock' || o.kind === 'snow_mound'
      );
      assert(solidObs !== undefined, 'Track must contain a solid obstacle');
      if (solidObs) {
        let obsState: MultiplayerRaceState = {
          ...base,
          racers: {
            ...base.racers,
            uid_alpha: {
              ...base.racers.uid_alpha,
              distanceM: solidObs.distanceM - 0.8,
              laneOffset: solidObs.laneOffset,
              speedMps: 20,
              shieldTimerSec: 4.5,
            },
          },
        };
        obsState = stepMultiplayerSnowRushTick(obsState, {}, 0.05);
        assert(
          obsState.racers.uid_alpha.shieldTimerSec === 0 &&
            obsState.racers.uid_alpha.shieldBlocksCount === 1 &&
            obsState.racers.uid_alpha.obstacleHitCount === 0 &&
            obsState.racers.uid_alpha.penaltyTimerSec === 0,
          'Ice Shield must absorb 1 solid obstacle crash and shatter'
        );
      }

      // 11D. Does NOT block Avalanche!
      let avState: MultiplayerRaceState = {
        ...base,
        elapsedRaceMs: 6000, // Past 4.0s grace period
        avalanche: {
          ...base.avalanche,
          distanceM: 80.5,
          speedMps: 18.0,
          graceRemainingSec: 0,
          isActive: true,
        },
        racers: {
          ...base.racers,
          uid_alpha: {
            ...base.racers.uid_alpha,
            distanceM: 80.0,
            speedMps: 12,
            shieldTimerSec: 5.0, // Active shield!
          },
          uid_bravo: {
            ...base.racers.uid_bravo,
            distanceM: 220,
            speedMps: 20,
          },
        },
      };
      avState = stepMultiplayerSnowRushTick(avState, {}, 0.05);
      assert(
        avState.racers.uid_alpha.tumbleTimerSec > 0 &&
          avState.racers.uid_alpha.tumbleCount === 1 &&
          avState.racers.uid_alpha.shieldTimerSec === 0,
        'Ice Shield must NEVER block the Avalanche'
      );
    }
  );

  // 12. Avalanche ဖမ်းမိချိန် Snow Tumble နှင့် Safe Recovery အလုပ်လုပ်ခြင်း + 1,500 m မကျော်ဘဲ false finish မဖြစ်ခြင်း
  registerTest(
    12,
    'Avalanche ဖမ်းမိချိန် Snow Tumble နှင့် Safe Recovery အလုပ်လုပ်ခြင်း + 1,500 m မကျော်ဘဲ false finish မဖြစ်ခြင်း',
    () => {
      let state = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 717171,
          initialPhase: 'countdown',
        })
      );

      // Force Avalanche catch near end of course (COURSE_LENGTH_M - 20 = 1,480m) so +25m recovery would exceed 1,500m if unclamped
      state = {
        ...state,
        elapsedRaceMs: 74000,
        avalanche: {
          ...state.avalanche,
          distanceM: COURSE_LENGTH_M - 19,
          speedMps: 18.5,
          graceRemainingSec: 0,
          isActive: true,
        },
        racers: {
          uid_alpha: {
            ...state.racers.uid_alpha,
            distanceM: COURSE_LENGTH_M - 20,
            speedMps: 12,
          },
          uid_bravo: {
            ...state.racers.uid_bravo,
            distanceM: COURSE_LENGTH_M - 10,
            speedMps: 20,
          },
        },
      };

      // Catch triggers 1.3s Snow Tumble
      state = stepMultiplayerSnowRushTick(state, {}, 0.05);
      assert(
        state.racers.uid_alpha.tumbleTimerSec > 0 && state.racers.uid_alpha.tumbleCount === 1,
        'Racer enters Snow Tumble when caught by Avalanche'
      );

      // Advance until the exact tick where uid_alpha completes the 1.3s Snow Tumble recovery
      let sawRecoveryEvent = false;
      for (let i = 0; i < 35; i += 1) {
        state = stepMultiplayerSnowRushTick(state, {}, 0.05);
        const recEv = state.events.find(
          (e) => e.type === 'racer_recovery' && e.uid === 'uid_alpha'
        );
        if (recEv && recEv.type === 'racer_recovery') {
          sawRecoveryEvent = true;
          assert(
            recEv.distanceM <= SNOW_TUMBLE_MAX_RECOVERY_M && recEv.distanceM < COURSE_LENGTH_M,
            `Recovery event distance must be clamped <= ${SNOW_TUMBLE_MAX_RECOVERY_M}m (got ${recEv.distanceM}m)`
          );
          break;
        }
      }

      const recovered = state.racers.uid_alpha;
      assert(sawRecoveryEvent && recovered.tumbleTimerSec === 0, 'Tumble timer completes after 1.3s');
      assert(
        recovered.distanceM < COURSE_LENGTH_M && recovered.finishTimeMs === null,
        `Snow Tumble recovery must NEVER false-finish >= ${COURSE_LENGTH_M}m (got ${recovered.distanceM}m)`
      );
      assert(recovered.invulnerableTimerSec > 0, 'Recovered racer receives post-tumble invulnerability');

      // Also verify mid-course +25m ahead-of-avalanche lead
      let midState = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 717171,
          initialPhase: 'countdown',
        })
      );
      midState = {
        ...midState,
        elapsedRaceMs: 12000,
        avalanche: {
          ...midState.avalanche,
          distanceM: 200,
          speedMps: 17.5,
          graceRemainingSec: 0,
          isActive: true,
        },
        racers: {
          uid_alpha: {
            ...midState.racers.uid_alpha,
            distanceM: 199,
            speedMps: 12,
            tumbleTimerSec: SNOW_TUMBLE_DURATION_SEC,
            tumbleCount: 1,
          },
          uid_bravo: {
            ...midState.racers.uid_bravo,
            distanceM: 320,
            speedMps: 20,
          },
        },
      };
      for (let i = 0; i < 30; i += 1) {
        midState = stepMultiplayerSnowRushTick(midState, {}, 0.05);
        if (midState.events.some((e) => e.type === 'racer_recovery' && e.uid === 'uid_alpha')) {
          break;
        }
      }
      assert(
        midState.racers.uid_alpha.distanceM >=
          midState.avalanche.distanceM + SNOW_TUMBLE_RECOVERY_AHEAD_M - 0.5,
        'Mid-course recovery places racer >= 25m ahead of Avalanche'
      );
    }
  );

  // 13. Finished Player သည် Avalanche / Snowball / Trap / Obstacle ကြောင့် ပြန်မထိခိုက်ခြင်း
  registerTest(
    13,
    'Finished Player သည် Avalanche / Snowball / Trap / Obstacle ကြောင့် ပြန်မထိခိုက်ခြင်း',
    () => {
      let state = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 818181,
          initialPhase: 'countdown',
        })
      );

      state = {
        ...state,
        elapsedRaceMs: 72000,
        racers: {
          uid_alpha: {
            ...state.racers.uid_alpha,
            distanceM: COURSE_LENGTH_M - 0.5,
            laneOffset: 0,
            speedMps: 22,
          },
          uid_bravo: {
            ...state.racers.uid_bravo,
            distanceM: COURSE_LENGTH_M - 50,
            laneOffset: 0,
            speedMps: 18,
            heldItem: 'snowball_attack',
            itemArmingTimerSec: 0,
          },
        },
      };

      // Step 1: uid_alpha crosses 1,500m and becomes a Finished Player
      state = stepMultiplayerSnowRushTick(state, {}, 0.05);
      const lockedFinishMs = state.racers.uid_alpha.finishTimeMs;
      assert(lockedFinishMs !== null && state.racers.uid_alpha.finishRank === 1, 'uid_alpha finished 1st');

      // Step 2: Expose finished uid_alpha directly to an overlapping Trap, incoming Snowball, and max-speed Avalanche
      state = {
        ...state,
        traps: [
          {
            id: 'trap_on_finished_player',
            ownerId: 'uid_bravo',
            distanceM: COURSE_LENGTH_M,
            laneOffset: 0,
            halfLengthM: 1.5,
            halfWidthLane: 0.3,
            remainingSec: 15,
            ageSec: 5,
            active: true,
          },
        ],
        avalanche: {
          ...state.avalanche,
          distanceM: COURSE_LENGTH_M - 15,
          speedMps: 19.2,
          graceRemainingSec: 0,
          isActive: true,
        },
      };

      state = stepMultiplayerSnowRushTick(state, {
        uid_bravo: { steer: 0, jumpPressed: false, useItemPressed: true, seq: 1 },
      });

      for (let t = 2; t <= 40; t += 1) {
        state = stepMultiplayerSnowRushTick(state, {}, 0.05);
      }

      const finishedAlpha = state.racers.uid_alpha;
      assert(
        finishedAlpha.finishTimeMs === lockedFinishMs &&
          finishedAlpha.finishRank === 1 &&
          finishedAlpha.tumbleCount === 0 &&
          finishedAlpha.attacksTakenCount === 0 &&
          finishedAlpha.obstacleHitCount === 0 &&
          finishedAlpha.distanceM === COURSE_LENGTH_M,
        'Finished racer must be 100% immune to Snowballs, Traps, Obstacles, and Avalanche'
      );
    }
  );

  // 14. First Finisher ပြီးနောက် 15.0s Post-Winner Finish Window စတင်ခြင်း
  registerTest(
    14,
    'First Finisher ပြီးနောက် 15.0s Post-Winner Finish Window စတင်ခြင်း',
    () => {
      let state = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_3,
          trackSeed: 919191,
          initialPhase: 'countdown',
        })
      );

      state = {
        ...state,
        elapsedRaceMs: 68000,
        racers: {
          uid_alpha: { ...state.racers.uid_alpha, distanceM: COURSE_LENGTH_M - 0.4, speedMps: 20 },
          uid_bravo: { ...state.racers.uid_bravo, distanceM: 1100, speedMps: 18 },
          uid_charlie: { ...state.racers.uid_charlie, distanceM: 1020, speedMps: 18 },
        },
      };

      state = stepMultiplayerSnowRushTick(state, {}, 0.05);
      assert(state.phase === 'finish_window', 'Phase must enter finish_window upon 1st finisher');
      assert(state.finishState.winnerId === 'uid_alpha', 'winnerId locks to 1st finisher');
      assert(
        state.finishState.postWinnerRemainingSec !== null &&
          state.finishState.postWinnerRemainingSec <= POST_WINNER_FINISH_WINDOW_SEC &&
          state.finishState.postWinnerRemainingSec > 14.9,
        'Post-winner finish window starts at ~15.0s'
      );

      const prevBravoDist = state.racers.uid_bravo.distanceM;
      state = stepMultiplayerSnowRushTick(state, {}, 0.05);
      assert(
        state.racers.uid_bravo.distanceM > prevBravoDist,
        'Unfinished racers continue racing actively during 15.0s finish window'
      );
    }
  );

  // 15. ကျန်ကစားသမားများ မပြီးသေးသော်လည်း Timeout ပြည့်ချိန် Race Finalize ဖြစ်ခြင်း
  registerTest(
    15,
    'ကျန်ကစားသမားများ မပြီးသေးသော်လည်း Timeout ပြည့်ချိန် Race Finalize ဖြစ်ခြင်း',
    () => {
      let state = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_3,
          trackSeed: 929292,
          initialPhase: 'countdown',
        })
      );

      state = {
        ...state,
        elapsedRaceMs: 69000,
        racers: {
          uid_alpha: { ...state.racers.uid_alpha, distanceM: COURSE_LENGTH_M - 0.3, speedMps: 20 },
          uid_bravo: { ...state.racers.uid_bravo, distanceM: 450, speedMps: 14 },
          uid_charlie: { ...state.racers.uid_charlie, distanceM: 220, speedMps: 14 },
        },
      };

      // Step 320 ticks (16.0 seconds > 15.0s window); bravo & charlie are too far back to reach 1,500m
      for (let i = 0; i < 320; i += 1) {
        state = stepMultiplayerSnowRushTick(state, {}, 0.05);
        if (state.phase === 'finished') break;
      }

      assert(state.phase === 'finished', 'Race must finalize when 15.0s window expires');
      assert(
        state.finishState.finalized && state.finishState.finishReason === 'post_winner_timeout',
        'Finish reason must be post_winner_timeout'
      );
      assert(state.finishState.winnerId === 'uid_alpha', '1st finisher remains winner');
      assert(
        state.finishState.standings[0].uid === 'uid_alpha' &&
          state.finishState.standings[0].finished === true,
        'Rank 1 finished'
      );
      assert(
        state.finishState.standings[1].finished === false &&
          state.finishState.standings[2].finished === false &&
          state.finishState.standings[1].distanceM >= state.finishState.standings[2].distanceM,
        'Unfinished racers ranked cleanly by distanceM descending'
      );
    }
  );

  // 16. Host သည် Starting Grid သို့မဟုတ် Simulation တွင် မတရား အသာစီးမရခြင်း
  registerTest(
    16,
    'Host သည် Starting Grid သို့မဟုတ် Simulation တွင် မတရား အသာစီးမရခြင်း',
    () => {
      const hostFirst: MultiplayerPlayerInit[] = [
        { uid: 'host_room_creator', displayName: 'Host' },
        { uid: 'guest_player_two', displayName: 'Guest' },
      ];
      const guestFirst: MultiplayerPlayerInit[] = [hostFirst[1], hostFirst[0]];

      let hostLeftLaneCount = 0;
      const totalSeeds = 200;

      for (let s = 1; s <= totalSeeds; s += 1) {
        const seed = 100000 + s * 7919;
        const gridA = createStartingGrid(hostFirst, seed);
        const gridB = createStartingGrid(guestFirst, seed);

        assert(
          JSON.stringify(gridA) === JSON.stringify(gridB),
          'Join / lobby array order must NEVER give Host or Slot 0 a different starting lane'
        );

        const hostSlot = gridA.find((g) => g.uid === 'host_room_creator');
        if (hostSlot && hostSlot.laneOffset < 0) {
          hostLeftLaneCount += 1;
        }
      }

      // With unbiased hashing over 200 seeds, left-lane ratio should be near 50% (well inside [35%, 65%])
      assert(
        hostLeftLaneCount >= 70 && hostLeftLaneCount <= 130,
        `Host starting lane distribution must be unbiased across seeds (got ${hostLeftLaneCount}/${totalSeeds})`
      );
    }
  );

  // 17. First Finisher Winner သည် နောက်ပိုင်း Tick များကြောင့် မပြောင်းလဲခြင်း
  registerTest(
    17,
    'First Finisher Winner သည် နောက်ပိုင်း Tick များကြောင့် မပြောင်းလဲခြင်း',
    () => {
      let state = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 424242,
          initialPhase: 'countdown',
        })
      );

      state = {
        ...state,
        elapsedRaceMs: 70000,
        racers: {
          uid_alpha: { ...state.racers.uid_alpha, distanceM: COURSE_LENGTH_M - 0.2, speedMps: 19 },
          uid_bravo: {
            ...state.racers.uid_bravo,
            distanceM: COURSE_LENGTH_M - 15,
            speedMps: 29.5,
            nitroTimerSec: 2.0,
          },
        },
      };

      // uid_alpha finishes first
      state = stepMultiplayerSnowRushTick(state, {}, 0.05);
      const firstWinner = state.finishState.winnerId;
      const firstTime = state.finishState.winnerFinishTimeMs;
      assert(firstWinner === 'uid_alpha' && firstTime !== null, 'uid_alpha locks winnerId');

      // Step 80 more ticks: uid_bravo finishes at higher speed, then post-finish ticks continue
      for (let i = 0; i < 80; i += 1) {
        state = stepMultiplayerSnowRushTick(state, {}, 0.05);
      }

      assert(
        state.finishState.winnerId === 'uid_alpha' &&
          state.finishState.winnerFinishTimeMs === firstTime &&
          state.finishState.standings[0].uid === 'uid_alpha' &&
          state.finishState.standings[1].uid === 'uid_bravo',
        'First finisher winnerId and Rank 1 standing must NEVER be overwritten by later finishers or ticks'
      );
    }
  );

  // 18. All Racers ပြီးဆုံးချိန် Timeout မစောင့်ဘဲ ချက်ချင်း Finalize ဖြစ်ခြင်း
  registerTest(
    18,
    'All Racers ပြီးဆုံးချိန် Timeout မစောင့်ဘဲ ချက်ချင်း Finalize ဖြစ်ခြင်း',
    () => {
      let state = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_3,
          trackSeed: 515151,
          initialPhase: 'countdown',
        })
      );

      state = {
        ...state,
        elapsedRaceMs: 71000,
        racers: {
          uid_alpha: { ...state.racers.uid_alpha, distanceM: COURSE_LENGTH_M - 0.5, speedMps: 20 },
          uid_bravo: { ...state.racers.uid_bravo, distanceM: COURSE_LENGTH_M - 5.0, speedMps: 20 },
          uid_charlie: { ...state.racers.uid_charlie, distanceM: COURSE_LENGTH_M - 10.0, speedMps: 20 },
        },
      };

      // Within ~15 ticks (0.75s << 15.0s), all 3 racers cross 1,500m
      let ticksElapsed = 0;
      for (let i = 0; i < 30; i += 1) {
        state = stepMultiplayerSnowRushTick(state, {}, 0.05);
        ticksElapsed += 1;
        if (state.phase === 'finished') break;
      }

      assert(state.phase === 'finished', 'Race must finalize immediately once all racers finish');
      assert(ticksElapsed < 25, `Finalized in ${ticksElapsed} ticks (< 1.25s) without waiting 15s`);
      assert(
        state.finishState.finishReason === 'all_finished' &&
          state.finishState.postWinnerRemainingSec === 0,
        'Finish reason must be all_finished'
      );
    }
  );

  // 19. Disconnected / Idle Racer (Input မပို့သူ) ရှိသော်လည်း Race Loop မရပ်ဘဲ ပြီးဆုံးနိုင်ခြင်း
  registerTest(
    19,
    'Disconnected / Idle Racer (Input မပို့သူ) ရှိသော်လည်း Race Loop မရပ်ဘဲ ပြီးဆုံးနိုင်ခြင်း',
    () => {
      let state = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_3,
          trackSeed: 626262,
          initialPhase: 'countdown',
        })
      );

      // Mark uid_charlie disconnected and send zero inputs for uid_bravo & uid_charlie
      state = setMultiplayerRacerConnection(state, 'uid_charlie', false);

      let safetyTicks = 0;
      while (state.phase !== 'finished' && safetyTicks < 3400) {
        const alphaSteer: -1 | 0 | 1 = safetyTicks % 20 < 10 ? -1 : 1;
        state = stepMultiplayerSnowRushTick(
          state,
          {
            uid_alpha: {
              steer: alphaSteer,
              jumpPressed: safetyTicks % 35 === 0,
              useItemPressed: safetyTicks % 25 === 0,
              seq: safetyTicks + 1,
            },
          },
          0.05
        );
        safetyTicks += 1;
      }

      assert(state.phase === 'finished', 'Race with idle & disconnected racers must complete cleanly');
      assert(state.finishState.winnerId !== null, 'Winner must be determined');
      assert(state.finishState.standings.length === 3, 'All 3 racers included in final standings');
    }
  );

  // 20. Untrusted Client Fields (distanceM, speedMps, winnerId, etc.) ပို့လာသော်လည်း Engine က လျစ်လျူရှုခြင်း
  registerTest(
    20,
    'Untrusted Client Fields (distanceM, speedMps, winnerId, etc.) ပို့လာသော်လည်း Engine က လျစ်လျူရှုခြင်း',
    () => {
      const maliciousPayload: Record<string, unknown> = {
        steer: 0,
        jumpPressed: false,
        useItemPressed: false,
        seq: 1,
        distanceM: COURSE_LENGTH_M,
        speedMps: 999,
        laneOffset: 0,
        heldItem: 'nitro_boost',
        pickedBoxId: 'ibox_1_r0',
        hitTargetId: 'uid_bravo',
        winnerId: 'uid_alpha',
        finishTimeMs: 1,
      };

      const sanitized = sanitizeClientInputPayload(maliciousPayload);
      assert(sanitized !== null, 'Valid core input fields should parse');
      if (sanitized) {
        assert(
          Object.keys(sanitized).sort().join(',') === 'jumpPressed,seq,steer,useItemPressed',
          'Sanitized input frame must strip every untrusted property'
        );
      }

      let state = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 737373,
          initialPhase: 'countdown',
        })
      );

      state = stepMultiplayerSnowRushTick(state, {
        uid_alpha: maliciousPayload,
      });

      assert(
        state.racers.uid_alpha.distanceM < 2.0 &&
          state.racers.uid_alpha.speedMps < 25.0 &&
          state.racers.uid_alpha.heldItem === null &&
          state.finishState.winnerId === null &&
          state.phase === 'racing',
        'Engine must completely ignore client-claimed distanceM, speedMps, heldItem, and winnerId'
      );
    }
  );

  // 21. Browser / DOM / Canvas / Audio / Firebase Dependency မပါဘဲ Pure TypeScript Engine အလုပ်လုပ်ခြင်း
  registerTest(
    21,
    'Browser / DOM / Canvas / Audio / Firebase Dependency မပါဘဲ Pure TypeScript Engine အလုပ်လုပ်ခြင်း',
    () => {
      const runtimeGlobals = globalThis as Record<string, unknown>;
      assert(
        typeof runtimeGlobals.document === 'undefined' &&
          typeof runtimeGlobals.HTMLCanvasElement === 'undefined' &&
          typeof runtimeGlobals.AudioContext === 'undefined',
        'Test suite must execute in a headless non-DOM runtime without browser globals'
      );

      let state = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_4,
          trackSeed: 848484,
          initialPhase: 'countdown',
        })
      );
      state = stepMultiplayerSnowRushTick(state, {}, 0.05);
      const snap = buildMultiplayerSnapshot(state);
      assert(snap.serverTick === state.serverTick, 'Snapshot builds cleanly in pure TS runtime');
    }
  );

  // 22. Server Snapshot မှ Race State အပြည့်အစုံ ပြန်လည်တည်ဆောက်နိုင်ခြင်း
  registerTest(
    22,
    'Server Snapshot မှ Race State အပြည့်အစုံ ပြန်လည်တည်ဆောက်နိုင်ခြင်း',
    () => {
      let liveState = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_4,
          trackSeed: 959595,
          initialPhase: 'countdown',
        })
      );

      // Run 140 ticks with varied steering, jumps, and item activations so world has active entities
      for (let t = 1; t <= 140; t += 1) {
        liveState = stepMultiplayerSnowRushTick(liveState, {
          uid_alpha: { steer: t % 2 === 0 ? -1 : 1, jumpPressed: t % 30 === 0, useItemPressed: t % 18 === 0, seq: t },
          uid_bravo: { steer: 0, jumpPressed: t % 40 === 0, useItemPressed: t % 20 === 0, seq: t },
          uid_charlie: { steer: 1, jumpPressed: false, useItemPressed: t % 22 === 0, seq: t },
          uid_delta: { steer: -1, jumpPressed: t % 25 === 0, useItemPressed: t % 16 === 0, seq: t },
        });
      }

      const rawSnapshot = buildMultiplayerSnapshot(liveState);
      const snapshotJson = JSON.stringify(rawSnapshot);
      const parsedSnapshot = JSON.parse(snapshotJson) as typeof rawSnapshot;

      // Verify compact snapshot excludes visual bursts, trails, and static track obstacles
      const rawRecord = parsedSnapshot as unknown as Record<string, unknown>;
      assert(!('visualBursts' in rawRecord), 'Snapshot must NOT include visualBursts');
      assert(!('track' in rawRecord), 'Snapshot must NOT duplicate static track geometry');
      for (const uid of parsedSnapshot.racerOrder) {
        const rRec = parsedSnapshot.racers[uid] as unknown as Record<string, unknown>;
        assert(!('trail' in rRec), 'Snapshot racer must NOT include canvas trail samples');
      }

      let restoredState = restoreMultiplayerStateFromSnapshot(parsedSnapshot);

      // Step BOTH original and restored states 120 more ticks with identical inputs -> must stay identical!
      for (let t = 141; t <= 260; t += 1) {
        const frameInputs: Record<string, SnowRushInputFrame> = {
          uid_alpha: { steer: 0, jumpPressed: t % 28 === 0, useItemPressed: t % 19 === 0, seq: t },
          uid_bravo: { steer: t % 3 === 0 ? 1 : -1, jumpPressed: false, useItemPressed: t % 21 === 0, seq: t },
          uid_charlie: { steer: -1, jumpPressed: t % 33 === 0, useItemPressed: false, seq: t },
          uid_delta: { steer: 1, jumpPressed: false, useItemPressed: t % 17 === 0, seq: t },
        };
        liveState = stepMultiplayerSnowRushTick(liveState, frameInputs);
        restoredState = stepMultiplayerSnowRushTick(restoredState, frameInputs);
      }

      assert(
        JSON.stringify(buildMultiplayerSnapshot(liveState)) ===
          JSON.stringify(buildMultiplayerSnapshot(restoredState)),
        'Restored state from snapshot must simulate 100% identically to continuous live state'
      );
    }
  );

  // 23. Duplicate / Out-of-order seq Input Frame ကို ထပ်မံမလုပ်ဆောင်ဘဲ ငြင်းပယ်ခြင်း
  registerTest(
    23,
    'Duplicate / Out-of-order seq Input Frame ကို ထပ်မံမလုပ်ဆောင်ဘဲ ငြင်းပယ်ခြင်း',
    () => {
      let state = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 135791,
          initialPhase: 'countdown',
        })
      );

      state = {
        ...state,
        racers: {
          ...state.racers,
          uid_alpha: {
            ...state.racers.uid_alpha,
            heldItem: 'snowball_attack',
            itemArmingTimerSec: 0,
          },
        },
      };

      // seq: 5 activates item
      state = stepMultiplayerSnowRushTick(state, {
        uid_alpha: { steer: 1, jumpPressed: false, useItemPressed: true, seq: 5 },
      });
      assert(
        state.ackSeqByUid.uid_alpha === 5 &&
          state.racers.uid_alpha.itemsUsedCount === 1 &&
          state.racers.uid_alpha.heldItem === null,
        'Fresh seq=5 processed once'
      );

      // Give uid_alpha a second armed item, then replay duplicate seq=5 and stale seq=4
      state = {
        ...state,
        racers: {
          ...state.racers,
          uid_alpha: {
            ...state.racers.uid_alpha,
            heldItem: 'ice_shield',
            itemArmingTimerSec: 0,
          },
        },
      };

      state = stepMultiplayerSnowRushTick(state, {
        uid_alpha: { steer: -1, jumpPressed: true, useItemPressed: true, seq: 5 },
      });
      assert(
        state.racers.uid_alpha.heldItem === 'ice_shield' &&
          !state.racers.uid_alpha.isJumping &&
          state.events.some((e) => e.type === 'duplicate_input_ignored' && e.seq === 5),
        'Duplicate seq=5 must be ignored without firing second item or jumping'
      );

      state = stepMultiplayerSnowRushTick(state, {
        uid_alpha: { steer: -1, jumpPressed: true, useItemPressed: true, seq: 4 },
      });
      assert(
        state.racers.uid_alpha.heldItem === 'ice_shield' &&
          state.ackSeqByUid.uid_alpha === 5 &&
          state.events.some((e) => e.type === 'duplicate_input_ignored' && e.seq === 4),
        'Out-of-order stale seq=4 must be ignored'
      );

      // Fresh seq=6 succeeds!
      state = stepMultiplayerSnowRushTick(state, {
        uid_alpha: { steer: 0, jumpPressed: false, useItemPressed: true, seq: 6 },
      });
      assert(
        state.racers.uid_alpha.heldItem === null &&
          state.racers.uid_alpha.shieldTimerSec > 4.8 &&
          state.ackSeqByUid.uid_alpha === 6,
        'Fresh seq=6 activates item normally'
      );
    }
  );

  // 24. တူညီသော trackSeed နှင့် Input Sequence ပေးလျှင် တူညီသော Final Standings နှင့် Events အတိအကျ ထွက်ခြင်း
  registerTest(
    24,
    'တူညီသော trackSeed နှင့် Input Sequence ပေးလျှင် တူညီသော Final Standings နှင့် Events အတိအကျ ထွက်ခြင်း',
    () => {
      const runDeterministicFullRace = () => {
        let s = createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_4,
          trackSeed: 20260406,
          initialPhase: 'countdown',
        });
        const allEventTypes: string[] = [];
        let tick = 0;
        while (s.phase !== 'finished' && tick < 3400) {
          tick += 1;
          s = stepMultiplayerSnowRushTick(s, {
            uid_alpha: {
              steer: tick % 24 < 12 ? -1 : 1,
              jumpPressed: tick % 29 === 0,
              useItemPressed: tick % 17 === 0,
              seq: tick,
            },
            uid_bravo: {
              steer: tick % 18 < 9 ? 1 : 0,
              jumpPressed: tick % 31 === 0,
              useItemPressed: tick % 19 === 0,
              seq: tick,
            },
            uid_charlie: {
              steer: tick % 30 < 10 ? -1 : 0,
              jumpPressed: tick % 37 === 0,
              useItemPressed: tick % 23 === 0,
              seq: tick,
            },
            uid_delta: {
              steer: tick % 20 < 10 ? 1 : -1,
              jumpPressed: tick % 41 === 0,
              useItemPressed: tick % 21 === 0,
              seq: tick,
            },
          });
          for (const ev of s.events) {
            allEventTypes.push(`${s.serverTick}:${ev.type}`);
          }
        }
        return {
          finalSnapshot: buildMultiplayerSnapshot(s),
          standings: computeRaceStandings(s),
          allEventTypes,
        };
      };

      const run1 = runDeterministicFullRace();
      const run2 = runDeterministicFullRace();

      assert(run1.finalSnapshot.racePhase === 'finished', 'Full 4-player deterministic race completed');
      assert(
        JSON.stringify(run1.finalSnapshot) === JSON.stringify(run2.finalSnapshot),
        'Identical seed + inputs must produce identical final snapshot'
      );
      assert(
        JSON.stringify(run1.standings) === JSON.stringify(run2.standings),
        'Identical seed + inputs must produce identical final standings'
      );
      assert(
        JSON.stringify(run1.allEventTypes) === JSON.stringify(run2.allEventTypes),
        'Identical seed + inputs must emit identical event timelines'
      );
    }
  );

  // 25. လက်ရှိ Single-player stepSnowRushSimulation() မပျက်စီးဘဲ ဆက်လက်အလုပ်လုပ်ခြင်း
  registerTest(
    25,
    'လက်ရှိ Single-player stepSnowRushSimulation() မပျက်စီးဘဲ ဆက်လက်အလုပ်လုပ်ခြင်း',
    () => {
      let sp = createInitialSnowRushState({
        playerName: 'သင် (Local Test)',
        showOfflineBots: true,
        trackSeed: 20260404,
      });
      assert(sp.phase === 'ready' && sp.offlineDemoBots.length === 2, 'Local state initializes with 2 offline bots');

      sp = startCountdownState(sp, { trackSeed: 20260404 });
      assert(sp.phase === 'countdown', 'Local countdown starts');

      let safety = 0;
      while (sp.phase !== 'finished' && safety < 3400) {
        safety += 1;
        sp = stepSnowRushSimulation(
          sp,
          {
            steerLeft: safety % 22 < 8,
            steerRight: safety % 22 >= 14,
            jumpPressed: safety % 35 === 0,
            useItemPressed: safety % 20 === 0,
          },
          0.05
        );
      }

      const hud = buildHudSnapshot(sp);
      assert(
        sp.phase === 'finished' &&
          sp.player.distanceM === COURSE_LENGTH_M &&
          sp.player.finishTimeMs !== null &&
          hud.finishRank !== null &&
          hud.totalRacers === 3,
        'Single-player stepSnowRushSimulation() completes 1,500m race cleanly with HUD snapshot intact'
      );
    }
  );

  // 26. 1000m (1.00 KM) တွင် မပြီးဆုံးဘဲ 1500m (1.50 KM) အထိ ဆက်လက်ပြေးနိုင်ခြင်း
  registerTest(
    26,
    '1000m (1.00 KM) တွင် မပြီးဆုံးဘဲ 1500m (1.50 KM) အထိ ဆက်လက်ပြေးနိုင်ခြင်း',
    () => {
      assert(COURSE_LENGTH_M === 1500, 'COURSE_LENGTH_M must be centralized at 1500 meters');
      assert(COURSE_LENGTH_KM_TEXT === '1.50', 'COURSE_LENGTH_KM_TEXT must be 1.50');

      // Single-player check across 1,000m boundary
      let sp = startCountdownState(
        createInitialSnowRushState({
          playerName: 'သင်',
          showOfflineBots: false,
          trackSeed: 20261500,
        }),
        { trackSeed: 20261500 }
      );
      while (sp.phase === 'countdown') {
        sp = stepSnowRushSimulation(
          sp,
          { steerLeft: false, steerRight: false, jumpPressed: false, useItemPressed: false },
          0.05
        );
      }
      sp = {
        ...sp,
        elapsedRaceMs: 49000,
        player: {
          ...sp.player,
          distanceM: 999.2,
          speedMps: 20.6,
        },
      };
      sp = stepSnowRushSimulation(
        sp,
        { steerLeft: false, steerRight: false, jumpPressed: false, useItemPressed: false },
        0.05
      );
      const spHudAt1000 = buildHudSnapshot(sp);
      assert(sp.player.distanceM > 1000, 'Single-player crosses past 1000m');
      assert(
        sp.phase === 'racing' && sp.player.finishTimeMs === null,
        'Single-player MUST NOT finish at 1000m'
      );
      assertApprox(
        spHudAt1000.progressPercent,
        (sp.player.distanceM / 1500) * 100,
        0.05,
        'Single-player progressPercent at ~1000m is ~66.7% (NOT 100%)'
      );
      assert(spHudAt1000.progressPercent < 68, 'Progress at 1000m must be ~66.7%');

      // Multiplayer check across 1,000m boundary
      let mp = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 20261500,
          initialPhase: 'countdown',
        })
      );
      mp = {
        ...mp,
        elapsedRaceMs: 49000,
        racers: {
          uid_alpha: { ...mp.racers.uid_alpha, distanceM: 999.4, speedMps: 20.6 },
          uid_bravo: { ...mp.racers.uid_bravo, distanceM: 995.0, speedMps: 20.0 },
        },
      };
      mp = stepMultiplayerSnowRushTick(mp, {}, 0.05);
      assert(mp.racers.uid_alpha.distanceM > 1000, 'Multiplayer racer crosses past 1000m');
      assert(
        mp.phase === 'racing' &&
          mp.finishState.winnerId === null &&
          mp.racers.uid_alpha.finishTimeMs === null,
        'Multiplayer race MUST NOT finish or start finish_window at 1000m'
      );
    }
  );

  // 27. 1500m တွင်သာ Race Finish ဖြစ်ခြင်း နှင့် 0.00 -> 1.50 KM Progress Milestones မှန်ကန်ခြင်း
  registerTest(
    27,
    '1500m တွင်သာ Race Finish ဖြစ်ခြင်း နှင့် 0.00 -> 1.50 KM Progress Milestones မှန်ကန်ခြင်း',
    () => {
      // Milestone formatting verification across 0.00 -> 1.50 KM
      assert(formatDistanceKm(0) === '0.00', '0m -> 0.00');
      assert(formatDistanceKm(250) === '0.25', '250m -> 0.25');
      assert(formatDistanceKm(500) === '0.50', '500m -> 0.50');
      assert(formatDistanceKm(750) === '0.75', '750m -> 0.75');
      assert(formatDistanceKm(1000) === '1.00', '1000m -> 1.00');
      assert(formatDistanceKm(1250) === '1.25', '1250m -> 1.25');
      assert(formatDistanceKm(1500) === '1.50', '1500m -> 1.50');
      assert(formatDistanceKm(1650) === '1.50', 'Clamped above 1500m -> 1.50');

      // Single-player finish at 1,500m
      let sp = startCountdownState(
        createInitialSnowRushState({
          playerName: 'သင်',
          showOfflineBots: false,
          trackSeed: 15002026,
        }),
        { trackSeed: 15002026 }
      );
      while (sp.phase === 'countdown') {
        sp = stepSnowRushSimulation(
          sp,
          { steerLeft: false, steerRight: false, jumpPressed: false, useItemPressed: false },
          0.05
        );
      }
      sp = {
        ...sp,
        elapsedRaceMs: 73500,
        player: { ...sp.player, distanceM: 1499.4, speedMps: 20.6 },
      };
      sp = stepSnowRushSimulation(
        sp,
        { steerLeft: false, steerRight: false, jumpPressed: false, useItemPressed: false },
        0.05
      );
      const finishedHud = buildHudSnapshot(sp);
      assert(
        sp.phase === 'finished' &&
          sp.player.distanceM === 1500 &&
          sp.player.finishTimeMs !== null &&
          finishedHud.progressPercent === 100 &&
          finishedHud.distanceKmText === '1.50' &&
          finishedHud.courseLengthKmText === '1.50',
        'Single-player finishes cleanly at exactly 1500m (1.50 km / 100%)'
      );

      // Multiplayer finish at 1,500m
      let mp = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 15002026,
          initialPhase: 'countdown',
        })
      );
      mp = {
        ...mp,
        elapsedRaceMs: 73500,
        racers: {
          uid_alpha: { ...mp.racers.uid_alpha, distanceM: 1499.4, speedMps: 20.6 },
          uid_bravo: { ...mp.racers.uid_bravo, distanceM: 1480.0, speedMps: 20.0 },
        },
      };
      mp = stepMultiplayerSnowRushTick(mp, {}, 0.05);
      assert(
        mp.phase === 'finish_window' &&
          mp.finishState.winnerId === 'uid_alpha' &&
          mp.racers.uid_alpha.distanceM === 1500 &&
          mp.racers.uid_alpha.finishRank === 1,
        'Multiplayer locks winner at 1500m and opens 15s post-winner window'
      );
    }
  );

  // 28. 1500m အထိ Track Obstacles နှင့် 10 Item Box Stations ဖြန့်ကျက်တည်ရှိခြင်း
  registerTest(
    28,
    '1500m အထိ Track Obstacles နှင့် 10 Item Box Stations ဖြန့်ကျက်တည်ရှိခြင်း',
    () => {
      assert(TRACK_OBSTACLE_START_M === 74 && TRACK_OBSTACLE_END_M === 1458, 'Obstacle zone spans 74m..1458m');
      assert(
        JSON.stringify(ITEM_BOX_ROW_DISTANCES_M) ===
          JSON.stringify([140, 280, 420, 560, 700, 840, 980, 1120, 1260, 1400]),
        '10 deterministic Item Box stations span evenly up to 1400m'
      );

      for (const seed of [101010, 20260409, 888999111]) {
        const state = createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_4,
          trackSeed: seed,
        });
        const { obstacles, itemBoxes } = state.track;
        assert(obstacles.length >= 60, `1,500m track must have rich obstacle density (got ${obstacles.length})`);

        const minObsM = Math.min(...obstacles.map((o) => o.distanceM));
        const maxObsM = Math.max(...obstacles.map((o) => o.distanceM));
        assert(minObsM >= TRACK_OBSTACLE_START_M && minObsM < 90, 'Obstacles start near ~74m');
        assert(
          maxObsM > 1420 && maxObsM <= TRACK_OBSTACLE_END_M,
          `Obstacles extend into 1000m..1458m final stretch (maxObsM=${maxObsM})`
        );
        assert(
          obstacles.some((o) => o.distanceM > 1000 && o.distanceM < 1200) &&
            obstacles.some((o) => o.distanceM >= 1200 && o.distanceM <= 1458),
          'No empty obstacle zone between 1000m and 1458m'
        );

        const rowSet = new Set(itemBoxes.map((b) => b.distanceM));
        assert(rowSet.size === 10, 'All 10 Item Box station distances populated');
        for (const stationM of ITEM_BOX_ROW_DISTANCES_M) {
          assert(rowSet.has(stationM), `Item Box station at ${stationM}m exists`);
          for (const obs of obstacles) {
            assert(
              Math.abs(obs.distanceM - stationM) >= ITEM_BOX_OBSTACLE_CLEARANCE_M,
              `Obstacle at ${obs.distanceM}m respects clearance around Item Box station ${stationM}m`
            );
          }
        }
      }
    }
  );

  // 29. Avalanche System သည် 1500m အထိ ပုံမှန်လိုက်နိုင်ပြီး အစောကြီးမဖမ်း / နောက်မကျန်ခဲ့ခြင်း
  registerTest(
    29,
    'Avalanche System သည် 1500m အထိ ပုံမှန်လိုက်နိုင်ပြီး အစောကြီးမဖမ်း / နောက်မကျန်ခဲ့ခြင်း',
    () => {
      let state = advanceThroughCountdown(
        createInitialMultiplayerRaceState({
          players: TEST_PLAYERS_2,
          trackSeed: 3141592,
          initialPhase: 'countdown',
        })
      );

      assertApprox(
        state.avalanche.graceRemainingSec,
        AVALANCHE_SAFE_GRACE_SEC,
        0.01,
        'Avalanche starts with 4.0s grace period'
      );

      // Step through full 1,500m race and audit Avalanche speed & gap past 1,000m
      let observedPast1000mPursuit = false;
      let tick = 0;
      while (state.phase !== 'finished' && tick < 3400) {
        tick += 1;
        state = stepMultiplayerSnowRushTick(
          state,
          {
            uid_alpha: { steer: tick % 16 < 8 ? -1 : 1, jumpPressed: tick % 30 === 0, useItemPressed: true, seq: tick },
            uid_bravo: { steer: tick % 20 < 10 ? 1 : -1, jumpPressed: tick % 34 === 0, useItemPressed: true, seq: tick },
          },
          0.05
        );

        if (state.avalanche.isActive) {
          assert(
            state.avalanche.speedMps >= AVALANCHE_BASE_SPEED_MPS - 0.01 &&
              state.avalanche.speedMps <= AVALANCHE_MAX_SPEED_MPS + 0.01,
            `Avalanche speed bounded within [${AVALANCHE_BASE_SPEED_MPS}, ${AVALANCHE_MAX_SPEED_MPS}]`
          );
          assert(
            state.avalanche.distanceM <= COURSE_LENGTH_M - 15 + 0.01,
            'Avalanche upper clamp respects COURSE_LENGTH_M - 15 (1,485m)'
          );
        }

        const trailingDist = Math.min(
          state.racers.uid_alpha.distanceM,
          state.racers.uid_bravo.distanceM
        );
        if (trailingDist > 1150 && trailingDist < 1450 && state.phase === 'racing') {
          observedPast1000mPursuit = true;
          const gap = trailingDist - state.avalanche.distanceM;
          assert(
            gap <= AVALANCHE_CATCHUP_MAX_GAP_M + 1.0,
            `Avalanche keeps pursuing past 1,000m without falling >130m behind (gap=${gap}m)`
          );
        }
      }

      assert(observedPast1000mPursuit, 'Avalanche actively pursued racers in the 1,150m..1,450m zone');
      assert(state.phase === 'finished', '1,500m race with Avalanche pursuit completed cleanly');
    }
  );

  // 30. Offline Demo Bots နှစ်ဦးလုံး 1500m ပန်းဝင်မျဉ်းအထိ မှန်ကန်စွာ ကစားနိုင်ခြင်း
  registerTest(
    30,
    'Offline Demo Bots နှစ်ဦးလုံး 1500m ပန်းဝင်မျဉ်းအထိ မှန်ကန်စွာ ကစားနိုင်ခြင်း',
    () => {
      let sp = startCountdownState(
        createInitialSnowRushState({
          playerName: 'သင်',
          showOfflineBots: true,
          trackSeed: 20260909,
        }),
        { trackSeed: 20260909 }
      );

      // Hold player slightly slower initially if needed, or step until bots reach 1,500m before player finishes
      // Note: stepSnowRushSimulation freezes simulation once player finishes, so let's verify bots cross 1,000m AND reach 1,500m when player cruises slightly behind or alongside!
      while (sp.phase === 'countdown') {
        sp = stepSnowRushSimulation(
          sp,
          { steerLeft: false, steerRight: false, jumpPressed: false, useItemPressed: false },
          0.05
        );
      }

      let bot1Crossed1000 = false;
      let bot2Crossed1000 = false;
      let ticks = 0;
      while (
        ticks < 3600 &&
        sp.offlineDemoBots.some((b) => b.finishTimeMs === null)
      ) {
        ticks += 1;
        // Keep local player safely just behind bots until bots cross 1,500m so the local prototype loop stays in 'racing'
        if (sp.player.distanceM > 1420 && sp.offlineDemoBots.some((b) => b.finishTimeMs === null)) {
          sp = {
            ...sp,
            player: { ...sp.player, distanceM: 1420, speedMps: 18.0 },
          };
        }
        sp = stepSnowRushSimulation(
          sp,
          {
            steerLeft: ticks % 16 < 8,
            steerRight: ticks % 16 >= 8,
            jumpPressed: ticks % 32 === 0,
            useItemPressed: true,
          },
          0.05
        );
        if (sp.offlineDemoBots[0].distanceM > 1000 && sp.offlineDemoBots[0].finishTimeMs === null) {
          bot1Crossed1000 = true;
        }
        if (sp.offlineDemoBots[1].distanceM > 1000 && sp.offlineDemoBots[1].finishTimeMs === null) {
          bot2Crossed1000 = true;
        }
      }

      assert(bot1Crossed1000 && bot2Crossed1000, 'Both Offline Demo Bots continued racing past 1,000m without stopping');
      assert(
        sp.offlineDemoBots.every((b) => b.distanceM === 1500 && b.finishTimeMs !== null),
        'Both Offline Demo Bots reached the 1,500m Finish Line cleanly'
      );
    }
  );

  return results;
}

// Self-executing CLI runner when invoked via `npx tsx src/games/snow-rush/engine/multiplayerSimulation.test.ts`
const isDirectExecution = (() => {
  const g = globalThis as Record<string, unknown>;
  const proc = g.process as { argv?: string[] } | undefined;
  if (!proc?.argv) return false;
  return proc.argv.some((arg) => arg.includes('multiplayerSimulation.test'));
})();

if (isDirectExecution) {
  const results = runSnowRushMultiplayerEngineTests();
  let passCount = 0;
  for (const res of results) {
    if (res.status === 'PASS') {
      passCount += 1;
      console.log(`[PASS] #${String(res.id).padStart(2, '0')} — ${res.name}`);
    } else {
      console.error(`[FAIL] #${String(res.id).padStart(2, '0')} — ${res.name}: ${res.error}`);
    }
  }
  console.log(`\nSummary: ${passCount}/${results.length} Automated Tests PASSED.`);
  if (passCount !== results.length) {
    throw new Error(`${results.length - passCount} test(s) failed.`);
  }
}
