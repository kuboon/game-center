/**
 * Bug reports and requests from players, kept for the game's author.
 *
 * Only two people ever touch a report: the player who wrote it, once, and the
 * author of the game it is about, who reads it and may throw it away. There is
 * no reply and no thread. A report is a note left for somebody, and the hub
 * does not pretend it is a conversation.
 */

import type { Client } from "./client.ts";

/** What a report says it is. Mirrors the check constraint. */
export type FeedbackKind = "bug" | "request" | "other";

export const FEEDBACK_KINDS: readonly FeedbackKind[] = [
  "bug",
  "request",
  "other",
];

/** The longest message accepted. Mirrors the check constraint. */
export const MAX_FEEDBACK_LENGTH = 4000;

/** One report, as its game's author reads it. */
export interface Feedback {
  readonly id: number;
  readonly gameId: string;
  readonly gameTitle: string;
  readonly kind: FeedbackKind;
  readonly message: string;
  readonly createdAt: string;
  /** Who wrote it. Always someone: only signed-in players can send. */
  readonly sender: {
    readonly handle: string | null;
    readonly displayName: string;
  };
}

/**
 * Store a report.
 *
 * @returns The new report's id
 */
export async function submitFeedback(
  client: Client,
  report: {
    gameId: string;
    senderId: number;
    kind: FeedbackKind;
    message: string;
  },
): Promise<number> {
  const result = await client.execute({
    sql: `insert into game_feedback (game_id, sender_id, kind, message)
          values (?, ?, ?, ?)
          returning id`,
    args: [report.gameId, report.senderId, report.kind, report.message],
  });
  return Number(result.rows[0].id);
}

/** How many reports an inbox shows. Older ones stay stored, just not listed. */
const INBOX_LIMIT = 100;

/**
 * Reports about every game an author owns, newest first.
 *
 * Whatever the game's status: a withdrawn game still has an author, and what
 * players said before the withdrawal is still theirs to read.
 */
export async function listFeedbackForOwner(
  client: Client,
  ownerId: number,
): Promise<Feedback[]> {
  const result = await client.execute({
    sql: `select game_feedback.id, game_feedback.game_id,
                 games.title as game_title,
                 game_feedback.kind, game_feedback.message,
                 game_feedback.created_at,
                 users.handle, users.display_name
            from game_feedback
            join games on games.id = game_feedback.game_id
            join users on users.id = game_feedback.sender_id
           where games.owner_id = ?
           order by game_feedback.created_at desc, game_feedback.id desc
           limit ?`,
    args: [ownerId, INBOX_LIMIT],
  });
  return result.rows.map((row) => ({
    id: Number(row.id),
    gameId: String(row.game_id),
    gameTitle: String(row.game_title),
    kind: String(row.kind) as FeedbackKind,
    message: String(row.message),
    createdAt: String(row.created_at),
    sender: {
      handle: row.handle === null ? null : String(row.handle),
      displayName: String(row.display_name),
    },
  }));
}

/**
 * Throw a report away, if it is about one of the owner's games.
 *
 * Ownership is part of the delete rather than a check before it, so there is
 * no moment where a report has been judged deletable but not yet deleted.
 *
 * @returns True when a report was removed
 */
export async function deleteFeedback(
  client: Client,
  ownerId: number,
  id: number,
): Promise<boolean> {
  const result = await client.execute({
    sql: `delete from game_feedback
           where id = ?
             and game_id in (select id from games where owner_id = ?)`,
    args: [id, ownerId],
  });
  return result.rowsAffected > 0;
}
