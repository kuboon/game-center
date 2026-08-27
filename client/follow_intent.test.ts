/// <reference lib="deno.ns" />
/**
 * The follow that waits for a sign-in.
 *
 * Browser code, so `sessionStorage` is stubbed. What is worth pinning down is
 * that the request fires exactly once and that unavailable storage costs a
 * button press rather than an exception.
 */

import { assertEquals } from "@std/assert";

import { rememberFollowIntent, takeFollowIntent } from "./follow_intent.ts";

/** A `sessionStorage` that works, or one that refuses everything. */
function stubStorage(broken = false): () => void {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      if (broken) throw new DOMException("denied", "SecurityError");
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (broken) throw new DOMException("denied", "SecurityError");
      values.set(key, value);
    },
    removeItem(key: string) {
      if (broken) throw new DOMException("denied", "SecurityError");
      values.delete(key);
    },
  };
  // defineProperty, not assignment: Deno supplies a real `sessionStorage` as
  // an own property of the global, and assigning to it silently does nothing —
  // which quietly turns every test here into a test of Deno's storage.
  const previous = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  Object.defineProperty(globalThis, "sessionStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
  };
}

Deno.test("carries the handle across a sign-in", () => {
  const restore = stubStorage();
  try {
    rememberFollowIntent("alice");
    assertEquals(takeFollowIntent(), "alice");
  } finally {
    restore();
  }
});

Deno.test("fires once and only once", () => {
  const restore = stubStorage();
  try {
    rememberFollowIntent("alice");
    assertEquals(takeFollowIntent(), "alice");
    // Reading clears it, so a request from an earlier page cannot wait around
    // to fire on some unrelated profile later in the same visit.
    assertEquals(takeFollowIntent(), null);
  } finally {
    restore();
  }
});

Deno.test("has nothing to report when nobody asked", () => {
  const restore = stubStorage();
  try {
    assertEquals(takeFollowIntent(), null);
  } finally {
    restore();
  }
});

Deno.test("survives storage the browser will not give us", () => {
  const restore = stubStorage(true);
  try {
    // A private window, or a browser set to block site data. The visitor still
    // signs in; they press the button once more.
    rememberFollowIntent("alice");
    assertEquals(takeFollowIntent(), null);
  } finally {
    restore();
  }
});
