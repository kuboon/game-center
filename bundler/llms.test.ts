/**
 * What `/llms.txt` has to contain.
 *
 * Asserted against the assembled text rather than the served route: the route
 * is `staticFiles` reading `bundled/`, so testing it there would only pass on a
 * machine that had already run the build — which is exactly how this slipped
 * through locally and 404'd in CI.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { buildLlmsTxt } from "./llms.ts";

const built = await buildLlmsTxt({ write: false });

Deno.test("carries the specification, not a summary of it", async () => {
  const protocol = await Deno.readTextFile(
    new URL("../docs/protocol.md", import.meta.url),
  );
  // Generated from the source of truth. A file that restates a specification
  // is a file that will disagree with it.
  assertStringIncludes(built.text, protocol);
});

Deno.test("carries the SDK a game would otherwise have to fetch", async () => {
  const sdk = await Deno.readTextFile(
    new URL("../packages/sdk/mod.ts", import.meta.url),
  );
  assertStringIncludes(built.text, sdk);
  assertStringIncludes(built.text, "export class GameCenter");
});

Deno.test("answers the questions a model would otherwise go looking for", () => {
  for (
    const needle of [
      // Where the manifest goes.
      'type="application/gamecenter+json"',
      // How to register, and that it takes no credential.
      "/api/registry/v1/games",
      // The unlock path that works from an Artifact.
      "/claim/@",
      // A complete page it can copy.
      "最小の実例",
      // Where its own author id comes from.
      "/me",
    ]
  ) {
    assertStringIncludes(built.text, needle);
  }
});

Deno.test("writes nothing when only assembling", async () => {
  const before = await size();
  await buildLlmsTxt({ write: false });
  assertEquals(await size(), before);
});

Deno.test("is one file, not a table of contents", () => {
  // The point is that nothing else has to be fetched. If this ever shrinks to
  // a page of links, that has stopped being true.
  assert(built.bytes > 8000, `only ${built.bytes} bytes`);
});

/** The built file's size, or null when it has not been built. */
async function size(): Promise<number | null> {
  try {
    return (await Deno.stat(built.output)).size;
  } catch {
    return null;
  }
}
