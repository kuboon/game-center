/**
 * `GET /api/internal/dev/attention` — what is waiting for you on `/dev`, as
 * two numbers for the navbar's badge.
 *
 * - `pending`: submissions naming you as author. Counted whether or not you
 *   have seen them, because seeing one does not deal with it — a CI run is
 *   stuck on a 202 until you approve or refuse, and either clears it.
 * - `feedback`: reports that arrived since you last opened the inbox. Reports
 *   stay until you delete them, so counting all of them would keep the badge
 *   lit for one you are keeping as a reminder.
 *
 * Reading this marks nothing seen; the navbar asks on every page.
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import { countUnseenFeedback } from "../../db/feedback.ts";
import { countPending } from "../../db/registrations.ts";
import { authenticateSession } from "../../lib/auth.ts";
import type { routes } from "../../routes.ts";
import { apiJson } from "../../utils/api.ts";

export const internalDevAttentionAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const client = requireDb();
    const [pending, feedback] = await Promise.all([
      countPending(client, auth.user.id),
      countUnseenFeedback(client, auth.user.id),
    ]);
    return apiJson({ pending, feedback });
  },
} satisfies Action<typeof routes.internalDevAttention>;
