/**
 * `/api/internal/follows` — who this player has chosen to watch.
 *
 * A follow is the hub's answer to a problem it cannot solve: a game runs in a
 * browser, so an unlock is a claim rather than a fact, and no amount of
 * server-side checking changes that. Rather than pretend to verify, the hub
 * lets each player decide whose claims they want to see. That makes this a
 * per-player surface, DPoP-authenticated like the rest of `/api/internal`.
 *
 * Both writes are idempotent, so the button can send what the player asked for
 * without first reading what is already true.
 */

import type { Action } from "@remix-run/fetch-router";

import { type Client, requireDb } from "../../db/client.ts";
import {
  countFollows,
  follow,
  isFollowing,
  SelfFollowError,
  unfollow,
} from "../../db/follows.ts";
import { countUnseenFollowers } from "../../db/follows.ts";
import { findUserByHandle } from "../../db/users.ts";
import { authenticateSession } from "../../lib/auth.ts";
import { notify } from "../../lib/rp_notify.ts";
import type { routes } from "../../routes.ts";
import { apiError, apiJson } from "../../utils/api.ts";

/** POST /api/internal/follows — `{ handle }`. */
export const internalFollowAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const body = await readHandle(context.request);
    if (!body.ok) return body.response;

    const client = requireDb();
    const target = await findUserByHandle(client, body.handle);
    if (!target) return apiError("No such player", 404);

    try {
      const created = await follow(client, auth.user.id, target.id);
      // Only on the call that created it: the button is idempotent, and a
      // second press must not be a second notification.
      if (created) {
        await announce(client, auth.user.displayName, target);
      }
      return apiJson(
        {
          following: true,
          self: false,
          ...await countFollows(client, target.id),
        },
        { status: created ? 201 : 200 },
      );
    } catch (error) {
      if (error instanceof SelfFollowError) {
        return apiError("Cannot follow yourself", 400);
      }
      throw error;
    }
  },
} satisfies Action<typeof routes.internalFollow>;

/** DELETE /api/internal/follows/@{handle}. */
export const internalUnfollowAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const client = requireDb();
    const target = await findUserByHandle(client, context.params.handle);
    if (!target) return apiError("No such player", 404);

    await unfollow(client, auth.user.id, target.id);
    return apiJson({
      following: false,
      self: target.id === auth.user.id,
      ...await countFollows(client, target.id),
    });
  },
} satisfies Action<typeof routes.internalUnfollow>;

/**
 * GET /api/internal/follows/@{handle} — what the follow button should show.
 *
 * All three of these answer the same shape — `following`, `self`, and both
 * counts — so the button can replace its state with any response rather than
 * merging one into another and reasoning about which fields came from where.
 */
export const internalFollowStateAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const client = requireDb();
    const target = await findUserByHandle(client, context.params.handle);
    if (!target) return apiError("No such player", 404);

    const [following, counts] = await Promise.all([
      isFollowing(client, auth.user.id, target.id),
      countFollows(client, target.id),
    ]);
    // `self` rather than an absent button: the client should be able to tell
    // "you cannot follow yourself" from "we do not know yet".
    return apiJson({ following, self: target.id === auth.user.id, ...counts });
  },
} satisfies Action<typeof routes.internalFollowState>;

type HandleBody =
  | { readonly ok: true; readonly handle: string }
  | { readonly ok: false; readonly response: Response };

/**
 * Tell someone they have a new follower.
 *
 * The badge carries the same number `/me` and the navbar show, so a phone icon
 * and the page agree. Counted after the follow is written, which is why it is
 * the count and not an increment.
 *
 * Awaited rather than fired and forgotten: `notify` swallows its own failures,
 * and Deno Deploy can end an isolate the moment a response is returned, which
 * would cut a dangling promise off mid-flight.
 */
async function announce(
  client: Client,
  follower: string,
  target: { id: number; externalId: string },
): Promise<void> {
  const unseen = await countUnseenFollowers(client, target.id);
  await notify([target.externalId], {
    title: "新しいフォロワー",
    body: `${follower} さんがあなたをフォローしました`,
    // Straight to the list the badge is counting.
    url: "/me",
    badgeCount: unseen,
  });
}

async function readHandle(request: Request): Promise<HandleBody> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: apiError("Body must be JSON", 400) };
  }
  const handle = (body as { handle?: unknown } | null)?.handle;
  if (typeof handle !== "string" || !handle) {
    return { ok: false, response: apiError("handle is required", 400) };
  }
  return { ok: true, handle };
}
