/**
 * /api/internal/games — the developer dashboard's view of its own games.
 *
 * The same registration as the registry surface, reached with the session the
 * browser already has instead of a token, so someone can register a game
 * before they have set up CI.
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import { listAchievements, listGamesOwnedBy } from "../../db/games.ts";
import { authenticateSession } from "../../lib/auth.ts";
import { registerFromRequest } from "../../lib/game_registration.ts";
import type { routes } from "../../routes.ts";
import { apiJson } from "../../utils/api.ts";

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

    return await registerFromRequest(
      requireDb(),
      auth.user.id,
      context.request,
    );
  },
} satisfies Action<typeof routes.internalGamesRegister>;
