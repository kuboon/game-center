/**
 * The counter that keeps the unauthenticated registry endpoint from being a
 * way to make this server fetch whatever anyone likes, as fast as they like.
 *
 * Against a real database because the whole thing is one upsert, and what is
 * worth checking is that the upsert counts correctly.
 */

import { assertEquals } from "@std/assert";

import { callerAddress, takeToken } from "../server/lib/rate_limit.ts";
import { migratedDb } from "./support/db.ts";

/**
 * Three calls a minute, starting exactly on a window boundary.
 *
 * Aligned on purpose: with an arbitrary `now` the tests below would have to
 * know how far into the window it fell, and "30 seconds later" would silently
 * mean "next window" whenever it did not.
 */
const WINDOW_START = 1_000_000_020_000;
const LIMIT = { limit: 3, windowSeconds: 60, now: WINDOW_START };

Deno.test("allows up to the limit and refuses after it", async () => {
  await migratedDb(async (client) => {
    for (let i = 1; i <= 3; i++) {
      const result = await takeToken(client, "1.2.3.4", LIMIT);
      assertEquals(result.allowed, true, `call ${i}`);
    }
    const refused = await takeToken(client, "1.2.3.4", LIMIT);
    assertEquals(refused.allowed, false);
    assertEquals(refused.retryAfter > 0, true);
  });
});

Deno.test("counts the calls it refuses", async () => {
  await migratedDb(async (client) => {
    for (let i = 0; i < 5; i++) await takeToken(client, "1.2.3.4", LIMIT);

    // Still refused: hammering a closed door must not reset the window, or the
    // limit rewards whoever ignores it.
    const later = await takeToken(client, "1.2.3.4", {
      ...LIMIT,
      now: LIMIT.now + 30_000,
    });
    assertEquals(later.allowed, false);
  });
});

Deno.test("keeps one caller's count away from another's", async () => {
  await migratedDb(async (client) => {
    for (let i = 0; i < 4; i++) await takeToken(client, "1.2.3.4", LIMIT);
    assertEquals(
      (await takeToken(client, "5.6.7.8", LIMIT)).allowed,
      true,
    );
  });
});

Deno.test("lets the caller through again in the next window", async () => {
  await migratedDb(async (client) => {
    for (let i = 0; i < 4; i++) await takeToken(client, "1.2.3.4", LIMIT);
    const next = await takeToken(client, "1.2.3.4", {
      ...LIMIT,
      now: LIMIT.now + 60_000,
    });
    assertEquals(next.allowed, true);
  });
});

Deno.test("stamps an expiry so a passed window does not linger", async () => {
  await migratedDb(async (client) => {
    await takeToken(client, "1.2.3.4", LIMIT);
    const row = await client.execute("select key, expires_at from kv");
    assertEquals(row.rows.length, 1);
    // The end of the window this call fell in.
    assertEquals(Number(row.rows[0].expires_at), 1_000_000_080);
  });
});

Deno.test("reads the client's address from the proxy's header", () => {
  const request = (headers: Record<string, string>) =>
    new Request("https://ga-cen.kbn.one/", { headers });

  assertEquals(
    callerAddress(request({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" })),
    "203.0.113.7",
  );
  // Nothing to go on. Everyone shares one bucket rather than nobody being
  // counted at all.
  assertEquals(callerAddress(request({})), "unknown");
  assertEquals(callerAddress(request({ "x-forwarded-for": " " })), "unknown");
});
