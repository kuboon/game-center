/// <reference lib="deno.ns" />
/**
 * The feedback draft's format, from the side that reads what a game wrote.
 *
 * The SDK builds the fragment and nothing is shared between the two, so these
 * tests hold the halves against each other: the strings here are the ones
 * `feedbackUrl()` produces.
 */

import { assertEquals } from "@std/assert";

import { parseFeedbackDraft } from "./feedback_draft.ts";

Deno.test("reads the kind and the message", () => {
  assertEquals(
    parseFeedbackDraft(
      "#kind=bug&message=%E3%82%B9%E3%83%86%E3%83%BC%E3%82%B83",
    ),
    { kind: "bug", message: "ステージ3" },
  );
});

Deno.test("keeps what URLSearchParams wrote, spaces and line breaks included", () => {
  // The SDK builds the fragment with URLSearchParams, which writes a space as
  // `+`. A hand-written link uses encodeURIComponent, which writes `%20`.
  const written = new URLSearchParams({ message: "a b\nc+d" }).toString();
  assertEquals(parseFeedbackDraft(written), { message: "a b\nc+d" });
  assertEquals(
    parseFeedbackDraft(`message=${encodeURIComponent("a b\nc+d")}`),
    { message: "a b\nc+d" },
  );
});

Deno.test("drops a kind the form does not offer", () => {
  assertEquals(parseFeedbackDraft("#kind=praise&message=hi"), {
    message: "hi",
  });
});

Deno.test("finds nothing in a fragment that carries something else", () => {
  assertEquals(parseFeedbackDraft("#gc=first_clear"), {});
  assertEquals(parseFeedbackDraft(""), {});
  assertEquals(parseFeedbackDraft("#message="), {});
});
