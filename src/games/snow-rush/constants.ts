import type { SnowRushItemId, SnowRushItemMetadata } from './types';

/**
 * Snow Rush: Avalanche Escape — Step 4.4 Local Gameplay, Obstacles, Avalanche & Battle Item Constants
 * All speed, obstacle, collision, avalanche, recovery, and battle item balance values live here.
 */

export const COURSE_LENGTH_M = 1000;
export const COURSE_LENGTH_KM_TEXT = '1.00';
export const DISTANCE_MARKER_INTERVAL_M = 100;

export const COUNTDOWN_DURATION_SEC = 2.7; // 3 crisp 0.9s beats: 3 -> 2 -> 1 -> GO!
export const COUNTDOWN_BEAT_SEC = 0.9;

// Player Downhill Speed & Steering Balance (~20.6 m/s reference cruise speed)
export const MIN_START_PUSH_MPS = 12.0;
export const MIN_RACING_FLOOR_MPS = 6.5; // Allows 45%-50% obstacle penalties to take full effect
export const BASE_MAX_SPEED_MPS = 20.6; // ~74 km/h reference cruise speed (vs 17.5-19.2 m/s Avalanche)
export const CARVE_SPEED_TRIM_MPS = 1.5; // Hard carving trims top speed slightly
export const JUMP_AIR_SPEED_BONUS_MPS = 0.9;
export const DOWNHILL_ACCEL_MPS2 = 11.2;
export const PENALTY_DECEL_MPS2 = 24.0;

export const LATERAL_ACCEL_PER_SEC2 = 7.8;
export const LATERAL_FRICTION_PER_SEC = 7.0;
export const MAX_LATERAL_VELOCITY = 1.72;
export const TRACK_SAFE_LANE_LIMIT = 0.86;
export const RACER_COLLISION_HALF_LANE = 0.075;
export const RACER_COLLISION_HALF_LENGTH_M = 0.95;

// Discrete Track Lanes (5 lanes across [-0.86, +0.86])
export const TRACK_LANE_CENTERS: readonly number[] = [-0.64, -0.32, 0.0, 0.32, 0.64];
export const TRACK_OBSTACLE_START_M = 74;
export const TRACK_OBSTACLE_END_M = 958;
export const MIN_OPEN_LANES_PER_ROW = 2;

// Normal Jump & Jump Ramp Parameters
export const JUMP_DURATION_SEC = 0.62;
export const JUMP_PEAK_HEIGHT_PX = 38;
export const RAMP_JUMP_DURATION_SEC = 0.85;
export const RAMP_JUMP_PEAK_HEIGHT_PX = 54;
export const RAMP_LANDING_BOOST_SEC = 1.15;
export const RAMP_LANDING_BOOST_MULT = 1.15; // +15% landing boost

// Obstacle Penalties & Surface Modifiers (Step 4.3 Spec)
// A. Pine Tree: Tall, unjumpable, ~0.85s @ 45% speed reduction (0.55x)
export const PINE_TREE_PENALTY_SEC = 0.85;
export const PINE_TREE_SPEED_MULT = 0.55;

// B. Rock: Low, jumpable, ~0.9s spin + 50% speed reduction (0.50x)
export const ROCK_SPIN_PENALTY_SEC = 0.9;
export const ROCK_SPEED_MULT = 0.5;
export const ROCK_CLEARANCE_HEIGHT_PX = 14;

// C. Snow Mound: Low, jumpable, ~0.5s @ 25% speed reduction (0.75x)
export const SNOW_MOUND_PENALTY_SEC = 0.5;
export const SNOW_MOUND_SPEED_MULT = 0.75;
export const SNOW_MOUND_CLEARANCE_HEIGHT_PX = 12;

// D. Ice Patch: Surface hazard, +10% speed while crossing, ~1.2s reduced steering grip
export const ICE_PATCH_SPEED_MULT = 1.1;
export const ICE_PATCH_BOOST_DURATION_SEC = 0.6;
export const ICE_PATCH_SLIP_DURATION_SEC = 1.2;
export const ICE_PATCH_STEER_GRIP_MULT = 0.52; // Reduced grip while preserving active player control
export const ICE_PATCH_FRICTION_MULT = 0.22;
export const ICE_PATCH_CLEARANCE_HEIGHT_PX = 10;

// F. Slalom Gate / Barrier: Tall fence panels leaving >= 2 lane widths open
export const SLALOM_BARRIER_PENALTY_SEC = 0.75;
export const SLALOM_BARRIER_SPEED_MULT = 0.58;

