/**
 * Taking a manifest in over HTTP.
 *
 * Two surfaces do this — the registry token API that CI calls, and the
 * dashboard's internal API — and they must agree on every detail, because the
 * GitHub Action's output is what a developer debugs against. So both come
 * through here, and only the authentication differs.
 */

import { formatIssues, parseManifest } from "@game-center/protocol";

import type { Client } from "../db/client.ts";
import {
  GameOwnershipError,
  listAchievements,
  registerGame,
} from "../db/games.ts";
import { apiError, apiJson } from "../utils/api.ts";

/**
 * Validate and store a manifest posted as the request body.
 *
 * @param client Database to write to
 * @param ownerId The player the caller is acting as
 * @param request The request whose JSON body is the manifest
 * @returns The response to send, whether it succeeded or not
 */
export async function registerFromRequest(
  client: Client,
  ownerId: number,
  request: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Body must be JSON", 400);
  }

  const parsed = parseManifest(body);
  if (!parsed.ok) {
    // Both shapes: `issues` for a program, `message` for the CI log a human
    // reads first.
    return apiError("gamecenter.json is not valid", 400, {
      issues: parsed.issues,
      message: formatIssues(parsed.issues),
    });
  }

  let result;
  try {
    result = await registerGame(client, ownerId, parsed.manifest);
  } catch (error) {
    if (error instanceof GameOwnershipError) {
      return apiError(error.message, 403);
    }
    throw error;
  }

  const achievements = await listAchievements(client, result.game.id);
  return apiJson({
    game: result.game,
    created: result.created,
    retired: result.retired,
    achievements,
  }, { status: result.created ? 201 : 200 });
}
