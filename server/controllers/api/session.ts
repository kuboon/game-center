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
import { DpopSession, SESSION_USER_ID } from "../../middleware/dpop.ts";
import type { routes } from "../../routes.ts";

const noStore = (response: Response): Response => {
  response.headers.set("cache-control", "no-store");
  return response;
};

export const internalSessionAction = {
  async handler(context) {
    // Absent unless the middleware verified a DPoP proof on this request.
    const session = context.get(DpopSession);
    if (!session) {
      return noStore(
        Response.json({ error: "DPoP proof required" }, { status: 401 }),
      );
    }

    let jws: unknown;
    try {
      ({ jws } = await context.request.json() as { jws?: unknown });
    } catch {
      return noStore(
        Response.json({ error: "Body must be JSON" }, { status: 400 }),
      );
    }
    if (typeof jws !== "string" || !jws) {
      return noStore(
        Response.json({ error: "jws is required" }, { status: 400 }),
      );
    }

    let identity;
    try {
      identity = await verifyIdpToken(jws, session.thumbprint);
    } catch (error) {
      if (error instanceof IdpTokenError) {
        return noStore(
          Response.json({ error: error.message }, { status: 401 }),
        );
      }
      throw error;
    }

    const user = await upsertUser(
      requireDb(),
      identity.userId,
      identity.nickname,
    );
    session.set(SESSION_USER_ID, identity.userId);

    return noStore(
      Response.json({ userId: user.externalId, displayName: user.displayName }),
    );
  },
} satisfies Action<typeof routes.internalSession>;