// Avalanche Chase Balance (Step 4.3 Spec)
export const AVALANCHE_INITIAL_DISTANCE_M = -90; // Starts 90m behind Start Line
export const AVALANCHE_SAFE_GRACE_SEC = 4.0; // 4.0s safe grace period at race start
export const AVALANCHE_BASE_SPEED_MPS = 17.5; // Normal chase speed
export const AVALANCHE_MAX_SPEED_MPS = 19.2; // Strict upper speed cap (<= 19.2 m/s)
export const AVALANCHE_CATCHUP_MAX_GAP_M = 130; // Catch-up clamp behind trailing active racer
export const AVALANCHE_CAUTION_GAP_M = 65;
export const AVALANCHE_DANGER_GAP_M = 35;

// Snow Tumble & Recovery Balance (Step 4.3 Spec)
export const SNOW_TUMBLE_DURATION_SEC = 1.3;
export const SNOW_TUMBLE_DRIFT_SPEED_MPS = 6.2;
export const SNOW_TUMBLE_RECOVERY_AHEAD_M = 25; // Reposition 25m ahead of Avalanche
export const SNOW_TUMBLE_MAX_RECOVERY_M = COURSE_LENGTH_M - 5; // Never exceed or false-finish 1000m
export const POST_TUMBLE_INVULN_SEC = 2.0; // 2.0s post-recovery invulnerability
export const RECOVERY_INITIAL_SPEED_MPS = 10.8;
export const RECOVERY_SPEED_RAMP_SEC = 1.5; // Staged speed recovery ramp

// ============================================================================
// Step 4.4 — Battle Items, Power-ups & Anti-Stun-Lock Balance Constants
// ============================================================================

// Item Box World Rows along the 1,000m Track (3-4 deterministic boxes per row)
export const ITEM_BOX_ROW_DISTANCES_M: readonly number[] = [140, 280, 420, 560, 700, 840];
export const ITEM_BOX_OBSTACLE_CLEARANCE_M = 6.8; // Keeps obstacles off Item Box rows
export const ITEM_BOX_HALF_LENGTH_M = 1.35;
export const ITEM_BOX_HALF_WIDTH_LANE = 0.115;

// Held Item Inventory & Arming Delay
export const ITEM_ARMING_DELAY_SEC = 0.4; // Prevents accidental instant firing on pickup

// Item A — Nitro Boost (⚡)
export const NITRO_BOOST_DURATION_SEC = 2.2;
export const NITRO_BOOST_SPEED_MULT = 1.45; // +45% speed increase
export const NITRO_MAX_SPEED_CAP_MPS = 30.0; // Strict upper cap (108 km/h) so boosts never stack wildly
export const NITRO_ACCEL_MPS2 = 34.0;
export const NITRO_HIT_DAMP_MULT = 0.78; // Moderates hit slow on an active Nitro user without crushing speed

// Item B — Snowball Attack (❄️)
export const SNOWBALL_PROJECTILE_SPEED_MPS = 34.0; // ~34 m/s forward velocity
export const SNOWBALL_MAX_RANGE_M = 180.0; // Despawns cleanly at 180m if missed
export const SNOWBALL_SPAWN_AHEAD_M = 1.4;
export const SNOWBALL_HIT_HALF_LANE = 0.135; // Combined with racer 0.075 => 0.21 lane hit width
export const SNOWBALL_HIT_SLOW_SEC = 0.9;
export const SNOWBALL_HIT_SPEED_MULT = 0.62; // Moderate 38% slow for ~0.9s

// Item C — Snow / Banana Trap (🍌)
export const TRAP_DROP_BEHIND_M = 2.6; // Placed behind user so placer never self-hits
export const TRAP_SELF_SAFE_AGE_SEC = 2.5;
export const TRAP_HALF_LENGTH_M = 1.15;
export const TRAP_HALF_WIDTH_LANE = 0.115; // Combined with racer 0.075 => 0.19 lane hit width
export const TRAP_SLIP_PENALTY_SEC = 0.9;
export const TRAP_SLIP_SPEED_MULT = 0.58;
export const TRAP_JUMP_CLEARANCE_PX = 10; // Jumpable when airborne
export const TRAP_MAX_LIFETIME_SEC = 18.0; // Bounded lifetime prevents infinite object buildup
export const MAX_ACTIVE_TRAPS = 10; // Strict upper bound on simultaneous active traps

// Item D — Ice Shield (🛡️)
export const ICE_SHIELD_DURATION_SEC = 5.0; // Lasts 5.0s OR blocks 1 attack/trap/solid-obstacle hit
export const SHIELD_BREAK_ANIM_DURATION_SEC = 0.45;

// Anti-Stun-Lock Fairness
export const MERCY_INVULN_DURATION_SEC = 2.0; // 2.0s Mercy Invulnerability after Snowball or Trap hit

