import { assertEquals } from "@std/assert";

import { MASKED_TITLE, publicTitle } from "./spoilers.ts";

Deno.test("shows an ordinary achievement's title", () => {
  assertEquals(
    publicTitle({ title: "First Clear", hidden: false }),
    "First Clear",
  );
});

Deno.test("never lets a hidden achievement's title out", () => {
  // The one that matters: a profile page is public, so this is the difference
  // between a game keeping its secrets and losing them to a shared link.
  assertEquals(
    publicTitle({ title: "Secret Ending", hidden: true }),
    MASKED_TITLE,
  );
});
