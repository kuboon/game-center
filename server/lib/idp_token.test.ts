/**
 * Verification tests for the IdP identity token.
 *
 * A local ES256 key stands in for the IdP's, served through a stub JWKS
 * endpoint, so the checks that matter — signature, issuer, expiry, and the
 * `cnf.jkt` key binding — run without touching id.kbn.one.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

import { IdpTokenError, verifyIdpToken } from "./idp_token.ts";

const ISSUER = "https://idp.test";
const THUMBPRINT = "browser-key-thumbprint";

const keys = await generateKeyPair("ES256", { extractable: true });
const publicJwk = {
  ...await exportJWK(keys.publicKey),
  alg: "ES256",
  kid: "k1",
};

/**
 * Answer the JWKS request with our stand-in key.
 *
 * Each test gets a distinct issuer origin so the module's per-issuer JWKS cache
 * never serves one test's key to another.
 */
function stubJwks(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/.well-known/jwks.json")) {
      return Promise.resolve(Response.json({ keys: [publicJwk] }));
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

interface TokenOverrides {
  issuer?: string;
  subject?: string;
  jkt?: string;
  /** Leave `cnf` off entirely. Distinct from `jkt`, whose default fills in. */
  omitCnf?: boolean;
  nickname?: string;
  expiresIn?: string;
  notBefore?: string;
}

function issueToken(overrides: TokenOverrides = {}): Promise<string> {
  const {
    issuer = ISSUER,
    subject = "idp-user-1",
    jkt = THUMBPRINT,
    omitCnf = false,
    nickname,
    expiresIn = "1h",
    notBefore = "0s",
  } = overrides;

  const claims: Record<string, unknown> = {};
  if (!omitCnf) claims.cnf = { jkt };
  if (nickname !== undefined) claims.nickname = nickname;

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(issuer)
    .setSubject(subject)
    .setIssuedAt()
    .setNotBefore(notBefore)
    .setExpirationTime(expiresIn)
    .sign(keys.privateKey);
}

/** Run `body` with the JWKS stub installed. */
async function withJwks(body: () => Promise<void>): Promise<void> {
  const restore = stubJwks();
  try {
    await body();
  } finally {
    restore();
  }
}

Deno.test("accepts a token bound to this request's key", async () => {
  const issuer = "https://idp-accept.test";
  await withJwks(async () => {
    const jws = await issueToken({ issuer, nickname: "kuboon" });
    const identity = await verifyIdpToken(jws, THUMBPRINT, issuer);
    assertEquals(identity.userId, "idp-user-1");
    assertEquals(identity.nickname, "kuboon");
  });
});

Deno.test("reports no nickname when the claim is absent", async () => {
  const issuer = "https://idp-nonick.test";
  await withJwks(async () => {
    const identity = await verifyIdpToken(
      await issueToken({ issuer }),
      THUMBPRINT,
      issuer,
    );
    assertEquals(identity.nickname, null);
  });
});

Deno.test("rejects a token bound to a different key", async () => {
  const issuer = "https://idp-otherkey.test";
  await withJwks(async () => {
    const jws = await issueToken({ issuer, jkt: "someone-elses-thumbprint" });
    const error = await assertRejects(
      () => verifyIdpToken(jws, THUMBPRINT, issuer),
      IdpTokenError,
    );
    assert(error.message.includes("different key"));
  });
});

Deno.test("rejects a token with no key binding at all", async () => {
  const issuer = "https://idp-nojkt.test";
  await withJwks(async () => {
    const jws = await issueToken({ issuer, omitCnf: true });
    await assertRejects(
      () => verifyIdpToken(jws, THUMBPRINT, issuer),
      IdpTokenError,
    );
  });
});

Deno.test("rejects a token from another issuer", async () => {
  const issuer = "https://idp-issuer.test";
  await withJwks(async () => {
    const jws = await issueToken({ issuer: "https://evil.test" });
    await assertRejects(
      () => verifyIdpToken(jws, THUMBPRINT, issuer),
      IdpTokenError,
    );
  });
});

Deno.test("rejects an expired token", async () => {
  const issuer = "https://idp-expired.test";
  await withJwks(async () => {
    const jws = await issueToken({ issuer, expiresIn: "-1s" });
    await assertRejects(
      () => verifyIdpToken(jws, THUMBPRINT, issuer),
      IdpTokenError,
    );
  });
});

Deno.test("rejects a token that is not yet valid", async () => {
  const issuer = "https://idp-nbf.test";
  await withJwks(async () => {
    const jws = await issueToken({ issuer, notBefore: "1h" });
    await assertRejects(
      () => verifyIdpToken(jws, THUMBPRINT, issuer),
      IdpTokenError,
    );
  });
});

Deno.test("rejects a token that is not a JWS", async () => {
  const issuer = "https://idp-garbage.test";
  await withJwks(async () => {
    await assertRejects(
      () => verifyIdpToken("not.a.token", THUMBPRINT, issuer),
      IdpTokenError,
    );
  });
});
