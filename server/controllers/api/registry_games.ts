/**
 * POST /api/registry/v1/games — register the game published at a URL.
 *
 * Unauthenticated on purpose. The only thing this endpoint does is make the
 * hub re-read a document that its author already chose to publish. What decides
 * whether that document may write is its location, and what decides whose game
 * it is, is the author approving it — neither of which a credential here would
 * add anything to.
 *
 * Which is why the GitHub Action is a bare POST with no secret in it. A
 * first-time submission answers 202 and waits for the author; every later one
 * updates the game outright.
 *
 * It is also why this is the one endpoint with a rate limit. Each call makes
 * the hub retrieve a URL somebody else chose, with the hub's own address on
 * the request — so what needs a ceiling is not the queue, which is already
 * bounded per author, but the fetching. The limit is generous enough that CI
 * pushing on every commit never notices it.
 */

/** Calls per address per window. A repository pushing on every commit is far
 * below this; a script walking a URL list is not. */
const SUBMISSIONS_PER_WINDOW = 30;
const WINDOW_SECONDS = 60;

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import { registerFromUrl } from "../../lib/game_registration.ts";
import { callerAddress, takeToken } from "../../lib/rate_limit.ts";
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

    // Counted before the fetch, not after: the cost being limited is the
    // outbound request, so a refused call must not make it.
    const quota = await takeToken(client, callerAddress(context.request), {
      limit: SUBMISSIONS_PER_WINDOW,
      windowSeconds: WINDOW_SECONDS,
    });
    if (!quota.allowed) {
      const response = apiError("Too many submissions", 429);
      response.headers.set("retry-after", String(quota.retryAfter));
      return response;
    }

    return await registerFromUrl(client, url);
  },
} satisfies Action<typeof routes.registryGames>;
