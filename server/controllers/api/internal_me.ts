/**
 * GET /api/internal/me/achievements — the player's own record, across games.
 *
 * The counterpart to `/api/game/v1/me`, which is deliberately confined to one
 * game. This one is the hub's own page asking about its own player, so it sees
 * everything.
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import { listUnlocks, totalPoints } from "../../db/unlocks.ts";
import { authenticateSession } from "../../lib/auth.ts";
import type { routes } from "../../routes.ts";
import { apiJson } from "../../utils/api.ts";

export const internalMeAchievementsAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const client = requireDb();
    const [unlocks, points] = await Promise.all([
      listUnlocks(client, auth.user.id),
      totalPoints(client, auth.user.id),
    ]);
    return apiJson({ unlocks, points });
  },
} satisfies Action<typeof routes.internalMeAchievements>;
