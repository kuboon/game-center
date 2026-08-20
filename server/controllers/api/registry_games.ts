/**
 * POST /api/registry/v1/games — register a game from CI.
 *
 * This is the surface the GitHub Action posts `gamecenter.json` to. It carries
 * an API token rather than a DPoP proof, because there is no browser and no
 * key in the runner, and it sends no CORS headers: a token belongs in a
 * secret store, never in a page.
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import { authenticateApiToken } from "../../lib/auth.ts";
import { registerFromRequest } from "../../lib/game_registration.ts";
import type { routes } from "../../routes.ts";

export const registryGamesAction = {
  async handler(context) {
    const auth = await authenticateApiToken(context.request);
    if (!auth.ok) return auth.response;

    return await registerFromRequest(
      requireDb(),
      auth.user.id,
      context.request,
    );
  },
} satisfies Action<typeof routes.registryGames>;
