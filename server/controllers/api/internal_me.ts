/**
 * GET /api/internal/me/achievements — the player's own record, summed up per
 * game.
 *
 * The counterpart to `/api/game/v1/me`, which is deliberately confined to one
 * game. This one is the hub's own page asking about its own player, so it sees
 * every game — but as a list of games, not a list of unlocks. A single unlock
 * is read on its game's page, next to the ones still to get.
 *
 * `points` and `unlocked` are the whole record, retired achievements included;
 * the per-game figures count only what each game still declares. See
 * `GameProgress`.
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import {
  listGameProgress,
  listUnlocks,
  totalPoints,
} from "../../db/unlocks.ts";
import { authenticateSession } from "../../lib/auth.ts";
import type { routes } from "../../routes.ts";
import { apiJson } from "../../utils/api.ts";

export const internalMeAchievementsAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const client = requireDb();
    const [games, unlocks, points] = await Promise.all([
      listGameProgress(client, auth.user.id),
      listUnlocks(client, auth.user.id),
      totalPoints(client, auth.user.id),
    ]);
    return apiJson({
      // For the link to the public page: the same record as others see it.
      handle: auth.user.handle,
      points,
      unlocked: unlocks.length,
      games,
    });
  },
} satisfies Action<typeof routes.internalMeAchievements>;
