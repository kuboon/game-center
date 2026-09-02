/// <reference lib="deno.ns" />
/**
 * What a frame load asks the server for.
 *
 * One rule, and the browser's Back button depends on it: **only a named frame
 * asks for a fragment.** The runtime passes the reloading frame's own name as
 * `target`, and the top frame — the document — has none.
 *
 * Getting this wrong is invisible. The build stays green, forward navigation
 * keeps working, and the only symptom is that traversing back to the first
 * history entry (the one the runtime seeds with no target) changes the URL and
 * leaves the page alone, because the hub answered a document reload with a
 * bare `<main>`.
 */

import { assertEquals } from "@std/assert";

import { FRAME_HEADER, frameRequestInit, TARGET_HEADER } from "./frame.ts";

const headersOf = (init: RequestInit) => new Headers(init.headers);

Deno.test("a named frame asks for the fragment, and says which frame", () => {
  const headers = headersOf(frameRequestInit({ target: "content" }));

  assertEquals(headers.get(FRAME_HEADER), "1");
  assertEquals(headers.get(TARGET_HEADER), "content");
});

Deno.test("the top frame asks for the whole document", () => {
  // No target is the document reloading itself — a history traversal back to
  // the first entry, say. A fragment is not something a document can be
  // diffed against.
  for (const options of [undefined, {}, { target: undefined }]) {
    const headers = headersOf(frameRequestInit(options));

    assertEquals(headers.get(FRAME_HEADER), null);
    assertEquals(headers.get(TARGET_HEADER), null);
  }
});

Deno.test("every frame load accepts HTML", () => {
  for (const options of [undefined, { target: "content" }]) {
    assertEquals(
      headersOf(frameRequestInit(options)).get("accept"),
      "text/html",
    );
  }
});

Deno.test("the abort signal is passed through", () => {
  const signal = AbortSignal.abort();

  assertEquals(frameRequestInit({ signal }).signal, signal);
  assertEquals(frameRequestInit().signal, undefined);
});
