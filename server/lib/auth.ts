/**
 * Who is calling, on each of the two authenticated surfaces.
 *
 * `/api/internal` is the hub's own frontend: a DPoP-proofed request whose
 * session carries the IdP userId. `/api/registry/v1` is CI and other servers:
 * a bearer token that acts as the player who issued it. Both end up at the
 * same {@link User}, and both fail with a response rather than an exception so
 * a controller can return it unchanged.
 */

import type { RequestContext } from "@remix-run/fetch-router";

import { getDb } from "../db/client.ts";
import { authenticateToken } from "../db/api_tokens.ts";
import { findUserByExternalId, type User } from "../db/users.ts";
import {
  DpopProofError,
  DpopSession,
  SESSION_USER_ID,
} from "../middleware/dpop.ts";
import { apiError } from "../utils/api.ts";

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

/**
 * The player an API token acts as.
 *
 * @param request The incoming request, for its Authorization header
 * @returns The player, or the response explaining why there is none
 */
export async function authenticateApiToken(
  request: Request,
): Promise<Authentication> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    return {
      ok: false,
      response: apiError("Authorization: Bearer <token> required", 401),
    };
  }

  const client = getDb();
  if (!client) return { ok: false, response: noDatabase() };

  const user = await authenticateToken(client, match[1]);
  if (!user) return { ok: false, response: apiError("Unknown token", 401) };
  return { ok: true, user };
}

function noDatabase(): Response {
  return apiError("This deployment has no database configured", 503);
}
