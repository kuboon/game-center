/**
 * `/api/internal/launch` and `/api/internal/claim` — the two places the hub's
 * own pages turn a signed-in player into something a game can use.
 *
 * Launching mints a token and hands back the URL to open. Claiming is the
 * fallback path: a game that could not reach the hub sends the player here
 * with a link naming everything it has waiting, and the player confirms.
 *
 * Confirming is two calls, because the player is shown what will happen before
 * it happens. `preview` reads: it turns the keys in the link into titles and
 * says which are already recorded. `claim` writes. Neither trusts the link —
 * the keys come from a page the game controls, so the hub answers only for
 * achievements its own manifest declares.
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import { findGame, listAchievements } from "../../db/games.ts";
import {
  listUnlocksForGame,
  UnknownAchievementError,
  unlockAchievement,
  unlockMany,
} from "../../db/unlocks.ts";
import { authenticateSession } from "../../lib/auth.ts";
import {
  isBulkBody,
  MAX_UNLOCKS_PER_CALL,
  parseUnlocks,
} from "../../lib/unlock_body.ts";
import {
  launchUrl,
  mintLaunchToken,
  SigningKeyMissingError,
} from "../../lib/launch_token.ts";
import type { routes } from "../../routes.ts";
import { apiError, apiJson } from "../../utils/api.ts";

export const internalLaunchAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    let gameId: unknown;
    try {
      ({ gameId } = await context.request.json() as { gameId?: unknown });
    } catch {
      return apiError("Body must be JSON", 400);
    }
    if (typeof gameId !== "string" || !gameId) {
      return apiError("gameId is required", 400);
    }

    const game = await findGame(requireDb(), gameId);
    if (!game) return apiError("Unknown game", 404);

    try {
      const token = await mintLaunchToken(auth.user.id, game.id);
      return apiJson({ url: launchUrl(game.url, token) });
    } catch (error) {
      if (error instanceof SigningKeyMissingError) {
        return apiError(error.message, 503);
      }
      throw error;
    }
  },
} satisfies Action<typeof routes.internalLaunch>;

export const internalClaimAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    let body: {
      gameId?: unknown;
      key?: unknown;
      score?: unknown;
      unlocks?: unknown;
    };
    try {
      body = await context.request.json();
    } catch {
      return apiError("Body must be JSON", 400);
    }
    if (typeof body.gameId !== "string" || !body.gameId) {
      return apiError("gameId is required", 400);
    }

    if (isBulkBody(body)) {
      const parsed = parseUnlocks(body.unlocks);
      if (!parsed.ok) return apiError(parsed.message, 400);
      const results = await unlockMany(
        requireDb(),
        auth.user.id,
        body.gameId,
        parsed.unlocks,
        "claim",
      );
      return apiJson({ results });
    }

    if (typeof body.key !== "string" || !body.key) {
      return apiError("key is required", 400);
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
        body.gameId,
        body.key,
        { via: "claim", score },
      );
      return apiJson(result, { status: result.created ? 201 : 200 });
    } catch (error) {
      if (error instanceof UnknownAchievementError) {
        return apiError(error.message, 404);
      }
      throw error;
    }
  },
} satisfies Action<typeof routes.internalClaim>;

export const internalClaimPreviewAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    let body: { gameId?: unknown; keys?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return apiError("Body must be JSON", 400);
    }
    if (typeof body.gameId !== "string" || !body.gameId) {
      return apiError("gameId is required", 400);
    }
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      return apiError("keys must be a non-empty array", 400);
    }
    if (body.keys.length > MAX_UNLOCKS_PER_CALL) {
      return apiError(
        `keys must hold at most ${MAX_UNLOCKS_PER_CALL} entries`,
        400,
      );
    }
    if (!body.keys.every((key) => typeof key === "string" && key)) {
      return apiError("keys must be strings", 400);
    }

    const client = requireDb();
    const game = await findGame(client, body.gameId);
    if (!game) return apiError("Unknown game", 404);

    const [defined, unlocked] = await Promise.all([
      listAchievements(client, game.id),
      listUnlocksForGame(client, auth.user.id, game.id),
    ]);
    const byKey = new Map(defined.map((a) => [a.key, a]));
    const already = new Map(unlocked.map((u) => [u.key, u]));

    // Only what the link named, and only what the manifest declares. A key the
    // hub does not know is answered as unknown rather than dropped: the player
    // is about to be told what will be recorded, and a line that quietly
    // disappears is worse than one that says it cannot be recorded.
    const items = (body.keys as string[]).map((key) => {
      const achievement = byKey.get(key);
      if (!achievement) return { key, known: false as const };
      const have = already.get(key);
      return {
        key,
        known: true as const,
        title: achievement.title,
        description: achievement.description,
        points: achievement.points,
        hidden: achievement.hidden,
        unlocked: have !== undefined,
        score: have?.score ?? null,
      };
    });

    return apiJson({ game: { id: game.id, title: game.title }, items });
  },
} satisfies Action<typeof routes.internalClaimPreview>;
