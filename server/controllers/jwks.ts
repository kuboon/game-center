/**
 * GET /.well-known/jwks.json — the hub's public signing key.
 *
 * The IdP fetches this from `{clientId}/.well-known/jwks.json` to verify the
 * `private_key_jwt` client assertion the hub sends with a notification. There
 * is no registration and no shared secret: rotating the key means changing
 * what is published here, and the IdP follows on its next fetch.
 *
 * Public by definition, and cached only briefly — a short cache is what makes
 * a rotation take effect in minutes rather than hours.
 */

import type { Action } from "@remix-run/fetch-router";

import { getConfig } from "../config.ts";
import { NoSigningKeyError, publicJwks } from "../lib/rp_identity.ts";
import type { routes } from "../routes.ts";
import { apiError } from "../utils/api.ts";

export const jwksAction = {
  async handler() {
    let jwks;
    try {
      jwks = await publicJwks(getConfig());
    } catch (error) {
      if (error instanceof NoSigningKeyError) {
        // No key configured is a deployment that cannot be spoken for, not a
        // request that went wrong. An empty set would read as "this hub has no
        // keys", which is a different and misleading claim.
        return apiError("This hub has no signing key configured", 503);
      }
      throw error;
    }

    return new Response(JSON.stringify(jwks, null, 2), {
      headers: {
        "content-type": "application/jwk-set+json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=300",
      },
    });
  },
} satisfies Action<typeof routes.jwks>;
