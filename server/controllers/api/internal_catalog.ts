/**
 * GET /api/internal/catalog — the parts of the catalog that depend on who is
 * asking.
 *
 * The catalog itself is server-rendered and the same for everyone, which is
 * what makes it readable and indexable without JavaScript. These two sections
 * cannot be: they are built from the caller's follow graph, and SSR carries no
 * DPoP proof. So they arrive here instead and are rendered above the page's own
 * listing once the browser has a session.
 *
 * There is nothing global in either of them. The hub has no popularity ranking
 * to offer and will not have one — see docs/grand_design.md, "偽装は防がない、
 * 代わりに誰を見るかを選ばせる".
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import {
  type GameWithAuthor,
  listGamesByFollowedAuthors,
  listGamesPlayedByFollowed,
} from "../../db/games.ts";
import { authenticateSession } from "../../lib/auth.ts";
import type { routes } from "../../routes.ts";
import { apiJson } from "../../utils/api.ts";

/** Only what a card needs, so the response does not carry manifest URLs around. */
interface CatalogCard {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly authorHandle: string | null;
  readonly authorName: string;
}

export const internalCatalogAction = {
  async handler(context) {
    const auth = await authenticateSession(context);
    if (!auth.ok) return auth.response;

    const client = requireDb();
    const [byFollowedAuthors, playedByFollowed] = await Promise.all([
      listGamesByFollowedAuthors(client, auth.user.id),
      listGamesPlayedByFollowed(client, auth.user.id),
    ]);

    return apiJson({
      byFollowedAuthors: byFollowedAuthors.map(toCard),
      playedByFollowed: playedByFollowed.map(toCard),
    });
  },
} satisfies Action<typeof routes.internalCatalog>;

function toCard(game: GameWithAuthor): CatalogCard {
  return {
    id: game.id,
    slug: game.slug,
    title: game.title,
    description: game.description,
    authorHandle: game.authorHandle,
    authorName: game.authorName,
  };
}
