/**
 * How the hub proves to the IdP that it is the hub.
 *
 * There is no shared secret and no registration step. The hub publishes the
 * public half of its ES256 key at `/.well-known/jwks.json`; the IdP fetches
 * `{clientId}/.well-known/jwks.json` and verifies a `private_key_jwt` client
 * assertion against it (RFC 7521 / RFC 7523). The `clientId` is the hub's own
 * origin, so nothing has to be issued to anyone — rotating the key means
 * changing what the hub publishes, and the IdP follows.
 *
 * The key is the one already in `RP_SIGNING_KEY_JWK`. It signs launch tokens
 * too, which the hub verifies itself; publishing the *public* half adds no
 * ability to forge either, since forging needs the private half.
 */

import {
  calculateJwkThumbprint,
  exportJWK,
  importJWK,
  type JWK,
  SignJWT,
} from "jose";

const ALGORITHM = "ES256";

/** What proving identity needs from the configuration. */
export interface RpIdentityConfig {
  readonly rpOrigin: string;
  readonly idpOrigin: string;
  readonly rpSigningKeyJwk: string;
}

/** Raised when the hub has no signing key, so it cannot prove anything. */
export class NoSigningKeyError extends Error {
  override readonly name = "NoSigningKeyError";
}

/**
 * The public JWK set the IdP reads, with the `kid` the assertion carries.
 *
 * The `kid` is the RFC 7638 thumbprint, which is what the IdP's own JWKS uses;
 * deriving it rather than storing it means the key and its name cannot drift
 * apart, and two keys can sit in the set during a rotation.
 */
export async function publicJwks(
  config: RpIdentityConfig,
): Promise<{ keys: JWK[] }> {
  const jwk = await publicJwk(config);
  return { keys: [jwk] };
}

/** The public half of the signing key, named by its thumbprint. */
export async function publicJwk(config: RpIdentityConfig): Promise<JWK> {
  const parsed = parseKey(config);
  const key = await importJWK(parsed, ALGORITHM);
  if (!(key instanceof CryptoKey)) {
    throw new NoSigningKeyError("RP_SIGNING_KEY_JWK is not a usable key");
  }
  // Export from the imported key rather than trimming the stored JSON, so a
  // private field can never survive into what gets published.
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { ...parsed, d: undefined, key_ops: undefined, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  const exported = await exportJWK(publicKey);
  return {
    ...exported,
    kid: await calculateJwkThumbprint(exported),
    alg: ALGORITHM,
    use: "sig",
  };
}

/**
 * Sign a `private_key_jwt` client assertion for the IdP.
 *
 * One minute of life and a fresh `jti`, because the IdP treats it as
 * single-use: this is a bearer credential for one call, not a session.
 *
 * @param config Origins and the signing key
 * @returns The compact JWS to send as a Bearer token
 * @throws {NoSigningKeyError} when no signing key is configured
 */
export async function clientAssertion(
  config: RpIdentityConfig,
): Promise<string> {
  const parsed = parseKey(config);
  const key = await importJWK(parsed, ALGORITHM);
  const kid = (await publicJwk(config)).kid;
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({})
    .setProtectedHeader({
      alg: ALGORITHM,
      typ: "client-assertion+jwt",
      kid,
    })
    // Issuer and subject are both the clientId, which is this hub's origin.
    .setIssuer(config.rpOrigin)
    .setSubject(config.rpOrigin)
    .setAudience(config.idpOrigin)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(crypto.randomUUID())
    .sign(key);
}

function parseKey(config: RpIdentityConfig): JWK {
  if (!config.rpSigningKeyJwk) {
    throw new NoSigningKeyError("RP_SIGNING_KEY_JWK is not set");
  }
  try {
    return JSON.parse(config.rpSigningKeyJwk) as JWK;
  } catch {
    throw new NoSigningKeyError("RP_SIGNING_KEY_JWK is not valid JSON");
  }
}
