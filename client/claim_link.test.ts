/// <reference lib="deno.ns" />
/**
 * The claim link's format, from the side that has to read what a game wrote.
 *
 * The SDK builds this string and nothing is shared between the two, so these
 * tests are the only place the two halves are held against each other.
 */

import { assertEquals } from "@std/assert";

import { claimedFragment, parseClaimLink } from "./claim_link.ts";

Deno.test("reads keys and scores out of a fragment", () => {
  assertEquals(parseClaimLink("#gc=first_clear,high_score:1200"), [
    { key: "first_clear", score: null },
    { key: "high_score", score: 1200 },
  ]);
});

Deno.test("does not mind a missing leading hash", () => {
  assertEquals(parseClaimLink("gc=first_clear"), [
    { key: "first_clear", score: null },
  ]);
});

Deno.test("finds nothing in a fragment that carries something else", () => {
  assertEquals(parseClaimLink("#gctoken=abc"), []);
  assertEquals(parseClaimLink(""), []);
});

Deno.test("keeps the unlock when the score is not an integer", () => {
  // The score is the optional half. A game that wrote it wrong still earned
  // the achievement, and refusing the entry would lose that.
  assertEquals(parseClaimLink("#gc=high_score:nope"), [
    { key: "high_score", score: null },
  ]);
});

Deno.test("takes the first of a repeated key", () => {
  assertEquals(parseClaimLink("#gc=a:1,a:2"), [{ key: "a", score: 1 }]);
});

Deno.test("names what the game may forget", () => {
  assertEquals(claimedFragment(["a", "b"]), "#gcclaimed=a,b");
});
