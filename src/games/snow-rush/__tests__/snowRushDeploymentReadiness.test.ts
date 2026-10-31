import * as fs from 'node:fs';
import * as path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadEnv } from 'vite';
import { getAvailableGames, getGameById } from '../../registry';
import { isGameModulePlayable, resolveGameModule } from '../../moduleResolver';
import { resolveCreateGameRoomInput } from '../../../services/roomService';
import type { GameRoom, UserProfile } from '../../../types';
import workerEntry, {
  isOriginAllowed,
  parseAllowedOrigins,
  SnowRushRoomDO,
} from '../../../../workers/snow-rush-server/src/index';
import type {
  DurableObjectNamespace,
  ExecutionContext,
  SnowRushWorkerEnv,
} from '../../../../workers/snow-rush-server/src/cloudflareTypes';
import {
  resolveSnowRushWorkerHealthUrl,
  resolveSnowRushWorkerWsUrl,
} from '../network/protocol';
import { SnowRushPrivateTestViewContent } from '../SnowRushPrivateTestView';
import {
  buildPrivateSnowRushRoomPayload,
  checkSnowRushWorkerHealth,
  clampPrivateSnowRushMaxPlayers,
  computePrivateSnowRushLeaveTransition,
} from '../../../services/snowRushPrivateRoomService';

