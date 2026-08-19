/**
 * Verifying the identity token id.kbn.one hands the browser.
 *
 * `GET https://id.kbn.one/session` answers a signed-in browser with
 * `{ userId, jws, nickname }`. The `jws` is what makes the userId trustworthy
 * to us: an ES256 JWT carrying `sub` (the userId), `iss`, `nbf` / `exp`, `jti`,
 * and `cnf.jkt` — the thumbprint of the browser's DPoP key (RFC 9449 key
 * binding).
 *
 * So the hub never takes a userId on the browser's word. It checks the IdP's
 * signature through the published JWKS, and then checks that `cnf.jkt` is the
 * very key that signed the DPoP proof on this request. Without that second
 * check a token leaked from one browser would authenticate another.
 */

import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";

import { getConfig } from "../config.ts";

/** What a verified token tells us about the player. */
export interface IdpIdentity {
  /** The IdP's user identifier, stored as `users.external_id`. */
  readonly userId: string;
  /** Display name the IdP knows, when it has one. */
  readonly nickname: string | null;
}

/** Raised when a token cannot be trusted. The message is safe to return. */
export class IdpTokenError extends Error {
  override readonly name = "IdpTokenError";
}

/** The `cnf` claim, as RFC 9449 defines it for DPoP-bound tokens. */
interface ConfirmationClaim {
  readonly jkt?: unknown;
}

type IdpPayload = JWTPayload & {
  readonly cnf?: ConfirmationClaim;
  readonly nickname?: unknown;
};

/**
 * JWKS fetchers, one per issuer. `createRemoteJWKSet` caches keys and refetches
 * on an unknown `kid`, which is how key rotation at the IdP resolves itself —
 * so the set has to outlive a single request.
 */
const jwkSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwkSetFor(idpOrigin: string): ReturnType<typeof createRemoteJWKSet> {
  let set = jwkSets.get(idpOrigin);
  if (!set) {
    set = createRemoteJWKSet(new URL(`${idpOrigin}/.well-known/jwks.json`));
    jwkSets.set(idpOrigin, set);
  }
  return set;
}

/**
 * Verify an identity token and confirm it was issued for `thumbprint`.
 *
 * @param jws Compact JWS from the IdP's `/session` response
 * @param thumbprint JWK thumbprint of the DPoP key on the current request
 * @param idpOrigin Issuer to trust. Defaults to the configured IdP
 * @returns The identity the token asserts
 * @throws {IdpTokenError} when the signature, claims, or key binding fail
 */
export async function verifyIdpToken(
  jws: string,
  thumbprint: string,
  idpOrigin: string = getConfig().idpOrigin,
): Promise<IdpIdentity> {
  let payload: IdpPayload;
  try {
    ({ payload } = await jwtVerify<IdpPayload>(jws, jwkSetFor(idpOrigin), {
      issuer: idpOrigin,
    }));
  } catch (cause) {
    throw new IdpTokenError("Identity token failed verification", { cause });
  }

  if (payload.cnf?.jkt !== thumbprint) {
    throw new IdpTokenError(
      "Identity token is bound to a different key than this request",
    );
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new IdpTokenError("Identity token has no subject");
  }

  return {
    userId: payload.sub,
    nickname: typeof payload.nickname === "string" && payload.nickname
      ? payload.nickname
      : null,
  };
}
