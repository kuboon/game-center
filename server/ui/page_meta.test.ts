import { assertEquals } from "@std/assert";

import { absoluteUrl, pageTitle, SITE_NAME, summarize } from "./page_meta.ts";

Deno.test("puts the page first and the site name last", () => {
  // A truncated tab should still say which page it is, and a card headline
  // should not be three-quarters branding.
  assertEquals(pageTitle({ title: "Puzzle" }), "Puzzle — game-center");
});

Deno.test("does not repeat the site name back to itself", () => {
  assertEquals(pageTitle({ title: SITE_NAME }), SITE_NAME);
  assertEquals(pageTitle(undefined), SITE_NAME);
});

Deno.test("makes a hub path absolute for crawlers", () => {
  assertEquals(absoluteUrl("/@kuboon"), "https://ga-cen.kbn.one/@kuboon");
});

Deno.test("leaves an already-absolute URL alone", () => {
  // A game's icon comes from its manifest and is already somewhere else.
  assertEquals(
    absoluteUrl("https://example.github.io/puzzle/icon.png"),
    "https://example.github.io/puzzle/icon.png",
  );
});

Deno.test("has no URL to offer when there is nothing to resolve", () => {
  assertEquals(absoluteUrl(null), undefined);
  assertEquals(absoluteUrl(undefined), undefined);
  assertEquals(absoluteUrl(""), undefined);
});

Deno.test("flattens a description onto one line", () => {
  assertEquals(summarize("  a\n\n  b  "), "a b");
});

Deno.test("cuts a long description to something a card will show", () => {
  const long = "あ".repeat(300);
  const short = summarize(long);
  assertEquals(short?.length, 160);
  assertEquals(short?.endsWith("…"), true);
});

Deno.test("treats a blank description as no description", () => {
  assertEquals(summarize("   \n "), undefined);
  assertEquals(summarize(null), undefined);
});
