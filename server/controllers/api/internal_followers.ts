/**
 * `/api/internal/followers` — who follows you, and which of them are new.
 *
 * The counterpart to the timeline. That one answers "what did the people I
 * follow do"; this one answers the thing a player cannot find by retracing
 * their own steps, because it happened to them rather than because of them.
 *
 * **Reading does not mark anything seen.** The navbar asks this on every page
 * load to decide whether to show a dot, and a read that clears the dot would
 * clear it before anyone had seen a name. Marking is its own call, sent by the
 * page that actually rendered the list — "seen" means shown to a person.
 *
 * A player's followers are shown to that player alone. The counts are public
 * on `/@{handle}`; naming the people is a different question, and nobody has
 * asked it.
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import { listFollowers, markFollowersSeen } from "../../db/follows.ts";
import { authenticateSession } from "../../lib/auth.ts";
import type { routes } from "../../routes.ts";
import { apiError, apiJson } from "../../utils/api.ts";

/** Enough to be a list, few enough to be one response. */
const LIMIT = 50;

export const internalFollowersAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const followers = await listFollowers(requireDb(), auth.user.id, LIMIT);
    return apiJson({
      followers,
      unseen: followers.filter((follower) => follower.unseen).length,
    });
  },
} satisfies Action<typeof routes.internalFollowers>;

export const internalFollowersSeenAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    let through: unknown;
    try {
      ({ through } = await context.request.json() as { through?: unknown });
    } catch {
      return apiError("Body must be JSON", 400);
    }
    if (typeof through !== "string" || !through) {
      return apiError("through is required", 400);
    }

    // The caller says how far it got rather than the server assuming "now", so
    // a follow arriving between the read and this call stays new. Showing a
    // notification twice is cheaper than losing one.
    await markFollowersSeen(requireDb(), auth.user.id, through);
    return apiJson({ ok: true });
  },
} satisfies Action<typeof routes.internalFollowersSeen>;
