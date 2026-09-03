/**
 * Proving the hub's identity to the IdP.
 *
 * The IdP fetches `{clientId}/.well-known/jwks.json` and verifies the client
 * assertion against it, so the two have to agree on everything: the `kid`, the
 * curve, and the claims. Both sides of that are checked here by verifying a
 * real assertion against the real published key.
 *
 * The other thing worth pinning down is that the published set carries no
 * private half. Publishing `d` would hand anyone the ability to speak as this
 * hub, and it is one careless spread away.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { exportJWK, generateKeyPair, importJWK, jwtVerify } from "jose";

import {
  clientAssertion,
  NoSigningKeyError,
  publicJwk,
  publicJwks,
} from "./rp_identity.ts";

const RP = "https://ga-cen.example";
const IDP = "https://id.example";

async function config() {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return {
    rpOrigin: RP,
    idpOrigin: IDP,
    rpSigningKeyJwk: JSON.stringify(await exportJWK(privateKey)),
  };
}

Deno.test("the published set never carries the private half", async () => {
  const { keys } = await publicJwks(await config());

  assertEquals(keys.length, 1);
  // `d` is the private scalar. One spread of the stored JWK would publish it.
  assertEquals(keys[0].d, undefined);
  assertEquals(keys[0].kty, "EC");
  assertEquals(keys[0].crv, "P-256");
  assertEquals(keys[0].alg, "ES256");
  assert(typeof keys[0].kid === "string" && keys[0].kid.length > 0);
});

Deno.test("the assertion verifies against the published key", async () => {
  const c = await config();
  const assertion = await clientAssertion(c);
  const jwk = await publicJwk(c);

  // Exactly what the IdP does: pick the key by `kid`, then verify.
  const { payload, protectedHeader } = await jwtVerify(
    assertion,
    await importJWK(jwk, "ES256"),
    { issuer: RP, audience: IDP },
  );

  assertEquals(protectedHeader.kid, jwk.kid);
  assertEquals(protectedHeader.typ, "client-assertion+jwt");
  // Issuer and subject are both the clientId — this hub's origin.
  assertEquals(payload.sub, RP);
  assert(typeof payload.jti === "string");
});

Deno.test("each assertion is single-use and short-lived", async () => {
  const c = await config();
  const [first, second] = await Promise.all([
    clientAssertion(c),
    clientAssertion(c),
  ]);

  const claims = async (jws: string) =>
    (await jwtVerify(jws, await importJWK(await publicJwk(c), "ES256"), {
      issuer: RP,
      audience: IDP,
    })).payload;

  const a = await claims(first);
  const b = await claims(second);

  // A replayed `jti` is what the IdP refuses, so two calls must not share one.
  assert(a.jti !== b.jti);
  assert(a.exp! - a.iat! <= 60);
});

Deno.test("no key means no assertion, rather than an unsigned one", async () => {
  const c = { rpOrigin: RP, idpOrigin: IDP, rpSigningKeyJwk: "" };
  await assertRejects(() => clientAssertion(c), NoSigningKeyError);
  await assertRejects(() => publicJwks(c), NoSigningKeyError);

  const broken = { ...c, rpSigningKeyJwk: "not json" };
  await assertRejects(() => clientAssertion(broken), NoSigningKeyError);
});
