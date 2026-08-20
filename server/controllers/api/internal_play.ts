/**
 * `/api/internal/launch` and `/api/internal/claim` — the two places the hub's
 * own pages turn a signed-in player into something a game can use.
 *
 * Launching mints a token and hands back the URL to open. Claiming is the
 * fallback path: a game that cannot fetch anything sends the player here with
 * a link, and the player confirms the unlock themselves.
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import { findGame } from "../../db/games.ts";
import {
  UnknownAchievementError,
  unlockAchievement,
} from "../../db/unlocks.ts";
import { authenticateSession } from "../../lib/auth.ts";
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

    let body: { gameId?: unknown; key?: unknown; score?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return apiError("Body must be JSON", 400);
    }
    if (typeof body.gameId !== "string" || !body.gameId) {
      return apiError("gameId is required", 400);
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
