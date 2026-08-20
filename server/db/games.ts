/**
 * Games and their achievement definitions.
 *
 * Registering is an upsert of the whole manifest, which makes re-registering
 * harmless: sending the same document twice changes nothing.
 *
 * A game belongs either to a manifest URL or to an account, never both. A game
 * the hub fetched is owned by the URL it was fetched from — whoever can put a
 * file there controls it, which needs no credential to prove and cannot be
 * squatted by someone who does not run the site. A game pasted into the
 * dashboard has no such URL, so it belongs to the account that pasted it.
 *
 * Achievements are reconciled rather than replaced. A definition dropped from
 * the manifest is hidden, never deleted — players who already unlocked it keep
 * their row, and `user_achievements` keeps pointing at something real.
 */

import type { GameManifest } from "@game-center/protocol";

import type { Client } from "./client.ts";

export interface Game {
  readonly id: string;
  /** Set when an account registered this game by hand. */
  readonly ownerId: number | null;
  /** Set when the hub fetched this game's manifest. Its proof of ownership. */
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
 * `manifestUrl` is the URL the manifest was fetched from; `ownerId` is the
 * account that pasted it. Exactly one is set, mirroring the table.
 */
export type Registrant =
  | { readonly manifestUrl: string; readonly ownerId?: undefined }
  | { readonly ownerId: number; readonly manifestUrl?: undefined };

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
 * @param registrant The manifest URL it was fetched from, or the account that pasted it
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
  const existing = await findGame(client, manifest.id);
  if (existing) assertMayWrite(existing, registrant, manifest.id);

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
        manifest.id,
      ],
    });
  } else {
    await client.execute({
      sql: `insert into games
              (id, owner_id, manifest_url, title, description, url, icon_url)
            values (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        manifest.id,
        registrant.ownerId ?? null,
        registrant.manifestUrl ?? null,
        manifest.title,
        manifest.description ?? null,
        gameUrl,
        iconUrl,
      ],
    });
  }

  const retired = await reconcileAchievements(client, manifest);

  const game = await findGame(client, manifest.id);
  if (!game) {
    throw new Error(`Game ${manifest.id} vanished right after being written`);
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
    if (registrant.manifestUrl === existing.manifestUrl) return;
    throw new GameOwnershipError(
      `The game id "${id}" is registered from ${existing.manifestUrl}`,
    );
  }
  if (existing.ownerId !== null && registrant.ownerId === existing.ownerId) {
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
  manifest: GameManifest,
): Promise<string[]> {
  const stored = await listAchievements(client, manifest.id, {
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
          manifest.id,
          achievement.key,
        ],
      });
    } else {
      await client.execute({
        sql: `insert into achievements
                (game_id, key, title, description, points, hidden, sort_order)
              values (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          manifest.id,
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
      args: [manifest.id, achievement.key],
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

/** Games a player registered from the dashboard, whatever their status. */
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
  `select id, owner_id, manifest_url, title, description, url, icon_url, status
     from games`;

function toGame(row: Record<string, unknown>): Game {
  return {
    id: String(row.id),
    ownerId: row.owner_id === null ? null : Number(row.owner_id),
    manifestUrl: row.manifest_url === null ? null : String(row.manifest_url),
    title: String(row.title),
    description: row.description === null ? null : String(row.description),
    url: String(row.url),
    iconUrl: row.icon_url === null ? null : String(row.icon_url),
    status: String(row.status) === "hidden" ? "hidden" : "active",
  };
}
