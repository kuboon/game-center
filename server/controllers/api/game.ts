/**
 * `/api/game/v1` — what a running game may ask the hub.
 *
 * Every request carries a launch token, and every answer is confined to the
 * one game that token names. A game learns nothing about a player's other
 * games, and can unlock nothing outside its own manifest.
 *
 * CORS is wide open (see `middleware/game_cors.ts`), which is why the surface
 * carries its credential in a header rather than a cookie.
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import { listAchievements } from "../../db/games.ts";
import {
  listUnlocksForGame,
  UnknownAchievementError,
  unlockAchievement,
  unlockMany,
} from "../../db/unlocks.ts";
import { authenticateLaunch } from "../../lib/auth.ts";
import { isBulkBody, parseUnlocks } from "../../lib/unlock_body.ts";
import type { routes } from "../../routes.ts";
import { apiError, apiJson } from "../../utils/api.ts";

export const gameUnlockAction = {
  async handler(context) {
    const auth = await authenticateLaunch(context.request);
    if (!auth.ok) return auth.response;

    let body: { achievement?: unknown; score?: unknown; unlocks?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return apiError("Body must be JSON", 400);
    }

    // A game replaying what it kept while it could not reach the hub sends the
    // whole queue at once. One unknown key does not sink the rest, so the
    // answer is per entry rather than a status code.
    if (isBulkBody(body)) {
      const parsed = parseUnlocks(body.unlocks);
      if (!parsed.ok) return apiError(parsed.message, 400);
      const results = await unlockMany(
        requireDb(),
        auth.user.id,
        auth.launch.gameId,
        parsed.unlocks,
        "rest",
      );
      return apiJson({ results });
    }

    const key = body.achievement;
    if (typeof key !== "string" || !key) {
      return apiError("achievement is required", 400);
    }

    let score: number | null = null;
    if (body.score !== undefined && body.score !== null) {
      if (typeof body.score !== "number" || !Number.isInteger(body.score)) {
        return apiError("score must be an integer", 400);
      }
      score = body.score;
    }

    try {
      const result = await unlockAchievement(
        requireDb(),
        auth.user.id,
        auth.launch.gameId,
        key,
        { via: "rest", score },
      );
      return apiJson(result, { status: result.created ? 201 : 200 });
    } catch (error) {
      if (error instanceof UnknownAchievementError) {
        return apiError(error.message, 404);
      }
      throw error;
    }
  },
} satisfies Action<typeof routes.gameUnlock>;

export const gameMeAction = {
  async handler(context) {
    const auth = await authenticateLaunch(context.request);
    if (!auth.ok) return auth.response;

    // Only this game's unlocks: a game has no business knowing what else the
    // player has been playing.
    const unlocked = await listUnlocksForGame(
      requireDb(),
      auth.user.id,
      auth.launch.gameId,
    );
    return apiJson({
      player: { name: auth.user.displayName },
      achievements: unlocked.map((unlock) => ({
        key: unlock.key,
        unlockedAt: unlock.unlockedAt,
        score: unlock.score,
      })),
    });
  },
} satisfies Action<typeof routes.gameMe>;

export const gameAchievementsAction = {
  async handler(context) {
    const auth = await authenticateLaunch(context.request);
    if (!auth.ok) return auth.response;

    const client = requireDb();
    const gameId = auth.launch.gameId;
    const [defined, unlocked] = await Promise.all([
      listAchievements(client, gameId),
      listUnlocksForGame(client, auth.user.id, gameId),
    ]);
    const unlockedKeys = new Set(unlocked.map((unlock) => unlock.key));

    return apiJson({
      achievements: defined.map((achievement) => {
        // A hidden achievement keeps its wording secret until it is earned,
        // and the hub is the one place that can enforce that: the game's own
        // copy of the manifest has the text in it.
        const secret = achievement.hidden && !unlockedKeys.has(achievement.key);
        return {
          key: achievement.key,
          title: secret ? null : achievement.title,
          description: secret ? null : achievement.description,
          points: achievement.points,
          hidden: achievement.hidden,
          unlocked: unlockedKeys.has(achievement.key),
        };
      }),
    });
  },
} satisfies Action<typeof routes.gameAchievements>;
