/**
 * The API surface.
 *
 * Wires the domain services to HTTP and nothing more: every decision about
 * whether something is allowed lives in `domain/`, so the same rules hold if a
 * WebSocket layer calls them in Phase 3.
 *
 * @typedef {object} Deps
 * @property {object} db
 * @property {object} config
 */

import { createServer } from 'node:http';

import { createAuth } from './domain/auth.js';
import { createEconomy, createWorldCache } from './domain/economy.js';
import { catalogueFor } from './domain/upgrades.js';
import { createCacheRepo } from './repo/caches.js';
import { createPlayerRepo } from './repo/players.js';
import { createTransactionRepo } from './repo/transactions.js';
import { createRateLimiter } from './middleware/rate-limit.js';
import { readJsonBody } from './http/body.js';
import { createRouter } from './http/router.js';
import { sendError, sendJson } from './http/respond.js';

/** Everything the client is allowed to know about itself. */
function publicPlayer(player) {
  return {
    id: player.id,
    displayName: player.displayName,
    worldSeed: player.worldSeed,
    glideStats: player.glideStats,
    materials: player.materials,
    currencySoft: player.currencySoft,
    currencyHard: player.currencyHard,
    inventoryCosmetics: player.inventoryCosmetics,
    equippedCosmetics: player.equippedCosmetics,
    lastPosition: player.lastPosition,
    createdAt: player.createdAt,
  };
}

function clientKey(req) {
  // Behind a proxy this needs the forwarded header; direct, it is the socket.
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (!/^bearer$/i.test(scheme ?? '') || !token) return null;
  return token;
}

export function createApp({ db, config }) {
  const players = createPlayerRepo(db);
  const transactions = createTransactionRepo(db);
  const caches = createCacheRepo(db);
  const worlds = createWorldCache();

  const auth = createAuth({ db, players, config });
  const economy = createEconomy({ db, players, transactions, caches, config, worlds });

  const authLimiter = createRateLimiter({
    windowSeconds: config.rateLimit.windowSeconds,
    max: config.rateLimit.authMax,
  });
  const economyLimiter = createRateLimiter({
    windowSeconds: config.rateLimit.windowSeconds,
    max: config.rateLimit.economyMax,
  });

  const router = createRouter();

  router.get('/healthz', async (_req, res) => {
    await db.query('SELECT 1');
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/auth/register', async (req, res) => {
    if (!allow(authLimiter, clientKey(req), res)) return;
    const body = await readJsonBody(req);
    if (!body.ok) return sendError(res, body.reason);

    const result = await auth.register({ displayName: body.value.displayName });
    if (!result.ok) return sendError(res, result.reason);

    sendJson(res, 201, { token: result.token, player: publicPlayer(result.player) });
  });

  router.post('/api/auth/logout', withPlayer(async (req, res, { token }) => {
    await auth.revoke(token);
    sendJson(res, 200, { ok: true });
  }));

  router.get('/api/player/me', withPlayer(async (_req, res, { playerId }) => {
    const player = await players.findById(playerId);
    if (!player) return sendError(res, 'unknown_player');
    sendJson(res, 200, { player: publicPlayer(player) });
  }));

  router.post('/api/player/position', withPlayer(async (req, res, { playerId }) => {
    const body = await readJsonBody(req);
    if (!body.ok) return sendError(res, body.reason);

    const { x, y, z } = body.value.position ?? {};
    if (![x, y, z].every((n) => Number.isFinite(n))) {
      return sendError(res, 'malformed_position');
    }
    // Client-reported and low stakes (§6.1): a spoofed position only affects
    // where other players see you. It still anchors the plausibility check,
    // so moving it far and fast is exactly what that check is looking for.
    await players.savePosition(playerId, { x, y, z }, new Date());
    sendJson(res, 200, { ok: true });
  }));

  router.get('/api/shop/catalog', withPlayer(async (_req, res, { playerId }) => {
    const player = await players.findById(playerId);
    if (!player) return sendError(res, 'unknown_player');
    sendJson(res, 200, { upgrades: catalogueFor(player.glideStats) });
  }));

  router.post('/api/collect', withPlayer(async (req, res, { playerId }) => {
    if (!allow(economyLimiter, playerId, res)) return;
    const body = await readJsonBody(req);
    if (!body.ok) return sendError(res, body.reason);

    const result = await economy.collect({
      playerId,
      claim: { cacheId: body.value.cacheId, position: body.value.position },
    });
    if (!result.ok) return sendError(res, result.reason, result.detail);

    // The authoritative totals. The client's provisional tally is replaced by
    // this, never added to it.
    sendJson(res, 200, {
      credited: result.credited,
      materials: result.player.materials,
      player: publicPlayer(result.player),
    });
  }));

  router.post('/api/shop/purchase', withPlayer(async (req, res, { playerId }) => {
    if (!allow(economyLimiter, playerId, res)) return;
    const body = await readJsonBody(req);
    if (!body.ok) return sendError(res, body.reason);

    const result = await economy.purchase({ playerId, upgradeKey: body.value.upgrade });
    if (!result.ok) return sendError(res, result.reason, result.missing ?? result.detail);

    sendJson(res, 200, {
      purchased: result.purchased,
      player: publicPlayer(result.player),
    });
  }));

  router.get('/api/player/transactions', withPlayer(async (req, res, { playerId }) => {
    const url = new URL(req.url, 'http://localhost');
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
    const rows = await transactions.listForPlayer(playerId, {
      limit: Number.isFinite(limit) ? limit : 50,
    });
    sendJson(res, 200, { transactions: rows });
  }));

  function allow(limiter, key, res) {
    const verdict = limiter.check(key);
    if (verdict.allowed) return true;
    res.setHeader('retry-after', String(verdict.retryAfter));
    sendError(res, 'rate_limited');
    return false;
  }

  /** Wrap a handler so it only runs for a caller with a valid session. */
  function withPlayer(handler) {
    return async (req, res) => {
      const token = bearerToken(req);
      if (!token) return sendError(res, 'unauthorized');
      const playerId = await auth.playerIdForToken(token);
      if (!playerId) return sendError(res, 'unauthorized');
      return handler(req, res, { playerId, token });
    };
  }

  function applyCors(req, res) {
    const origin = req.headers.origin;
    const allowed = config.corsOrigins.includes('*')
      ? (origin ?? '*')
      : config.corsOrigins.find((candidate) => candidate === origin);
    if (!allowed) return;
    res.setHeader('access-control-allow-origin', allowed);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  }

  async function handle(req, res) {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const { pathname } = new URL(req.url, 'http://localhost');
    const route = router.match(req.method, pathname);
    if (!route) {
      return sendError(res, router.hasPath(pathname) ? 'not_found' : 'not_found');
    }

    try {
      await route.handler(req, res);
    } catch (error) {
      // Log for us, say nothing useful to them.
      console.error('[glidewood] unhandled error', { path: pathname, error });
      if (!res.headersSent) sendError(res, 'internal_error');
    }
  }

  return {
    handle,
    router,
    services: { auth, economy, players, transactions, caches, worlds },
    listen(port, host) {
      const server = createServer(handle);
      return new Promise((resolve) => {
        server.listen(port, host, () => resolve(server));
      });
    },
  };
}
