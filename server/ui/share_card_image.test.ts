import { assertEquals, assertNotEquals } from "@std/assert";

import { shareCardPng, shareCardSize } from "./share_card_image.ts";

Deno.test("the card is the shape a large social card is cropped to", () => {
  // 1.91:1. A card drawn at another shape is cut down to this one anyway.
  assertEquals(
    shareCardSize.width / shareCardSize.height,
    1200 / 630,
  );
});

Deno.test("a copy of this hub prints its own host on the card", async () => {
  // The bottom line comes from `RP_ORIGIN`, so a fork does not hand out a
  // picture naming the original.
  const mine = await shareCardPng("ga-cen.kbn.one");
  const theirs = await shareCardPng("games.example.com");
  assertNotEquals(Array.from(mine), Array.from(theirs));
});

Deno.test("the drawing is done once per host", async () => {
  const first = await shareCardPng("ga-cen.kbn.one");
  const second = await shareCardPng("ga-cen.kbn.one");
  // The same bytes, not merely equal ones: crawlers ask rarely, and redrawing
  // per request would be paying for a picture that cannot change.
  assertEquals(first === second, true);
});
