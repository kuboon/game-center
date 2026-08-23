/**
 * Games and their achievement definitions.
 *
 * Registering is an upsert of the whole manifest, which makes re-registering
 * harmless: sending the same document twice changes nothing.
 *
 * A game's id is its author's handle and the slug they chose: `kuboon/tetris`.
 * Scoping the slug that way means a name only has to be free among one author's
 * games, so nobody can take one out from under anybody, and an LLM writing a
 * manifest never has to guess whether a name is taken.
 *
 * Every game has an author, and separately a URL that may write to it. The two
 * answer different questions. `owner_id` is who made it — shown in the catalog,
 * followed by players, and established once by the author approving the
 * registration. `manifest_url` is where updates may come from, so CI can push
 * the same document on every commit without anyone approving again. A game
 * pasted into the dashboard has no such URL and is only ever edited there.
 *
 * Achievements are reconciled rather than replaced. A definition dropped from
 * the manifest is hidden, never deleted — players who already unlocked it keep
 * their row, and `user_achievements` keeps pointing at something real.
 */

import { type GameManifest, gameRef } from "@game-center/protocol";

import type { Client } from "./client.ts";

export interface Game {
  /** `{author handle}/{slug}`. Globally unique because handles are. */
  readonly id: string;
  /** The slug on its own, as the manifest wrote it. */
  readonly slug: string;
  /** The author. Always set: a game without one cannot be attributed. */
  readonly ownerId: number;
  /** Where updates may come from. Null for a game pasted into the dashboard. */
  readonly manifestUrl: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly url: string;
  readonly iconUrl: string | null;
  readonly status: "active" | "hidden";
}

export interface Achievement {
  readonly id: number;
  readonly gameId: string;
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
  readonly points: number;
  readonly hidden: boolean;
  readonly sortOrder: number;
}

/** Raised when a manifest names a slug that belongs to someone else. */
export class GameOwnershipError extends Error {
  override readonly name = "GameOwnershipError";
}

/**
 * Who is registering, and therefore what they are allowed to overwrite.
 *
 * The author is always known by the time this is built — either they approved
 * the registration or they pasted it themselves. `manifestUrl` says whether
 * this write came from the game's own URL.
 */
export interface Registrant {
  readonly ownerId: number;
  /** The author's handle, which qualifies the slug into an id. */
  readonly authorHandle: string;
  readonly manifestUrl?: string;
}

/** What an upsert did, so the caller can report it. */
export interface RegisterResult {
  readonly game: Game;
  /** True when this call claimed the slug. */
  readonly created: boolean;
  /** Achievement keys hidden because the manifest no longer lists them. */
  readonly retired: readonly string[];
}

/**
 * Register or update a game from its manifest.
 *
 * @param client Database to write to
 * @param registrant The author, and the manifest URL if it was fetched
 * @param manifest The validated manifest
 * @param gameUrl Where the game is played, already resolved to an absolute URL
 * @returns The stored game and what changed
 * @throws {GameOwnershipError} when the slug belongs to someone else
 */
export async function registerGame(
  client: Client,
  registrant: Registrant,
  manifest: GameManifest,
  gameUrl: string,
): Promise<RegisterResult> {
  const id = gameRef(registrant.authorHandle, manifest.id);
  const existing = await findGame(client, id);
  if (existing) assertMayWrite(existing, registrant, id);

  const iconUrl = manifest.iconUrl
    ? new URL(manifest.iconUrl, gameUrl).href
    : null;

  if (existing) {
    await client.execute({
      sql: `update games
              set title = ?, description = ?, url = ?, icon_url = ?,
                  updated_at = datetime('now')
            where id = ?`,
      args: [
        manifest.title,
        manifest.description ?? null,
        gameUrl,
        iconUrl,
        id,
      ],
    });
  } else {
    await client.execute({
      sql: `insert into games
              (id, owner_id, slug, manifest_url, title, description, url, icon_url)
            values (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        registrant.ownerId,
        manifest.id,
        registrant.manifestUrl ?? null,
        manifest.title,
        manifest.description ?? null,
        gameUrl,
        iconUrl,
      ],
    });
  }

  const retired = await reconcileAchievements(client, id, manifest);

  const game = await findGame(client, id);
  if (!game) {
    throw new Error(`Game ${id} vanished right after being written`);
  }
  return { game, created: !existing, retired };
}

/**
 * Refuse a registration for a slug that is already someone else's.
 *
 * The two kinds of ownership do not convert into one another: a URL cannot
 * take over a game an account registered, and an account cannot take over a
 * game that is being served from a URL. Either would let one path launder a
 * claim it could not make directly.
 */
function assertMayWrite(
  existing: Game,
  registrant: Registrant,
  id: string,
): void {
  if (existing.manifestUrl !== null) {
    // Updates come from the URL the author already approved. The author
    // themselves cannot overwrite it from elsewhere, because then a pasted
    // manifest could quietly replace what the URL is serving.
    if (registrant.manifestUrl === existing.manifestUrl) return;
    throw new GameOwnershipError(
      `The game id "${id}" is registered from ${existing.manifestUrl}`,
    );
  }
  if (!registrant.manifestUrl && registrant.ownerId === existing.ownerId) {
    return;
  }
  throw new GameOwnershipError(
    `The game id "${id}" is registered from the dashboard by someone else`,
  );
}

/**
 * Bring the stored achievements in line with the manifest.
 *
 * @returns Keys that were hidden because the manifest dropped them
 */
async function reconcileAchievements(
  client: Client,
  gameId: string,
  manifest: GameManifest,
): Promise<string[]> {
  const stored = await listAchievements(client, gameId, {
    includeRetired: true,
  });
  const byKey = new Map(stored.map((a) => [a.key, a]));

  for (const [index, achievement] of manifest.achievements.entries()) {
    if (byKey.has(achievement.key)) {
      await client.execute({
        sql: `update achievements
                set title = ?, description = ?, points = ?, hidden = ?,
                    sort_order = ?, retired = 0
              where game_id = ? and key = ?`,
        args: [
          achievement.title,
          achievement.description ?? null,
          achievement.points,
          achievement.hidden ? 1 : 0,
          index,
          gameId,
          achievement.key,
        ],
      });
    } else {
      await client.execute({
        sql: `insert into achievements
                (game_id, key, title, description, points, hidden, sort_order)
              values (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          gameId,
          achievement.key,
          achievement.title,
          achievement.description ?? null,
          achievement.points,
          achievement.hidden ? 1 : 0,
          index,
        ],
      });
    }
  }

  const declared = new Set(manifest.achievements.map((a) => a.key));
  const retired: string[] = [];
  for (const achievement of stored) {
    if (declared.has(achievement.key)) continue;
    retired.push(achievement.key);
    await client.execute({
      sql: "update achievements set retired = 1 where game_id = ? and key = ?",
      args: [gameId, achievement.key],
    });
  }
  return retired;
}

