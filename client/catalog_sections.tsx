/**
 * CatalogSections — the part of the catalog that is yours, as a `clientEntry`.
 *
 * The catalog below this is server-rendered and identical for everyone, which
 * is what lets it be read and indexed without JavaScript. These two sections
 * cannot be: they come from who you follow, and SSR carries no DPoP proof.
 *
 * Nothing is rendered until there is something to say. A signed-out visitor,
 * a player who follows nobody, and a player whose follows have not played
 * anything all get the same thing: the plain catalog, with no empty headings
 * above it explaining what they are missing.
 */

import {
  clientEntry,
  type Handle,
  type SerializableValue,
} from "@remix-run/ui";

import { mountSession, sessionStore } from "./session.ts";

export interface CatalogSectionsProps {
  [key: string]: SerializableValue;
}

interface CatalogCard {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  authorHandle: string | null;
  authorName: string;
}

interface Catalog {
  byFollowedAuthors: CatalogCard[];
  playedByFollowed: CatalogCard[];
}

export const CatalogSections = clientEntry(
  "/catalog_sections.js#CatalogSections",
  function CatalogSections(handle: Handle<CatalogSectionsProps>) {
    let catalog: Catalog | null = null;
    /** Whose session `catalog` belongs to, so a re-render does not re-ask. */
    let loadedFor: string | null = null;

    const load = async () => {
      const userId = sessionStore.userId;
      if (!userId) {
        loadedFor = null;
        catalog = null;
        return handle.update();
      }
      if (loadedFor === userId) return;
      loadedFor = userId;

      const fetchDpop = sessionStore.fetchDpop;
      if (!fetchDpop) return;
      const response = await fetchDpop("/api/internal/catalog");
      if (response.ok) catalog = await response.json() as Catalog;
      handle.update();
    };

    mountSession(handle, () => load());

    return () => {
      if (!catalog) return null;
      const sections: Array<[string, CatalogCard[]]> = [
        ["フォロー中の作者", catalog.byFollowedAuthors],
        ["フォロー中の人が遊んでいる", catalog.playedByFollowed],
      ];
      const filled = sections.filter(([, games]) => games.length > 0);
      if (filled.length === 0) return null;

      return (
        <div class="space-y-6">
          {filled.map(([title, games]) => (
            <section key={title} class="space-y-3">
              <h2 class="text-xl font-bold">{title}</h2>
              <ul class="grid gap-4 sm:grid-cols-2">{games.map(card)}</ul>
            </section>
          ))}
        </div>
      );
    };
  },
);

/**
 * One card, matching the server-rendered ones below it.
 *
 * A plain function rather than a component, for the same reason `gameCard` in
 * home.tsx is one: static markup does not need a handle and a render function.
 */
function card(game: CatalogCard) {
  const author = game.authorHandle;
  return (
    <li key={game.id} class="card card-border bg-base-100">
      <div class="card-body">
        <h2 class="card-title">
          <a
            class="link link-hover"
            href={`/@${author ?? ""}/${game.slug}`}
            data-rmx-target="content"
          >
            {game.title}
          </a>
        </h2>
        {game.description ? <p class="text-sm">{game.description}</p> : null}
        <p class="text-sm opacity-70">
          {author
            ? (
              <a class="link" href={`/@${author}`} data-rmx-target="content">
                {game.authorName}
              </a>
            )
            : game.authorName}
        </p>
      </div>
    </li>
  );
}
