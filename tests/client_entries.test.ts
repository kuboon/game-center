/**
 * Every `clientEntry` is something the bundler was told to build.
 *
 * The entry id is a URL the server-rendered marker names — `/share_row.js` —
 * and the browser fetches it at hydration. A component that declares one
 * without `bundler/js.ts` listing its file ships a marker pointing at a 404:
 * the page renders, the type checker is happy, the build is green, and the
 * component simply never wakes up. Exactly the shape of failure the rest of
 * this directory exists to catch.
 *
 * Here rather than beside the bundler because reading the source of every
 * entry needs read permission, and the `-P` suite has none.
 */

import { assertEquals } from "@std/assert";

const CLIENT = new URL("../client/", import.meta.url);
const JS_BUILDER = new URL("../bundler/js.ts", import.meta.url);

/** `clientEntry("/play_button.js#PlayButton", …)` → `play_button.js`. */
const ENTRY_ID = /clientEntry\(\s*"\/([A-Za-z0-9_.-]+\.js)#/g;

/** The bundle each client file declares it is compiled into. */
async function declared(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for await (const entry of Deno.readDir(CLIENT)) {
    if (!entry.isFile || !entry.name.endsWith(".tsx")) continue;
    const source = await Deno.readTextFile(new URL(entry.name, CLIENT));
    for (const match of source.matchAll(ENTRY_ID)) {
      found.set(match[1], entry.name);
    }
  }
  return found;
}

/** The files `bundler/js.ts` compiles. */
async function built(): Promise<Set<string>> {
  const source = await Deno.readTextFile(JS_BUILDER);
  const list = source.match(/CLIENT_ENTRIES = \[([^\]]*)\]/s)?.[1] ?? "";
  return new Set(
    [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]),
  );
}

Deno.test("every clientEntry names a bundle the build produces", async () => {
  const entries = await built();
  const missing: string[] = [];
  for (const [bundle, file] of await declared()) {
    // The id is the source file with its extension swapped, by convention.
    if (!entries.has(file)) missing.push(`${file} (serves /${bundle})`);
  }
  assertEquals(
    missing.sort(),
    [],
    "add these to CLIENT_ENTRIES in bundler/js.ts",
  );
});

Deno.test("a clientEntry's id matches the file it lives in", async () => {
  const wrong: string[] = [];
  for (const [bundle, file] of await declared()) {
    if (bundle !== file.replace(/\.tsx$/, ".js")) {
      wrong.push(`${file} declares /${bundle}`);
    }
  }
  // The bundler names the output after the source, so an id that disagrees is
  // a 404 even when both names are listed.
  assertEquals(wrong.sort(), []);
});
