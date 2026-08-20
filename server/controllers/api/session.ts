/**
 * POST /api/internal/session — turn an IdP token into a hub session.
 *
 * The browser signs in at id.kbn.one, reads `{ userId, jws }` from the IdP's
 * `/session`, and posts the `jws` here over a DPoP-proofed request. We verify
 * the token against the IdP's JWKS, confirm it is bound to the key that signed
 * this request's proof, then record the userId on the session and upsert the
 * player.
 *
 * No CORS headers: this is the internal surface, so only the hub's own pages
 * can reach it.
 */

import type { Action } from "@remix-run/fetch-router";

import { requireDb } from "../../db/client.ts";
import { upsertUser } from "../../db/users.ts";
import { IdpTokenError, verifyIdpToken } from "../../lib/idp_token.ts";
import {
  DpopProofError,
  DpopSession,
  SESSION_USER_ID,
  sessionsArePersistent,
} from "../../middleware/dpop.ts";
import type { routes } from "../../routes.ts";
import { apiError, apiJson } from "../../utils/api.ts";

export const internalSessionAction = {
  async handler(context) {
    // Absent unless the middleware verified a DPoP proof on this request. The
    // reason it failed is worth returning: "missing-dpop-header" is a client
    // that sent none, while "url-mismatch" means the proof was signed for a
    // different URL than this server saw — a proxy rewriting the request URL,
    // not anything the browser can fix.
    const session = context.get(DpopSession);
    if (!session) {
      const reason = context.get(DpopProofError)?.reason ??
        "missing-dpop-proof";
      return apiError("DPoP proof required", 401, { reason });
    }

    // Signing in writes a user row and a session that must outlive this
    // isolate. Saying so beats accepting the token and forgetting it.
    if (!sessionsArePersistent) {
      return apiError("This deployment has no database configured", 503);
    }

    let jws: unknown;
    try {
      ({ jws } = await context.request.json() as { jws?: unknown });
    } catch {
      return apiError("Body must be JSON", 400);
    }
    if (typeof jws !== "string" || !jws) {
      return apiError("jws is required", 400);
    }

    let identity;
    try {
      identity = await verifyIdpToken(jws, session.thumbprint);
    } catch (error) {
      if (error instanceof IdpTokenError) {
        return apiError(error.message, 401);
      }
      throw error;
    }

    const user = await upsertUser(
      requireDb(),
      identity.userId,
      identity.nickname,
    );
    session.set(SESSION_USER_ID, identity.userId);

    return apiJson({
      userId: user.externalId,
      displayName: user.displayName,
    });
  },
} satisfies Action<typeof routes.internalSession>;
