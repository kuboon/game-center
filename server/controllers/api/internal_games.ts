/**
 * /api/internal/games — the developer dashboard's own games.
 *
 * Two ways in. Registering a URL is the same call the registry surface makes,
 * just started from a page instead of CI. Pasting a manifest is the path for a
 * game the hub cannot fetch, and it is the only one that ties a game to an
 * account.
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import { listAchievements, listGamesOwnedBy } from "../../db/games.ts";
import { authenticateSession } from "../../lib/auth.ts";
import {
  registerFromPaste,
  registerFromUrl,
} from "../../lib/game_registration.ts";
import type { routes } from "../../routes.ts";
import { apiError, apiJson } from "../../utils/api.ts";

export const internalGamesAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const client = requireDb();
    const games = await listGamesOwnedBy(client, auth.user.id);
    const withAchievements = await Promise.all(games.map(async (game) => ({
      ...game,
      achievements: await listAchievements(client, game.id),
    })));
    return apiJson({ games: withAchievements });
  },
} satisfies Action<typeof routes.internalGames>;

export const internalGamesRegisterAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    let body: { url?: unknown; manifest?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return apiError("Body must be JSON", 400);
    }

    const client = requireDb();
    if (typeof body.url === "string" && body.url) {
      return await registerFromUrl(client, body.url);
    }
    if (body.manifest !== undefined) {
      return await registerFromPaste(client, auth.user.id, body.manifest);
    }
    return apiError("Send either url or manifest", 400);
  },
} satisfies Action<typeof routes.internalGamesRegister>;
