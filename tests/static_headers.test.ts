/**
 * What `bundled/` tells browsers about caching.
 *
 * Here rather than beside the router because serving a file needs read
 * permission, and the `-P` suite has none. The fixtures are written into
 * `bundled/` so the assertion does not depend on a build having run.
 *
 * The bug this pins down: entry points are named by the server-rendered markup
 * (`/play_button.js`), so a deploy swaps the file behind a URL the browser
 * already holds. A browser given no directive may reuse it, and then the page
 * runs the previous deploy's component against this deploy's HTML — the old
 * component renders a different element than the server did and both end up on
 * screen. Chunks are content-hashed and have the opposite need.
 */

import { assertEquals } from "@std/assert";

import router from "../server/router.ts";

const BUNDLED = new URL("../bundled/", import.meta.url);

async function withFixture(
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  await Deno.mkdir(BUNDLED, { recursive: true });
  const file = new URL(name, BUNDLED);
  await Deno.writeTextFile(file, "export const fixture = 1;\n");
  try {
    await fn();
  } finally {
    await Deno.remove(file);
  }
}

Deno.test("an entry point is revalidated on every load", async () => {
  await withFixture("static-headers-fixture.js", async () => {
    const response = await router.fetch(
      new Request("http://localhost/static-headers-fixture.js"),
    );
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("cache-control"), "no-cache");
    await response.body?.cancel();
  });
});

Deno.test("a content-hashed chunk is cached forever", async () => {
  await withFixture("chunk-STATICHEADERS.js", async () => {
    const response = await router.fetch(
      new Request("http://localhost/chunk-STATICHEADERS.js"),
    );
    assertEquals(response.status, 200);
    assertEquals(
      response.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
    await response.body?.cancel();
  });
});
