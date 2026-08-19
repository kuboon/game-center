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
