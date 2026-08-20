/**
 * The two ways a manifest gets into the registry.
 *
 * Both end at the same {@link registerGame}, and both report problems the same
 * way, because a developer debugging a red CI run and a developer pasting into
 * the dashboard should not have to reconcile two vocabularies.
 *
 * They differ in what vouches for the registration. Fetching one proves itself
 * — the document came from the URL it claims. Pasting one proves nothing about
 * the URL, so it is tied to the account that did it.
 */

import {
  formatIssues,
  type GameManifest,
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
import { apiError, apiJson } from "../utils/api.ts";
import { fetchManifest, ManifestFetchError } from "./manifest_fetch.ts";

/**
 * Register the game published at `url`.
 *
 * Nothing authenticates this: the caller only asks the hub to read a document,
 * and the document's location is what decides whether it may be written.
 *
 * @param client Database to write to
 * @param url The game's page URL
 * @returns The response to send
 */
export async function registerFromUrl(
  client: Client,
  url: string,
): Promise<Response> {
  let fetched;
  try {
    fetched = await fetchManifest(url);
  } catch (error) {
    if (error instanceof ManifestFetchError) {
      return manifestRejected(error.message, error.issues);
    }
    // A network failure is about the game's host, not about the request.
    return apiError(
      `Could not read ${url}: ${(error as Error).message}`,
      502,
    );
  }

  return await store(
    client,
    { manifestUrl: fetched.manifestUrl },
    fetched.manifest,
    fetched.gameUrl,
    { source: fetched.source, manifestUrl: fetched.manifestUrl },
  );
}

/**
 * Register a manifest pasted into the dashboard.
 *
 * For games with no public URL to fetch — a Claude Artifact, which serves a
 * shell rather than its own HTML, or anything still on a laptop. Here the
 * manifest must say where the game is, since nothing else can.
 *
 * @param client Database to write to
 * @param ownerId The account pasting it
 * @param body The manifest, already parsed from JSON
 * @returns The response to send
 */
export async function registerFromPaste(
  client: Client,
  ownerId: number,
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

  return await store(
    client,
    { ownerId },
    parsed.manifest,
    parsed.manifest.url,
    { source: "pasted" },
  );
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
