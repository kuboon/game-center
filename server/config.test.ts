import { assertEquals } from "@std/assert";

import { readConfig } from "./config.ts";

Deno.test("reads Turso settings from the environment", () => {
  const config = readConfig({
    TURSO_DATABASE_URL: "libsql://example.turso.io",
    TURSO_AUTH_TOKEN: "token",
  });
  assertEquals(config.tursoDatabaseUrl, "libsql://example.turso.io");
  assertEquals(config.tursoAuthToken, "token");
});

Deno.test("falls back to empty strings when unset", () => {
  const config = readConfig({});
  assertEquals(config.tursoDatabaseUrl, "");
  assertEquals(config.tursoAuthToken, "");
});

Deno.test("defaults the IdP and hub origins to production", () => {
  const config = readConfig({});
  assertEquals(config.idpOrigin, "https://id.kbn.one");
  assertEquals(config.rpOrigin, "https://ga-cen.kbn.one");
});

Deno.test("has no signing key unless one is set", () => {
  // Launching is off rather than falling back to a generated key: on Deno
  // Deploy each isolate would generate its own and sign tokens no other
  // isolate could verify.
  assertEquals(readConfig({}).rpSigningKeyJwk, "");
  assertEquals(
    readConfig({ RP_SIGNING_KEY_JWK: '{"kty":"EC"}' }).rpSigningKeyJwk,
    '{"kty":"EC"}',
  );
});

Deno.test("lets the environment point at a local IdP", () => {
  const config = readConfig({
    IDP_ORIGIN: "http://localhost:8001",
    RP_ORIGIN: "http://localhost:8000",
  });
  assertEquals(config.idpOrigin, "http://localhost:8001");
  assertEquals(config.rpOrigin, "http://localhost:8000");
});