export const SNOW_RUSH_ITEMS_META: Readonly<Record<SnowRushItemId, SnowRushItemMetadata>> = {
  nitro_boost: {
    id: 'nitro_boost',
    name: 'Nitro Boost',
    nameMm: 'နိုက်ထရို အမြန်နှုန်း',
    icon: '⚡',
    accentHex: '#F59E0B',
  },
  snowball_attack: {
    id: 'snowball_attack',
    name: 'Snowball Attack',
    nameMm: 'နှင်းလုံးပစ်တိုက်ခိုက်မှု',
    icon: '❄️',
    accentHex: '#0EA5E9',
  },
  snow_trap: {
    id: 'snow_trap',
    name: 'Snow Trap',
    nameMm: 'ချော်လဲထောင်ချောက်',
    icon: '🍌',
    accentHex: '#EAB308',
  },
  ice_shield: {
    id: 'ice_shield',
    name: 'Ice Shield',
    nameMm: 'ရေခဲဒိုင်းအကာအကွယ်',
    icon: '🛡️',
    accentHex: '#38BDF8',
  },
};

// Simulation & Rendering Budgets
export const MAX_SIMULATION_DT_SEC = 0.05; // 50ms clamp prevents tab-switch teleportation
export const MAX_COLLISION_SUBSTEP_SEC = 1 / 120; // Sub-step prevents obstacle/projectile tunneling
export const MAX_TRAIL_SAMPLES = 28;
export const TRAIL_SAMPLE_MIN_DELTA_M = 1.25;
export const MAX_VISUAL_BURSTS = 16;

// ============================================================================
// Step 4.6 — Shared Multi-Racer Authoritative Simulation Constants (2–4 Players)
// ============================================================================
export const MULTIPLAYER_MIN_PLAYERS = 2;
export const MULTIPLAYER_MAX_PLAYERS = 4;
export const MULTIPLAYER_TICK_HZ = 20;
export const MULTIPLAYER_TICK_DT_SEC = 1 / MULTIPLAYER_TICK_HZ; // 0.05s (50ms)
export const POST_WINNER_FINISH_WINDOW_SEC = 15.0; // 15s finish window after 1st finisher
export const MULTIPLAYER_OBSTACLE_MEMORY_BEHIND_M = 20.0; // Bounded obstacle guard window

export const STARTING_GRID_LANES_2P: readonly [number, number] = [-0.32, 0.32];
export const STARTING_GRID_LANES_3P: readonly [number, number, number] = [-0.48, 0, 0.48];
export const STARTING_GRID_LANES_4P: readonly [number, number, number, number] = [
  -0.64,
  -0.22,
  0.22,
  0.64,
];

export const MULTIPLAYER_DEFAULT_RACER_COLORS: readonly [string, string, string, string] = [
  '#EF4444',
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
];

export const CANVAS_MAX_DPR = 2;
export const PIXELS_PER_METER_BASE = 14;
export const HUD_SYNC_INTERVAL_MS = 75;
export const MAX_SCREEN_SHAKE_PX = 3.0;

export interface OfflineBotPreset {
  id: string;
  displayNameMm: string;
  shortTag: string;
  jacketColor: string;
  hatColor: string;
  scarfColor: string;
  boardColor: string;
  initialLaneOffset: number;
  baseCruiseMps: number;
  weaveFreqRad: number;
  weavePhaseRad: number;
  weaveCenterOffset: number;
  weaveAmplitude: number;
}

export const OFFLINE_DEMO_BOT_PRESETS: readonly OfflineBotPreset[] = [
  {
    id: 'offline_demo_bot_1',
    displayNameMm: 'စမ်းသပ် Bot ၁ (Offline)',
    shortTag: 'BOT 1',
    jacketColor: '#0EA5E9',
    hatColor: '#0284C7',
    scarfColor: '#FDE047',
    boardColor: '#F97316',
    initialLaneOffset: -0.32,
    baseCruiseMps: 20.1,
    weaveFreqRad: 1.35,
    weavePhaseRad: 0.45,
    weaveCenterOffset: -0.22,
    weaveAmplitude: 0.24,
  },
  {
    id: 'offline_demo_bot_2',
    displayNameMm: 'စမ်းသပ် Bot ၂ (Offline)',
    shortTag: 'BOT 2',
    jacketColor: '#10B981',
    hatColor: '#059669',
    scarfColor: '#FDA4AF',
    boardColor: '#8B5CF6',
    initialLaneOffset: 0.32,
    baseCruiseMps: 19.3,
    weaveFreqRad: 1.1,
    weavePhaseRad: 2.1,
    weaveCenterOffset: 0.22,
    weaveAmplitude: 0.25,
  },
];
