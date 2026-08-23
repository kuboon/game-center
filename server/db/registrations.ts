/**
 * Registrations waiting for their author to approve them.
 *
 * A manifest names its author, and anyone at all may ask the hub to read it —
 * so a submission is only half of a registration. It sits here until the named
 * account says yes, which is the other half: the document claims the person,
 * and the person claims the document.
 *
 * A pending row holds a slug, not a game id, and nothing unique on it: it has
 * claimed nothing. Reserving here would let anyone park an author's good names
 * behind approvals that never arrive. The id is built and taken at approval,
 * and two submissions racing for one slug are settled by whoever approves
 * first.
 */

import type { GameManifest } from "@game-center/protocol";

import type { Client } from "./client.ts";

/** How many submissions one author can be sitting on before the queue fills. */
export const MAX_PENDING_PER_AUTHOR = 20;

/** Raised when an author's queue is full, which is what spam looks like. */
export class TooManyPendingError extends Error {
  override readonly name = "TooManyPendingError";
}

export interface PendingRegistration {
  readonly id: number;
  /** The slug the manifest asked for. Not yet qualified, not yet taken. */
  readonly slug: string;
  readonly manifestUrl: string;
  readonly gameUrl: string;
  readonly authorId: number;
  readonly manifest: GameManifest;
  readonly submittedAt: string;
}

/**
 * Record a submission for the named author to look at.
 *
 * Re-submitting the same URL replaces the stored manifest rather than piling
 * up: CI may run many times before anyone gets around to approving, and the
 * author should see the current document when they do.
 *
 * @param client Database to write to
 * @param authorId The account the manifest names
 * @param entry Where it was found and what it said
 * @returns The stored submission
 * @throws {TooManyPendingError} when this author already has too many waiting
 */
export async function submitRegistration(
  client: Client,
  authorId: number,
  entry: {
    slug: string;
    manifestUrl: string;
    gameUrl: string;
    manifest: GameManifest;
  },
): Promise<PendingRegistration> {
  const existing = await findPendingByUrl(client, authorId, entry.manifestUrl);
  if (!existing) {
    const waiting = await countPending(client, authorId);
    if (waiting >= MAX_PENDING_PER_AUTHOR) {
      throw new TooManyPendingError(
        `That author already has ${waiting} registrations waiting for approval`,
      );
    }
  }

  await client.execute({
    sql: `insert into game_registrations
            (slug, manifest_url, game_url, author_id, manifest)
          values (?, ?, ?, ?, ?)
          on conflict (manifest_url, author_id) do update
            set slug = excluded.slug,
                game_url = excluded.game_url,
                manifest = excluded.manifest,
                submitted_at = datetime('now')`,
    args: [
      entry.slug,
      entry.manifestUrl,
      entry.gameUrl,
      authorId,
      JSON.stringify(entry.manifest),
    ],
  });

  const stored = await findPendingByUrl(client, authorId, entry.manifestUrl);
  if (!stored) {
    throw new Error("Submission vanished right after being written");
  }
  return stored;
}

/** What one author has waiting, oldest first. */
export async function listPending(
  client: Client,
  authorId: number,
): Promise<PendingRegistration[]> {
  const result = await client.execute({
    sql: `${COLUMNS} where author_id = ? order by submitted_at, id`,
    args: [authorId],
  });
  return result.rows.map(toPending);
}

/**
 * One of an author's own submissions.
 *
 * Scoped by author in the statement rather than checked afterwards, so a
 * guessed id belonging to someone else simply is not found.
 */
export async function findPending(
  client: Client,
  authorId: number,
  id: number,
): Promise<PendingRegistration | null> {
  const result = await client.execute({
    sql: `${COLUMNS} where id = ? and author_id = ?`,
    args: [id, authorId],
  });
  const row = result.rows[0];
  return row ? toPending(row) : null;
}

/** Take a submission off the queue, once approved or dismissed. */
export async function removePending(
  client: Client,
  authorId: number,
  id: number,
): Promise<boolean> {
  const result = await client.execute({
    sql: "delete from game_registrations where id = ? and author_id = ?",
    args: [id, authorId],
  });
  return result.rowsAffected > 0;
}

async function findPendingByUrl(
  client: Client,
  authorId: number,
  manifestUrl: string,
): Promise<PendingRegistration | null> {
  const result = await client.execute({
    sql: `${COLUMNS} where author_id = ? and manifest_url = ?`,
    args: [authorId, manifestUrl],
  });
  const row = result.rows[0];
  return row ? toPending(row) : null;
}

async function countPending(
  client: Client,
  authorId: number,
): Promise<number> {
  const result = await client.execute({
    sql: "select count(*) as n from game_registrations where author_id = ?",
    args: [authorId],
  });
  return Number(result.rows[0].n);
}

const COLUMNS =
  `select id, slug, manifest_url, game_url, author_id, manifest, submitted_at
     from game_registrations`;

function toPending(row: Record<string, unknown>): PendingRegistration {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    manifestUrl: String(row.manifest_url),
    gameUrl: String(row.game_url),
    authorId: Number(row.author_id),
    manifest: JSON.parse(String(row.manifest)) as GameManifest,
    submittedAt: String(row.submitted_at),
  };
}