/**
 * Snow Rush: Avalanche Escape — Step 4.9 Deployment Readiness & Private Test Audit Suite
 *
 * Verifies:
 * 1. Companion Worker (`workers/snow-rush-server/wrangler.toml` & `package.json`) isolation from root Cloudflare Pages (`wrangler.toml`).
 * 2. Durable Object SQLite migration (`new_sqlite_classes = ["SnowRushRoomDO"]`) & Named Firestore DB ID (`ai-studio-47dffdd9-9dac-40e5-b320-95d71826db89`).
 * 3. Worker `GET /health` readiness diagnostics & `ALLOWED_ORIGINS` exact + wildcard subdomain matching (`https://*.child-vibes.pages.dev`) + spoofing defense.
 * 4. `VITE_SNOW_RUSH_WS_URL` normalization (empty default, trailing slashes, `/ws/snow-rush`, `/health`, `https`/`wss` conversion).
 * 5. Private Test Room payload & leave transitions strictly honoring `firestore.rules` without writing `status: 'finished'`, `winnerId`, XP, or Points.
 * 6. Zero secrets or service account keys in repo files & public `coming_soon` guard preservation.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const WORKSPACE_ROOT = path.resolve(process.cwd());
const EXPECTED_PROJECT_ID = 'gen-lang-client-0335200904';
const EXPECTED_NAMED_DB_ID = 'ai-studio-47dffdd9-9dac-40e5-b320-95d71826db89';

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
    FIREBASE_PROJECT_ID: EXPECTED_PROJECT_ID,
    FIRESTORE_DATABASE_ID: EXPECTED_NAMED_DB_ID,
    SNAPSHOT_BROADCAST_HZ: '10',
    ALLOWED_ORIGINS: '',
    ...overrides,
  };
}

const MOCK_CTX: ExecutionContext = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
};

async function runStep49ReadinessSuite(): Promise<void> {
  let passed = 0;

  // 1. Companion Worker vs Root Cloudflare Pages Config Isolation & Workers Builds Compatibility
  {
    const rootWrangler = fs.readFileSync(path.join(WORKSPACE_ROOT, 'wrangler.toml'), 'utf8');
    const workerWrangler = fs.readFileSync(
      path.join(WORKSPACE_ROOT, 'workers/snow-rush-server/wrangler.toml'),
      'utf8'
    );
    const workerPkg = JSON.parse(
      fs.readFileSync(
        path.join(WORKSPACE_ROOT, 'workers/snow-rush-server/package.json'),
        'utf8'
      )
    ) as {
      name?: string;
      private?: boolean;
      scripts?: Record<string, string>;
    };
    const setupGuide = fs.readFileSync(
      path.join(WORKSPACE_ROOT, 'workers/snow-rush-server/CLOUDFLARE_GITHUB_SETUP.md'),
      'utf8'
    );
    const envExample = fs.readFileSync(path.join(WORKSPACE_ROOT, '.env.example'), 'utf8');

    assert(rootWrangler.includes('name = "child-vibes"'), 'Root wrangler.toml must remain child-vibes');
    assert(
      rootWrangler.includes('pages_build_output_dir = "dist"'),
      'Root wrangler.toml must remain Cloudflare Pages dist config'
    );
    assert(
      !rootWrangler.includes('SnowRushRoomDO'),
      'Root Pages wrangler.toml must not contain Durable Object bindings'
    );

    assert(
      workerWrangler.includes('name = "child-vibes-snow-rush-server"'),
      'Worker wrangler.toml must use separate child-vibes-snow-rush-server name'
    );
    assert(
      workerWrangler.includes('workers_dev = true'),
      'Worker wrangler.toml must enable workers_dev = true for initial Workers Builds URL'
    );
    assert(
      workerWrangler.includes('new_sqlite_classes = ["SnowRushRoomDO"]'),
      'Worker wrangler.toml must declare SQLite DO migration for Cloudflare Free Tier'
    );
    assert(
      workerWrangler.includes(`FIREBASE_PROJECT_ID = "${EXPECTED_PROJECT_ID}"`),
      'Worker wrangler.toml must configure FIREBASE_PROJECT_ID'
    );
    assert(
      workerWrangler.includes(`FIRESTORE_DATABASE_ID = "${EXPECTED_NAMED_DB_ID}"`),
      'Worker wrangler.toml must configure named FIRESTORE_DATABASE_ID (never default)'
    );
    assert(
      workerWrangler.includes('https://child-vibes3050.pages.dev') &&
        workerWrangler.includes('https://*.child-vibes3050.pages.dev') &&
        !workerWrangler.includes('child-vibes.pages.dev') &&
        !workerWrangler.includes('http://localhost:3000'),
      'Worker wrangler.toml ALLOWED_ORIGINS must target child-vibes3050.pages.dev and exclude http://localhost:3000'
    );
    assert(
      workerPkg.name === 'child-vibes-snow-rush-server' && workerPkg.private === true,
      'Companion Worker package.json must be private and isolated'
    );
    assert(
      workerPkg.scripts?.deploy === 'npx wrangler deploy',
      'Companion Worker package.json deploy script must use npx wrangler deploy for Workers Builds compatibility'
    );
    assert(
      setupGuide.includes('child-vibes-snow-rush-server') &&
        setupGuide.includes('workers/snow-rush-server') &&
        setupGuide.includes('npx wrangler deploy') &&
        setupGuide.includes('/health'),
      'CLOUDFLARE_GITHUB_SETUP.md must document exact Worker name, Root directory, Deploy command, and /health check'
    );
    assert(
      !fs.existsSync(path.join(WORKSPACE_ROOT, '.github/workflows')),
      'Must NOT create GitHub Actions workflows (Native Cloudflare Workers Builds only)'
    );
    assert(
      envExample.includes('VITE_SNOW_RUSH_WS_URL=""'),
      '.env.example must keep VITE_SNOW_RUSH_WS_URL empty by default'
    );
    assert(
      typeof SnowRushRoomDO === 'function' && typeof workerEntry.fetch === 'function',
      'Worker entry must export default.fetch and SnowRushRoomDO class'
    );
    passed += 1;
  }

  // 2. Worker Health Endpoint & Readiness Booleans
  {
    const env = createMockWorkerEnv({
      ALLOWED_ORIGINS:
        'https://child-vibes3050.pages.dev, https://*.child-vibes3050.pages.dev/',
    });
    const healthReq = new Request('https://snow-rush.workers.dev/health', {
      method: 'GET',
      headers: { Origin: 'https://preview123.child-vibes3050.pages.dev' },
    });
    const res = await workerEntry.fetch(healthReq, env, MOCK_CTX);
    assert(res.status === 200, 'GET /health must return 200');
    assert(
      res.headers.get('Access-Control-Allow-Origin') ===
        'https://preview123.child-vibes3050.pages.dev',
      'GET /health must echo matched preview Origin in CORS header'
    );

    const body = (await res.json()) as Record<string, unknown>;
    assert(body.ok === true, '/health ok must be true');
    assert(body.service === 'child-vibes-snow-rush-server', '/health service mismatch');
    assert(body.protocolVersion === 1, '/health protocolVersion must be 1');
    assert(body.snapshotBroadcastHz === 10, '/health snapshotBroadcastHz must be 10');
    assert(body.durableObjectBindingReady === true, '/health DO binding flag must be true');
    assert(body.firebaseProjectConfigured === true, '/health firebase project flag must be true');
    assert(
      body.firestoreNamedDbConfigured === true,
      '/health named Firestore DB flag must be true'
    );
    assert(body.originAllowlistCount === 2, '/health originAllowlistCount must be 2');

    // Misconfigured `(default)` DB detection
    const badDbEnv = createMockWorkerEnv({ FIRESTORE_DATABASE_ID: '(default)' });
    const badDbRes = await workerEntry.fetch(
      new Request('https://snow-rush.workers.dev/health'),
      badDbEnv,
      MOCK_CTX
    );
    const badDbJson = (await badDbRes.json()) as Record<string, unknown>;
    assert(
      badDbJson.firestoreNamedDbConfigured === false,
      '/health must flag (default) Firestore DB as false'
    );

    // Client health helper verification
    const clientCheck = await checkSnowRushWorkerHealth(
      'wss://snow-rush.workers.dev/ws/snow-rush/',
      async (input) => workerEntry.fetch(new Request(String(input)), env, MOCK_CTX)
    );
    assert(clientCheck.ok === true && clientCheck.configured === true, 'Health helper must pass');
    assert(
      clientCheck.healthUrl === 'https://snow-rush.workers.dev/health',
      'Health helper must normalize wss://.../ws/snow-rush/ to https://.../health'
    );
    passed += 1;
  }

  // 3. Strict Production vs Preview Origin Separation & Spoofing Defense (`child-vibes3050.pages.dev`)
  {
    // 3a. Production-only allowlist MUST NOT allow preview subdomains
    const prodOnly = parseAllowedOrigins('https://child-vibes3050.pages.dev');
    assert(
      isOriginAllowed('https://child-vibes3050.pages.dev', prodOnly),
      'Production-only allowlist must allow exact https://child-vibes3050.pages.dev'
    );
    assert(
      !isOriginAllowed('https://preview1.child-vibes3050.pages.dev', prodOnly),
      'Production-only allowlist must NOT allow preview subdomain without explicit wildcard entry'
    );

    // 3b. Preview-wildcard-only allowlist MUST NOT auto-match bare Production domain
    const previewOnly = parseAllowedOrigins('https://*.child-vibes3050.pages.dev');
    assert(
      isOriginAllowed('https://abc12345.child-vibes3050.pages.dev', previewOnly),
      'Preview wildcard must allow single-label Cloudflare Pages preview subdomain'
    );
    assert(
      !isOriginAllowed('https://child-vibes3050.pages.dev', previewOnly),
      'Preview wildcard https://*.child-vibes3050.pages.dev must NOT auto-match bare https://child-vibes3050.pages.dev'
    );
    assert(
      !isOriginAllowed('https://nested.sub.child-vibes3050.pages.dev', previewOnly),
      'Preview wildcard must reject multi-label nested subdomains'
    );

    // 3c. Legacy/wrong project domain `https://*.child-vibes.pages.dev` MUST NOT match `child-vibes3050.pages.dev`
    const wrongProjectList = parseAllowedOrigins(
      'https://child-vibes.pages.dev, https://*.child-vibes.pages.dev'
    );
    assert(
      !isOriginAllowed('https://child-vibes3050.pages.dev', wrongProjectList) &&
        !isOriginAllowed('https://preview1.child-vibes3050.pages.dev', wrongProjectList),
      'child-vibes.pages.dev patterns must NEVER match child-vibes3050.pages.dev'
    );

    // 3d. Full configured wrangler.toml allowlist check (Step 10.2: localhost:3000 removed)
    const workerWranglerRaw = fs.readFileSync(
      path.join(WORKSPACE_ROOT, 'workers/snow-rush-server/wrangler.toml'),
      'utf8'
    );
    const originsMatch = workerWranglerRaw.match(/ALLOWED_ORIGINS\s*=\s*"([^"]+)"/);
    assert(originsMatch && originsMatch[1], 'ALLOWED_ORIGINS must be present in wrangler.toml');
    const allowlist = parseAllowedOrigins(originsMatch[1]);
    assert(allowlist.length === 4, 'Must parse 4 hardened production/preview/AI-Studio origins');
    assert(
      isOriginAllowed('https://child-vibes3050.pages.dev', allowlist),
      'Exact child-vibes3050 Pages production origin must be allowed'
    );
    assert(
      isOriginAllowed('https://branch-preview.child-vibes3050.pages.dev', allowlist),
      'Wildcard child-vibes3050 Pages preview subdomain must be allowed'
    );
    assert(
      isOriginAllowed(
        'https://ais-dev-qw4gg4jal2u3tup36rro7r-1033756722286.asia-southeast1.run.app/',
        allowlist
      ),
      'AI Studio dev origin must be allowed'
    );
    assert(
      isOriginAllowed(
        'https://ais-pre-qw4gg4jal2u3tup36rro7r-1033756722286.asia-southeast1.run.app',
        allowlist
      ),
      'AI Studio shared preview origin must be allowed'
    );
    assert(
      !isOriginAllowed('http://localhost:3000', allowlist),
      'Localhost:3000 dev origin must be rejected in hardened production Worker allowlist'
    );
    assert(
      !isOriginAllowed('https://evilchild-vibes3050.pages.dev', allowlist),
      'Prefix-spoofed domain must be rejected'
    );
    assert(
      !isOriginAllowed('http://branch-preview.child-vibes3050.pages.dev', allowlist),
      'Downgraded http:// scheme on https:// wildcard must be rejected'
    );
    assert(
      !isOriginAllowed(null, allowlist),
      'Missing Origin header must be rejected when allowlist is active'
    );

    const env = createMockWorkerEnv({
      ALLOWED_ORIGINS:
        'https://child-vibes3050.pages.dev,https://*.child-vibes3050.pages.dev',
    });
    const blockedWsReq = new Request('https://snow-rush.workers.dev/ws/snow-rush/room_ABC234', {
      method: 'GET',
      headers: {
        Origin: 'https://attacker.example.com',
        Upgrade: 'websocket',
      },
    });
    const blockedRes = await workerEntry.fetch(blockedWsReq, env, MOCK_CTX);
    assert(blockedRes.status === 403, 'Disallowed Origin on /ws/snow-rush/:roomId must return 403');
    passed += 1;
  }

  // 4. `VITE_SNOW_RUSH_WS_URL` Normalization & Safe Unconfigured Default
  {
    assert(resolveSnowRushWorkerWsUrl('room_AB23CD', '') === null, 'Empty URL must resolve null');
    assert(
      resolveSnowRushWorkerHealthUrl('') === null,
      'Empty URL must resolve null health endpoint'
    );
    assert(
      resolveSnowRushWorkerWsUrl(
        'room_AB23CD',
        'https://child-vibes-snow-rush-server.demo.workers.dev/'
      ) === 'wss://child-vibes-snow-rush-server.demo.workers.dev/ws/snow-rush/room_AB23CD',
      'https:// Worker URL must map to wss://.../ws/snow-rush/:roomId'
    );
    assert(
      resolveSnowRushWorkerWsUrl(
        'room_AB23CD',
        'wss://child-vibes-snow-rush-server.demo.workers.dev/ws/snow-rush/'
      ) === 'wss://child-vibes-snow-rush-server.demo.workers.dev/ws/snow-rush/room_AB23CD',
      'Accidental /ws/snow-rush suffix in env var must not duplicate path'
    );
    assert(
      resolveSnowRushWorkerHealthUrl('http://localhost:8787') === 'http://localhost:8787/health',
      'http://localhost:8787 must map to http://localhost:8787/health'
    );
    assert(
      resolveSnowRushWorkerWsUrl('room_AB23CD', 'javascript:alert(1)') === null,
      'Non-http/ws schemes must be rejected'
    );
    passed += 1;
  }

  // 5. Private Test Room Firestore Rules Compliance & Zero Reward / Finished Writes
  {
    const mockHost: UserProfile = {
      id: 'uid_host_1',
      playerId: 'CV100001',
      displayName: 'Host Tester',
      email: 'host@example.com',
      photoURL: '',
      level: 1,
      xp: 120,
      totalXp: 120,
      points: 50,
      totalWins: 1,
      totalGames: 3,
      activeBoardSkin: 'board_classic',
      activeDiceSkin: 'dice_classic',
      activeTokenSkin: 'token_crown',
      activeFrame: 'frame_gold',
      inventory: [],
      createdAt: new Date(1700000000000).toISOString(),
      updatedAt: new Date(1700000000000).toISOString(),
    };

    assert(clampPrivateSnowRushMaxPlayers(1) === 2, 'Min private players must clamp to 2');
    assert(clampPrivateSnowRushMaxPlayers(3) === 3, '3 private players must preserve 3');
    assert(clampPrivateSnowRushMaxPlayers(9) === 4, 'Max private players must clamp to 4');

    const initialRoom = buildPrivateSnowRushRoomPayload({
      hostUser: mockHost,
      effectiveHostUid: mockHost.id,
      roomCode: 'SR2026',
      maxPlayers: 4,
      now: 1700000000000,
    });

    // Validate every `firestore.rules` `allow create` + `isValidGameRoom` constraint:
    assert(initialRoom.id === 'room_SR2026', 'room.id must match room_<CODE>');
    assert(initialRoom.gameType === 'snow_rush', 'room.gameType must be snow_rush');
    assert(initialRoom.hostId === 'uid_host_1', 'room.hostId must equal host uid');
    assert(initialRoom.status === 'waiting', 'initial room.status must be waiting');
    assert(initialRoom.winnerId === null, 'initial room.winnerId must be null');
    assert(initialRoom.players.length === 1, 'initial room.players.length must be 1');
    assert(initialRoom.stateVersion === 1, 'initial stateVersion must be 1');

    // Leave transition when 2 players are racing (`status: 'playing'`) and 1 leaves:
    // MUST return to `'waiting'` (NEVER `'finished'`, NEVER setting `winnerId`)!
    const twoPlayerPlayingRoom: GameRoom = {
      ...initialRoom,
      status: 'playing',
      stateVersion: 3,
      playerCount: 2,
      players: [
        initialRoom.players[0],
        {
          ...initialRoom.players[0],
          uid: 'uid_guest_2',
          playerId: 'CV100002',
          displayName: 'Guest Tester',
        },
      ],
    };

    const afterGuestLeaves = computePrivateSnowRushLeaveTransition({
      room: twoPlayerPlayingRoom,
      leavingUserId: 'uid_guest_2',
      now: 1700000050000,
    });
    assert(
      afterGuestLeaves.action === 'update' &&
        afterGuestLeaves.nextStatus === 'waiting' &&
        afterGuestLeaves.remainingPlayers.length === 1 &&
        afterGuestLeaves.nextStateVersion === 4,
      'Sole remaining player in private Snow Rush test must return to waiting (never finished)'
    );

    // Leave transition when last remaining player leaves -> clean Firestore room delete!
    const afterLastLeaves = computePrivateSnowRushLeaveTransition({
      room: {
        ...twoPlayerPlayingRoom,
        status: 'waiting',
        players: afterGuestLeaves.action === 'update' ? afterGuestLeaves.remainingPlayers : [],
        stateVersion: 4,
      },
      leavingUserId: 'uid_host_1',
      now: 1700000060000,
    });
    assert(
      afterLastLeaves.action === 'delete',
      'Last tester leaving private room must delete room cleanly'
    );

    // Refuses to touch Snakes & Ladders rooms
    const snakesNoop = computePrivateSnowRushLeaveTransition({
      room: { ...initialRoom, gameType: 'snakes_and_ladders' },
      leavingUserId: 'uid_host_1',
      now: 1700000060000,
    });
    assert(snakesNoop.action === 'noop', 'Private Snow Rush service must never touch other games');
    passed += 1;
  }

  // 6. Public `coming_soon` Guard, Zero Public Room Creation, & Secret Hygiene Scan
  {
    const snowEntry = getGameById('snow_rush');
    assert(snowEntry?.status === 'coming_soon', 'snow_rush must stay coming_soon in registry.ts');
    assert(
      !getAvailableGames().some((g) => g.id === 'snow_rush'),
      'snow_rush must not appear in getAvailableGames()'
    );
    assert(
      resolveGameModule('snow_rush').kind === 'unresolved' &&
        !isGameModulePlayable('snow_rush'),
      'Public moduleResolver must keep snow_rush unresolved (coming_soon)'
    );

    let publicCreateBlocked = false;
    try {
      resolveCreateGameRoomInput('snow_rush', { maxPlayers: 4 });
    } catch {
      publicCreateBlocked = true;
    }
    assert(
      publicCreateBlocked,
      'Public createGameRoom(snow_rush) must remain blocked by GAME_UNAVAILABLE'
    );

    const snakesResolved = resolveCreateGameRoomInput('snakes_and_ladders', {
      maxPlayers: 4,
      exactFinish: true,
    });
    assert(
      snakesResolved.gameType === 'snakes_and_ladders' && snakesResolved.exactFinish === true,
      'Snakes & Ladders room creation must remain 100% intact'
    );

    // Scan private test files & worker files for forbidden calls/secrets
    const filesToScan = [
      'src/services/snowRushPrivateRoomService.ts',
      'src/games/snow-rush/SnowRushPrivateTestView.tsx',
      'workers/snow-rush-server/src/index.ts',
      'workers/snow-rush-server/wrangler.toml',
      'workers/snow-rush-server/package.json',
    ];
    for (const relPath of filesToScan) {
      const raw = fs.readFileSync(path.join(WORKSPACE_ROOT, relPath), 'utf8');
      const stripped = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      assert(
        !stripped.includes('claimMatchReward') && !stripped.includes('claimRoomMatchReward'),
        `${relPath} must never call reward settlement`
      );
      assert(
        !stripped.includes('BEGIN PRIVATE KEY') && !stripped.includes('private_key_id'),
        `${relPath} must never contain service account keys or secrets`
      );
    }
    passed += 1;
  }

  // 7. Production `.env.production` + `.gitignore` + Private Test UI Configured State Verification
  {
    const EXPECTED_PROD_WORKER_URL =
      'https://child-vibes-snow-rush-server.littleyzlay99.workers.dev';

    const gitignoreRaw = fs.readFileSync(path.join(WORKSPACE_ROOT, '.gitignore'), 'utf8');
    const gitignoreLines = gitignoreRaw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    const envWildcardIdx = gitignoreLines.indexOf('.env*');
    const unignoreProdIdx = gitignoreLines.indexOf('!.env.production');
    assert(
      envWildcardIdx >= 0 && unignoreProdIdx > envWildcardIdx,
      '.gitignore must include !.env.production AFTER .env* so GitHub Push includes .env.production'
    );

    const envProdPath = path.join(WORKSPACE_ROOT, '.env.production');
    assert(fs.existsSync(envProdPath), 'Repository root .env.production must exist');
    const envProdLines = fs
      .readFileSync(envProdPath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    assert(
      envProdLines.length === 1 &&
        envProdLines[0] === `VITE_SNOW_RUSH_WS_URL=${EXPECTED_PROD_WORKER_URL}`,
      '.env.production must contain ONLY VITE_SNOW_RUSH_WS_URL for the public Worker endpoint (zero secrets or extra vars)'
    );

    // Simulate Cloudflare Pages `Build environment variables: (none found)` by clearing process.env.VITE_SNOW_RUSH_WS_URL
    const savedEnvVal = process.env.VITE_SNOW_RUSH_WS_URL;
    delete process.env.VITE_SNOW_RUSH_WS_URL;
    let loadedProdEnv: Record<string, string>;
    try {
      loadedProdEnv = loadEnv('production', WORKSPACE_ROOT, 'VITE_');
    } finally {
      if (savedEnvVal !== undefined) {
        process.env.VITE_SNOW_RUSH_WS_URL = savedEnvVal;
      }
    }

    assert(
      loadedProdEnv.VITE_SNOW_RUSH_WS_URL === EXPECTED_PROD_WORKER_URL,
      'Vite loadEnv("production") must resolve VITE_SNOW_RUSH_WS_URL from .env.production even when process.env is empty'
    );
    assert(
      resolveSnowRushWorkerHealthUrl(loadedProdEnv.VITE_SNOW_RUSH_WS_URL) ===
        `${EXPECTED_PROD_WORKER_URL}/health`,
      'Production Worker URL must resolve cleanly to /health endpoint'
    );
    assert(
      resolveSnowRushWorkerWsUrl('room_SR2026', loadedProdEnv.VITE_SNOW_RUSH_WS_URL) ===
        'wss://child-vibes-snow-rush-server.littleyzlay99.workers.dev/ws/snow-rush/room_SR2026',
      'Production Worker URL must resolve cleanly to wss://.../ws/snow-rush/:roomId'
    );

    // Code-level Private Test UI rendering verification (Configured vs Unconfigured)
    const mockTesterProfile: UserProfile = {
      id: 'uid_tester_prod',
      playerId: 'CV900001',
      displayName: 'Snow Tester',
      email: 'tester@example.com',
      photoURL: '',
      level: 2,
      xp: 200,
      totalXp: 200,
      points: 100,
      totalWins: 2,
      totalGames: 5,
      activeBoardSkin: 'board_classic',
      activeDiceSkin: 'dice_classic',
      activeTokenSkin: 'token_crown',
      activeFrame: 'frame_gold',
      inventory: [],
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
    };

    const configuredHtml = renderToStaticMarkup(
      React.createElement(SnowRushPrivateTestViewContent, {
        currentUserUid: mockTesterProfile.id,
        userProfile: mockTesterProfile,
        loading: false,
        workerBaseUrlOverride: loadedProdEnv.VITE_SNOW_RUSH_WS_URL,
      })
    );

    assert(
      configuredHtml.includes(`VITE_SNOW_RUSH_WS_URL သတ်မှတ်ထားပြီး (${EXPECTED_PROD_WORKER_URL})`),
      'Configured Private Test UI must display active Worker host label'
    );
    assert(
      !configuredHtml.includes('VITE_SNOW_RUSH_WS_URL အလွတ်ဖြစ်နေပါသည်') &&
        !configuredHtml.includes('Multiplayer Server မသတ်မှတ်ရသေးပါ (Unconfigured)'),
      'Configured Private Test UI must NOT display Server unconfigured warnings'
    );
    assert(
      !configuredHtml.includes('disabled=""') ||
        (configuredHtml.includes('>Worker /health စမ်းသပ်မည်</button>') &&
          !configuredHtml.includes('disabled="" class="min-h-[40px]') &&
          !configuredHtml.includes('disabled="" class="w-full min-h-[44px] py-2.5 rounded-xl bg-amber-400')),
      'Configured Private Test UI must enable Health Check and Create Private Room buttons'
    );

    // Verify unconfigured fallback still renders warning when explicitly empty
    const unconfiguredHtml = renderToStaticMarkup(
      React.createElement(SnowRushPrivateTestViewContent, {
        currentUserUid: mockTesterProfile.id,
        userProfile: mockTesterProfile,
        loading: false,
        workerBaseUrlOverride: '',
      })
    );
    assert(
      unconfiguredHtml.includes('VITE_SNOW_RUSH_WS_URL အလွတ်ဖြစ်နေပါသည်') &&
        unconfiguredHtml.includes('Multiplayer Server မသတ်မှတ်ရသေးပါ (Unconfigured)'),
      'Explicitly empty override must still render unconfigured warning safely'
    );

    passed += 1;
  }

  console.log(
    `[SnowRush Step 4.9 Deployment Readiness Suite] ALL ${passed}/7 TEST GROUPS PASSED!`
  );
}

runStep49ReadinessSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('[SnowRush Step 4.9 Deployment Readiness Suite] FAILED:', err);
    process.exit(1);
  });
