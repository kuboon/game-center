/**
 * /api/internal/games — the developer dashboard's own games and queue.
 *
 * Registering a URL is the same call the registry surface makes, just started
 * from a page instead of CI — and because the caller is signed in, a manifest
 * naming them needs no separate approval. Pasting is the path for a game the
 * hub cannot fetch. The queue is everything submitted by someone else that
 * claims this account as its author.
 */

import type { Action } from "@remix-run/fetch-router";
import { gameRef } from "@game-center/protocol";

import { requireDb } from "../../db/client.ts";
import {
  countUnlocksForGame,
  findGame,
  listAchievements,
  listGamesOwnedBy,
  restoreGame,
  retireGame,
} from "../../db/games.ts";
import {
  findPending,
  listPending,
  refusePending,
  removePending,
} from "../../db/registrations.ts";
import { authenticateSession } from "../../lib/auth.ts";
import {
  approveRegistration,
  registerFromPaste,
  registerFromUrl,
} from "../../lib/game_registration.ts";
import type { routes } from "../../routes.ts";
import { apiError, apiJson } from "../../utils/api.ts";

export const internalGamesAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const client = requireDb();
    const games = await listGamesOwnedBy(client, auth.user.id);
    const withAchievements = await Promise.all(games.map(async (game) => ({
      ...game,
      achievements: await listAchievements(client, game.id),
      // What removing it would mean. Sent with the list so the button can say
      // which of the two it is before anyone presses it.
      unlocks: await countUnlocksForGame(client, game.id),
    })));
    const pending = await listPending(client, auth.user.id);

    return apiJson({
      handle: auth.user.handle,
      games: withAchievements,
      pending: pending.map((entry) => ({
        id: entry.id,
        slug: entry.slug,
        title: entry.manifest.title,
        manifestUrl: entry.manifestUrl,
        gameUrl: entry.gameUrl,
        achievements: entry.manifest.achievements.length,
        submittedAt: entry.submittedAt,
      })),
    });
  },
} satisfies Action<typeof routes.internalGames>;

export const internalGamesRegisterAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    let body: { url?: unknown; manifest?: unknown };
    try {
      body = await context.request.json();
    } catch {
      return apiError("Body must be JSON", 400);
    }

    const client = requireDb();
    if (typeof body.url === "string" && body.url) {
      return await registerFromUrl(client, body.url, auth.user);
    }
    if (body.manifest !== undefined) {
      return await registerFromPaste(client, auth.user, body.manifest);
    }
    return apiError("Send either url or manifest", 400);
  },
} satisfies Action<typeof routes.internalGamesRegister>;

/**
 * POST /api/internal/registrations/{id} — yes, this game is mine.
 *
 * The half of a registration that only the named author can supply. The slug is
 * claimed here, which is why a queue of unapproved entries reserves nothing.
 */
export const internalApproveAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const client = requireDb();
    const id = Number(context.params.id);
    if (!Number.isInteger(id)) return apiError("Unknown registration", 404);

    const pending = await findPending(client, auth.user.id, id);
    if (!pending) return apiError("Unknown registration", 404);
    if (!auth.user.handle) {
      // Cannot happen: nothing reaches a queue without a handle to name it by.
      return apiError("Choose a handle before approving anything", 409);
    }

    const response = await approveRegistration(
      client,
      { ...auth.user, handle: auth.user.handle },
      pending,
    );
    // Left in the queue when the slug turned out to be taken, so the author can
    // see why and dismiss it themselves.
    if (response.ok) await removePending(client, auth.user.id, id);
    return response;
  },
} satisfies Action<typeof routes.internalApprove>;

/**
 * DELETE /api/internal/registrations/{id} — no, it is not.
 *
 * Anyone may submit a URL naming anyone as its author, so the queue needs a way
 * to say no that costs one click.
 */
export const internalDismissAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const id = Number(context.params.id);
    if (!Number.isInteger(id)) return apiError("Unknown registration", 404);

    const dismissed = await refusePending(requireDb(), auth.user.id, id);
    if (!dismissed) return apiError("Unknown registration", 404);
    return apiJson({ dismissed: true });
  },
} satisfies Action<typeof routes.internalDismiss>;

/**
 * Only the author, and only from the hub's own dashboard.
 *
 * Ownership is read from the row rather than from the URL: `@{handle}/{slug}`
 * is how the game is named, not proof of who wrote it. A game that is not
 * this account's answers 404 rather than 403 — whether somebody else's game
 * exists is not a question this endpoint is for.
 */
async function ownGame(
  context: { params: { handle: string; slug: string } },
  userId: number,
) {
  const gameId = gameRef(context.params.handle, context.params.slug);
  const game = await findGame(requireDb(), gameId);
  return game && game.ownerId === userId ? game : null;
}

export const internalGameRetireAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const game = await ownGame(context, auth.user.id);
    if (!game) return apiError("Unknown game", 404);

    const outcome = await retireGame(requireDb(), game.id);
    return apiJson({ outcome });
  },
} satisfies Action<typeof routes.internalGameRetire>;

export const internalGameRestoreAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const game = await ownGame(context, auth.user.id);
    if (!game) return apiError("Unknown game", 404);

    await restoreGame(requireDb(), game.id);
    return apiJson({ status: "active" });
  },
} satisfies Action<typeof routes.internalGameRestore>;