export async function findGame(
  client: Client,
  id: string,
): Promise<Game | null> {
  const result = await client.execute({
    sql: `${GAME_COLUMNS} where id = ?`,
    args: [id],
  });
  const row = result.rows[0];
  return row ? toGame(row) : null;
}

/** Every active game, newest first. */
export async function listGames(client: Client): Promise<Game[]> {
  const result = await client.execute(
    `${GAME_COLUMNS} where status = 'active' order by created_at desc`,
  );
  return result.rows.map(toGame);
}

/** A game plus the author to credit for it. */
export interface GameWithAuthor extends Game {
  readonly authorHandle: string | null;
  readonly authorName: string;
}

/**
 * The catalog: active games with their authors.
 *
 * Joined rather than fetched per game, since the catalog exists to show the
 * two together.
 */
export async function listGamesWithAuthors(
  client: Client,
): Promise<GameWithAuthor[]> {
  const result = await client.execute(
    `select games.id, games.owner_id, games.slug, games.manifest_url,
            games.title, games.description, games.url, games.icon_url,
            games.status,
            users.handle as author_handle, users.display_name as author_name
       from games
       join users on users.id = games.owner_id
      where games.status = 'active'
      order by games.created_at desc`,
  );
  return result.rows.map((row) => ({
    ...toGame(row),
    authorHandle: row.author_handle === null ? null : String(row.author_handle),
    authorName: String(row.author_name),
  }));
}

/** Games a player wrote, whatever their status. */
export async function listGamesOwnedBy(
  client: Client,
  ownerId: number,
): Promise<Game[]> {
  const result = await client.execute({
    sql: `${GAME_COLUMNS} where owner_id = ? order by created_at desc`,
    args: [ownerId],
  });
  return result.rows.map(toGame);
}

/**
 * A game's achievement definitions, in manifest order.
 *
 * Retired ones are left out unless asked for: they exist to keep old unlocks
 * meaningful, not to be shown as something still available.
 */
export async function listAchievements(
  client: Client,
  gameId: string,
  { includeRetired = false }: { includeRetired?: boolean } = {},
): Promise<Achievement[]> {
  const result = await client.execute({
    sql:
      `select id, game_id, key, title, description, points, hidden, sort_order
            from achievements
           where game_id = ?${includeRetired ? "" : " and retired = 0"}
           order by sort_order, id`,
    args: [gameId],
  });
  return result.rows.map((row) => ({
    id: Number(row.id),
    gameId: String(row.game_id),
    key: String(row.key),
    title: String(row.title),
    description: row.description === null ? null : String(row.description),
    points: Number(row.points),
    hidden: Number(row.hidden) === 1,
    sortOrder: Number(row.sort_order),
  }));
}

const GAME_COLUMNS =
  `select id, owner_id, slug, manifest_url, title, description, url, icon_url,
          status
     from games`;

function toGame(row: Record<string, unknown>): Game {
  return {
    id: String(row.id),
    slug: String(row.slug),
    ownerId: Number(row.owner_id),
    manifestUrl: row.manifest_url === null ? null : String(row.manifest_url),
    title: String(row.title),
    description: row.description === null ? null : String(row.description),
    url: String(row.url),
    iconUrl: row.icon_url === null ? null : String(row.icon_url),
    status: String(row.status) === "hidden" ? "hidden" : "active",
  };
}
