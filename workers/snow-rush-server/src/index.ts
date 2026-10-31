import { isValidSnowRushRoomId } from '../../../src/games/snow-rush/network/protocol';
import { SnowRushRoomDO } from './SnowRushRoomDO';
import type { ExecutionContext, SnowRushWorkerEnv } from './cloudflareTypes';

export { SnowRushRoomDO };

function normalizeOriginEntry(rawEntry: string): string {
  return rawEntry.trim().replace(/\/+$/, '');
}

export function parseAllowedOrigins(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(normalizeOriginEntry)
    .filter((item) => item.length > 0);
}

function normalizeExactOriginUrl(rawOrigin: string): string | null {
  const trimmed = rawOrigin.trim().replace(/\/+$/, '');
  if (!trimmed || trimmed.includes('*')) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function matchesAllowedOriginPattern(origin: string, pattern: string): boolean {
  const parsedOriginStr = normalizeExactOriginUrl(origin);
  if (!parsedOriginStr) {
    return false;
  }

  // 1. Exact origin matching (e.g. Production `https://child-vibes3050.pages.dev` or `http://localhost:3000`)
  if (!pattern.includes('*')) {
    const normalizedPattern = normalizeExactOriginUrl(pattern);
    return normalizedPattern !== null && parsedOriginStr === normalizedPattern;
  }

  // 2. Single-label wildcard subdomain matching ONLY for Cloudflare Pages previews
  //    (e.g. `https://*.child-vibes3050.pages.dev` matches `https://abc123.child-vibes3050.pages.dev`,
  //    and intentionally does NOT match bare `https://child-vibes3050.pages.dev` or multi-dot subdomains).
  const wildcardMatch = /^(https?:\/\/)\*\.([a-zA-Z0-9.-]+)$/.exec(pattern);
  if (!wildcardMatch) {
    return false;
  }

  const parsedOrigin = new URL(parsedOriginStr);
  const expectedScheme = wildcardMatch[1].toLowerCase();
  const expectedBaseHost = wildcardMatch[2].toLowerCase();
  if (`${parsedOrigin.protocol}//` !== expectedScheme) {
    return false;
  }
  if (parsedOrigin.port !== '') {
    return false;
  }

  const hostLower = parsedOrigin.hostname.toLowerCase();
  const suffix = `.${expectedBaseHost}`;
  if (!hostLower.endsWith(suffix) || hostLower.length <= suffix.length) {
    return false;
  }

  const subdomainLabel = hostLower.slice(0, hostLower.length - suffix.length);
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomainLabel);
}

export function isOriginAllowed(
  originHeader: string | null,
  allowedList: readonly string[]
): boolean {
  if (allowedList.length === 0) {
    return true;
  }
  if (!originHeader) {
    return false;
  }
  const normalizedOrigin = normalizeOriginEntry(originHeader);
  return allowedList.some((pattern) => matchesAllowedOriginPattern(normalizedOrigin, pattern));
}

function buildCorsHeaders(
  originHeader: string | null,
  allowedList: readonly string[]
): Record<string, string> {
  const normalizedOrigin = originHeader ? normalizeOriginEntry(originHeader) : null;
  const allowedOrigin =
    allowedList.length === 0
      ? normalizedOrigin ?? '*'
      : normalizedOrigin && isOriginAllowed(normalizedOrigin, allowedList)
        ? normalizedOrigin
        : 'null';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

function resolveConfiguredSnapshotHz(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(10, Math.min(20, Math.round(parsed)));
}

/**
 * Companion Cloudflare Worker Entry Point for Snow Rush Real-time Multiplayer
 *
 * Endpoints:
 * - `GET /health` -> Lightweight service readiness & protocol metadata (no secrets)
 * - `GET /ws/snow-rush/:roomId` -> Validates `roomId` & `Upgrade: websocket`, then forwards
 *   to deterministic room-scoped `SnowRushRoomDO` (`idFromName(roomId)`).
 */
export default {
  async fetch(
    request: Request,
    env: SnowRushWorkerEnv,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const originHeader = request.headers.get('Origin');
    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const corsHeaders = buildCorsHeaders(originHeader, allowedOrigins);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/health') {
      const firestoreDbId = (env.FIRESTORE_DATABASE_ID ?? '').trim();
      return new Response(
        JSON.stringify({
          ok: true,
          service: 'child-vibes-snow-rush-server',
          protocolVersion: 1,
          snapshotBroadcastHz: resolveConfiguredSnapshotHz(env.SNAPSHOT_BROADCAST_HZ),
          durableObjectBindingReady: Boolean(env.SNOW_RUSH_ROOM),
          firebaseProjectConfigured: Boolean((env.FIREBASE_PROJECT_ID ?? '').trim()),
          firestoreNamedDbConfigured:
            firestoreDbId.length > 0 && firestoreDbId !== '(default)',
          originAllowlistCount: allowedOrigins.length,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const wsRouteMatch = /^\/ws\/snow-rush\/([^/]+)$/.exec(url.pathname);
    if (!wsRouteMatch) {
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!isOriginAllowed(originHeader, allowedOrigins)) {
      return new Response(JSON.stringify({ error: 'Forbidden Origin' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let roomId: string;
    try {
      roomId = decodeURIComponent(wsRouteMatch[1]);
    } catch {
      return new Response(JSON.stringify({ error: 'Malformed roomId URI encoding.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!isValidSnowRushRoomId(roomId)) {
      return new Response(JSON.stringify({ error: 'Invalid roomId format.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response(JSON.stringify({ error: 'Expected Upgrade: websocket header.' }), {
        status: 426,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1 Durable Object instance per verified Snow Rush `roomId`
    const doId = env.SNOW_RUSH_ROOM.idFromName(roomId);
    const stub = env.SNOW_RUSH_ROOM.get(doId);

    const forwardedHeaders = new Headers(request.headers);
    forwardedHeaders.set('X-Snow-Rush-Room-Id', roomId);

    const doRequest = new Request(request.url, {
      method: 'GET',
      headers: forwardedHeaders,
    });

    return stub.fetch(doRequest);
  },
};
