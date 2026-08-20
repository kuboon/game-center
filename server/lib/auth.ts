/**
 * Who is calling, on each of the two authenticated surfaces.
 *
 * `/api/internal` is the hub's own frontend: a DPoP-proofed request whose
 * session carries the IdP userId. `/api/game/v1` is a running game: a launch
 * token that names both the player and the one game it may act on. Both end up
 * at a {@link User}, and both fail with a response rather than an exception so
 * a controller can return it unchanged.
 *
 * `/api/registry/v1` has no entry here, and that is the point: it authenticates
 * nobody. What vouches for a registration is where the manifest was served
 * from, not who sent the request.
 */

import type { RequestContext } from "@remix-run/fetch-router";

import { getDb } from "../db/client.ts";
import { findUserByExternalId, findUserById, type User } from "../db/users.ts";
import {
  DpopProofError,
  DpopSession,
  SESSION_USER_ID,
} from "../middleware/dpop.ts";
import { apiError } from "../utils/api.ts";
import {
  type Launch,
  LaunchTokenError,
  SigningKeyMissingError,
  verifyLaunchToken,
} from "./launch_token.ts";

export type Authentication =
  | { readonly ok: true; readonly user: User }
  | { readonly ok: false; readonly response: Response };

/**
 * The signed-in player behind an internal API request.
 *
 * @param context The request context, for the DPoP session
 * @returns The player, or the response explaining why there is none
 */
export async function authenticateSession(
  context: RequestContext,
): Promise<Authentication> {
  // What is wrong with the request comes before what is wrong with the
  // deployment: a caller with no proof gets the same 401 whether or not this
  // hub happens to have a database configured.
  const session = context.get(DpopSession);
  if (!session) {
    const reason = context.get(DpopProofError)?.reason ?? "missing-dpop-proof";
    return {
      ok: false,
      response: apiError("DPoP proof required", 401, { reason }),
    };
  }

  const externalId = session.get(SESSION_USER_ID);
  if (typeof externalId !== "string" || !externalId) {
    return { ok: false, response: apiError("Sign-in required", 401) };
  }

  const client = getDb();
  if (!client) return { ok: false, response: noDatabase() };

  const user = await findUserByExternalId(client, externalId);
  if (!user) {
    // The session outlived the row it names, which only happens if the player
    // was deleted. Treat it as signed out rather than resurrecting them.
    return { ok: false, response: apiError("Sign-in required", 401) };
  }
  return { ok: true, user };
}

/** A verified launch token, plus the player it names. */
export type GameAuthentication =
  | { readonly ok: true; readonly user: User; readonly launch: Launch }
  | { readonly ok: false; readonly response: Response };

/**
 * The player and game behind a request on the game-facing API.
 *
 * @param request The incoming request, for its Authorization header
 * @returns The player and the game the token is scoped to, or the refusal
 */
export async function authenticateLaunch(
  request: Request,
): Promise<GameAuthentication> {
  const token = bearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: apiError("Authorization: Bearer <launch token> required", 401),
    };
  }

  let launch: Launch;
  try {
    launch = await verifyLaunchToken(token);
  } catch (error) {
    if (error instanceof LaunchTokenError) {
      // The game is expected to fall back to the claim URL on a 401, so the
      // reason matters more than usual here.
      return { ok: false, response: apiError(error.message, 401) };
    }
    if (error instanceof SigningKeyMissingError) {
      return { ok: false, response: apiError(error.message, 503) };
    }
    throw error;
  }

  const client = getDb();
  if (!client) return { ok: false, response: noDatabase() };

  const user = await findUserById(client, launch.userId);
  if (!user) {
    return {
      ok: false,
      response: apiError("Launch token names no player", 401),
    };
  }
  return { ok: true, user, launch };
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  return match ? match[1] : null;
}

function noDatabase(): Response {
  return apiError("This deployment has no database configured", 503);
}
