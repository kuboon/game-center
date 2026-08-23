/**
 * How a manifest becomes a registered game.
 *
 * Two halves have to meet. The document names its author by handle; the account
 * with that handle says which documents are theirs. Either alone proves
 * nothing — anyone can write a name in a file, and anyone can claim to have
 * written a game — but together they establish both control of the URL and the
 * author's consent, with no secret travelling between them.
 *
 * When the person submitting *is* the named author, the second half has already
 * happened and the game registers immediately. The queue exists for the case
 * where nobody is present, which is to say for CI.
 */

import {
  formatIssues,
  type GameManifest,
  gameRef,
  type ManifestIssue,
  parseManifest,
} from "@game-center/protocol";

import type { Client } from "../db/client.ts";
import {
  GameOwnershipError,
  listAchievements,
  registerGame,
  type Registrant,
} from "../db/games.ts";
import {
  type PendingRegistration,
  submitRegistration,
  TooManyPendingError,
} from "../db/registrations.ts";
import { findUserByHandle, type NamedUser, type User } from "../db/users.ts";
import { apiError, apiJson } from "../utils/api.ts";
import { fetchManifest, ManifestFetchError } from "./manifest_fetch.ts";

/**
 * Register the game published at `url`, or queue it for its author.
 *
 * Nothing authenticates the call itself. The manifest's location is what makes
 * it writable, and the author's approval is what makes it theirs.
 *
 * @param client Database to write to
 * @param url The game's page URL
 * @param submitter The signed-in caller, when there is one
 * @returns The response to send
 */
export async function registerFromUrl(
  client: Client,
  url: string,
  submitter?: User,
): Promise<Response> {
  let fetched;
  try {
    fetched = await fetchManifest(url);
  } catch (error) {
    if (error instanceof ManifestFetchError) {
      return manifestRejected(error.message, error.issues);
    }
    // A network failure is about the game's host, not about the request.
    return apiError(`Could not read ${url}: ${(error as Error).message}`, 502);
  }

  const author = await findUserByHandle(client, fetched.manifest.author);
  if (!author) {
    return apiError(
      `No game-center account goes by @${fetched.manifest.author}`,
      404,
    );
  }

  // `manifest.author` is the handle that found this account, so it is their
  // handle — no need to reach for the nullable column.
  const handle = fetched.manifest.author;

  // Already this author's game: updates flow straight through, which is what
  // lets CI push the same document on every commit.
  const known = await isKnownUrl(
    client,
    gameRef(handle, fetched.manifest.id),
    fetched.manifestUrl,
  );

  if (known || submitter?.id === author.id) {
    return await store(
      client,
      {
        ownerId: author.id,
        authorHandle: handle,
        manifestUrl: fetched.manifestUrl,
      },
      fetched.manifest,
      fetched.gameUrl,
      { source: fetched.source, manifestUrl: fetched.manifestUrl },
    );
  }

  let pending: PendingRegistration;
  try {
    pending = await submitRegistration(client, author.id, {
      slug: fetched.manifest.id,
      manifestUrl: fetched.manifestUrl,
      gameUrl: fetched.gameUrl,
      manifest: fetched.manifest,
    });
  } catch (error) {
    if (error instanceof TooManyPendingError) {
      return apiError(error.message, 429);
    }
    throw error;
  }

  return apiJson({
    pending: true,
    author: author.handle,
    game: { id: gameRef(handle, pending.slug), title: pending.manifest.title },
    manifestUrl: pending.manifestUrl,
    message:
      `Waiting for @${author.handle} to approve this URL on their game-center dashboard. Nothing is registered until they do.`,
  }, { status: 202 });
}

/**
 * Register a manifest pasted into the dashboard.
 *
 * For games the hub cannot fetch — a Claude Artifact, which serves a shell
 * rather than the author's HTML, or anything still on a laptop. Only the named
 * author may paste, since there is no URL here to vouch for anyone.
 *
 * @param client Database to write to
 * @param submitter The signed-in account doing the pasting
 * @param body The manifest, already parsed from JSON
 * @returns The response to send
 */
export async function registerFromPaste(
  client: Client,
  submitter: User,
  body: unknown,
): Promise<Response> {
  const parsed = parseManifest(body);
  if (!parsed.ok) {
    return manifestRejected("gamecenter.json is not valid", parsed.issues);
  }

  if (!parsed.manifest.url) {
    return manifestRejected("gamecenter.json is not valid", [{
      path: "url",
      message:
        "is required when the manifest is pasted, because there is no URL it was fetched from",
    }]);
  }
  if (parsed.manifest.author !== submitter.handle) {
    return manifestRejected("gamecenter.json is not valid", [{
      path: "author",
      message: submitter.handle
        ? `must be @${submitter.handle}: a pasted manifest has no URL to vouch for anyone else`
        : "cannot be checked until you choose a handle on your account page",
    }]);
  }

  return await store(
    client,
    { ownerId: submitter.id, authorHandle: submitter.handle },
    parsed.manifest,
    parsed.manifest.url,
    { source: "pasted" },
  );
}

/**
 * Complete a registration the author approved.
 *
 * The slug is claimed here rather than at submission, so a queue full of
 * unapproved entries reserves nothing.
 *
 * @param client Database to write to
 * @param author The approving account
 * @param pending What they approved
 * @returns The response to send
 */
export function approveRegistration(
  client: Client,
  author: NamedUser,
  pending: PendingRegistration,
): Promise<Response> {
  return store(
    client,
    {
      ownerId: author.id,
      authorHandle: author.handle,
      manifestUrl: pending.manifestUrl,
    },
    pending.manifest,
    pending.gameUrl,
    { source: "approved", manifestUrl: pending.manifestUrl },
  );
}

/** Whether this game already accepts writes from this URL. */
async function isKnownUrl(
  client: Client,
  gameId: string,
  manifestUrl: string,
): Promise<boolean> {
  const result = await client.execute({
    sql: "select 1 from games where id = ? and manifest_url = ?",
    args: [gameId, manifestUrl],
  });
  return result.rows.length > 0;
}

async function store(
  client: Client,
  registrant: Registrant,
  manifest: GameManifest,
  gameUrl: string,
  extra: Record<string, unknown>,
): Promise<Response> {
  let result;
  try {
    result = await registerGame(client, registrant, manifest, gameUrl);
  } catch (error) {
    if (error instanceof GameOwnershipError) {
      return apiError(error.message, 409);
    }
    throw error;
  }

  const achievements = await listAchievements(client, result.game.id);
  return apiJson({
    game: result.game,
    created: result.created,
    retired: result.retired,
    achievements,
    ...extra,
  }, { status: result.created ? 201 : 200 });
}

/** Both shapes: `issues` for a program, `message` for the log a human reads. */
function manifestRejected(
  message: string,
  issues: readonly ManifestIssue[],
): Response {
  return apiError(message, 400, {
    ...(issues.length > 0 ? { issues, message: formatIssues(issues) } : {}),
  });
}
