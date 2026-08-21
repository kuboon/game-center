/**
 * POST /api/registry/v1/games — register the game published at a URL.
 *
 * Unauthenticated on purpose. The only thing this endpoint does is make the
 * hub re-read a document that its author already chose to publish, and the
 * document's location is what decides whether it may write. There is nothing a
 * credential would add, and the credential is the step a game's author cannot
 * automate.
 *
 * Which is why the GitHub Action is a bare POST with no secret in it.
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import { registerFromUrl } from "../../lib/game_registration.ts";
import type { routes } from "../../routes.ts";
import { apiError } from "../../utils/api.ts";

export const registryGamesAction = {
  async handler(context) {
    let url: unknown;
    try {
      ({ url } = await context.request.json() as { url?: unknown });
    } catch {
      return apiError("Body must be JSON", 400);
    }
    if (typeof url !== "string" || !url) {
      return apiError("url is required", 400);
    }

    const client = requireDb();
    return await registerFromUrl(client, url);
  },
} satisfies Action<typeof routes.registryGames>;
