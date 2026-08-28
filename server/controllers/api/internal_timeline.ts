/**
 * GET /api/internal/timeline — what the people you follow have been doing.
 *
 * The main thing on `/me`, and necessarily a fetch rather than SSR: the feed is
 * built from the caller's follow graph and a server-rendered document carries
 * no DPoP proof.
 *
 * Hidden achievements arrive already masked from `listFollowedTimeline`. That
 * is not the page's job — a title stripped in the browser is a title that was
 * still sent.
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import { listFollowedTimeline } from "../../db/timeline.ts";
import { authenticateSession } from "../../lib/auth.ts";
import type { routes } from "../../routes.ts";
import { apiJson } from "../../utils/api.ts";

/** Enough to be a feed, few enough to be one response. */
const LIMIT = 40;

export const internalTimelineAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const events = await listFollowedTimeline(requireDb(), auth.user.id, LIMIT);
    return apiJson({ events });
  },
} satisfies Action<typeof routes.internalTimeline>;
