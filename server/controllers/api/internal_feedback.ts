/**
 * Player feedback, from the player who writes it to the author who reads it.
 *
 * - `POST /api/internal/games/@{handle}/{slug}/feedback` — a signed-in player
 *   leaves a report on a game, and its author is told
 * - `GET /api/internal/feedback` — the author's inbox, across their games
 * - `DELETE /api/internal/feedback/{id}` — the author throws one away
 *
 * Everything is DPoP-authenticated. A report without a name would be the one
 * thing on the hub that nobody stands behind, and an inbox anyone could fill
 * anonymously would be read by nobody.
 */

import type { Action } from "@remix-run/fetch-router";

import { gameRef } from "@game-center/protocol";

import { requireDb } from "../../db/client.ts";
import {
  deleteFeedback,
  FEEDBACK_KINDS,
  type FeedbackKind,
  listFeedbackForOwner,
  MAX_FEEDBACK_LENGTH,
  submitFeedback,
} from "../../db/feedback.ts";
import { findGame } from "../../db/games.ts";
import { findUserById } from "../../db/users.ts";
import { authenticateSession } from "../../lib/auth.ts";
import { takeToken } from "../../lib/rate_limit.ts";
import { notify } from "../../lib/rp_notify.ts";
import type { routes } from "../../routes.ts";
import { apiError, apiJson } from "../../utils/api.ts";

/**
 * Reports per player per hour. Enough for someone with a real list of
 * problems; not enough to bury an author's inbox.
 */
const REPORTS_PER_WINDOW = 5;
const WINDOW_SECONDS = 60 * 60;

export const internalGameFeedbackAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const body = await readReport(context.request);
    if (!body.ok) return body.response;

    const { handle, slug } = context.params;
    const client = requireDb();
    const game = await findGame(client, gameRef(handle, slug));
    // A withdrawn game takes no new records of any kind; its author stepped
    // away from it, and a report would sit unread.
    if (!game || game.status !== "active") {
      return apiError("No such game", 404);
    }

    const quota = await takeToken(client, `feedback:${auth.user.id}`, {
      limit: REPORTS_PER_WINDOW,
      windowSeconds: WINDOW_SECONDS,
    });
    if (!quota.allowed) {
      const response = apiError("Too many reports", 429);
      response.headers.set("retry-after", String(quota.retryAfter));
      return response;
    }

    const id = await submitFeedback(client, {
      gameId: game.id,
      senderId: auth.user.id,
      kind: body.kind,
      message: body.message,
    });

    // An author trying their own form needs no phone buzzing about it.
    if (game.ownerId !== auth.user.id) {
      const owner = await findUserById(client, game.ownerId);
      if (owner) {
        // Awaited, like the follow notice: `notify` swallows its own
        // failures, and an isolate can end the moment the response is out.
        await notify([owner.externalId], {
          title: KIND_TITLES[body.kind],
          body: `${auth.user.displayName} さんから「${game.title}」へ`,
          url: "/dev",
        });
      }
    }

    return apiJson({ id }, { status: 201 });
  },
} satisfies Action<typeof routes.internalGameFeedback>;

export const internalFeedbackListAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const client = requireDb();
    return apiJson({
      feedback: await listFeedbackForOwner(client, auth.user.id),
    });
  },
} satisfies Action<typeof routes.internalFeedback>;

export const internalFeedbackDeleteAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const id = Number(context.params.id);
    if (!Number.isInteger(id)) return apiError("No such report", 404);

    const client = requireDb();
    // Someone else's report and a missing one answer the same, so the id
    // space says nothing about other authors' inboxes.
    if (!await deleteFeedback(client, auth.user.id, id)) {
      return apiError("No such report", 404);
    }
    return apiJson({ deleted: true });
  },
} satisfies Action<typeof routes.internalFeedbackDelete>;

/** The notification's title, by what the player said it was. */
const KIND_TITLES: Record<FeedbackKind, string> = {
  bug: "不具合の報告が届きました",
  request: "要望が届きました",
  other: "フィードバックが届きました",
};

type ReportBody =
  | { ok: true; kind: FeedbackKind; message: string }
  | { ok: false; response: Response };

async function readReport(request: Request): Promise<ReportBody> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: apiError("Body must be JSON", 400) };
  }
  const { kind, message } = (raw ?? {}) as {
    kind?: unknown;
    message?: unknown;
  };
  if (!FEEDBACK_KINDS.includes(kind as FeedbackKind)) {
    return {
      ok: false,
      response: apiError("kind must be bug, request or other", 400),
    };
  }
  const text = typeof message === "string" ? message.trim() : "";
  if (!text || text.length > MAX_FEEDBACK_LENGTH) {
    return {
      ok: false,
      response: apiError(
        `message must be 1 to ${MAX_FEEDBACK_LENGTH} characters`,
        400,
      ),
    };
  }
  return { ok: true, kind: kind as FeedbackKind, message: text };
}
