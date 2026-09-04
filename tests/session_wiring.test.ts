/**
 * Every clientEntry reaches the session through `mountSession`.
 *
 * Here rather than beside the entries because reading them needs read
 * permission, and the `-P` suite has none.
 *
 * Read as source rather than exercised, because what this is watching for is a
 * shape that type-checks, renders, and passes every test — and then fails only
 * on a frame navigation, which is how people actually move around the hub.
 *
 * Two ways to get it wrong, both documented on `mountSession`:
 *
 * - Subscribing to `change` and waiting for it. An entry mounted into a page
 *   whose session settled minutes ago waits for an event that already
 *   happened, so it never fetches anything. `/@{handle}` lost its follow
 *   button this way, and the game page stopped minting launch tokens.
 * - Rendering from `sessionStore.ready`. The server had no session and
 *   rendered the unknown state; a browser that already knows renders something
 *   else, and the two disagree — a hydration mismatch, and for a moment a
 *   `遊ぶ` link with no token on it.
 */

import { assertEquals } from "@std/assert";

const CLIENT = new URL("../client/", import.meta.url);

/** Every clientEntry in this directory, with its source. */
async function entries(): Promise<[string, string][]> {
  const found: [string, string][] = [];
  for await (const entry of Deno.readDir(CLIENT)) {
    if (!entry.isFile || !entry.name.endsWith(".tsx")) continue;
    const source = await Deno.readTextFile(new URL(entry.name, CLIENT));
    if (source.includes("clientEntry(")) found.push([entry.name, source]);
  }
  return found.sort();
}

Deno.test("no clientEntry subscribes to the session by hand", async () => {
  const offenders = (await entries())
    .filter(([, source]) =>
      source.includes('sessionStore.addEventListener("change"')
    )
    .map(([name]) => name);
  assertEquals(offenders, [], "use mountSession() instead");
});

Deno.test("no clientEntry kicks the session by hand", async () => {
  const offenders = (await entries())
    .filter(([, source]) => source.includes("sessionStore.load()"))
    .map(([name]) => name);
  assertEquals(offenders, [], "mountSession() already calls load()");
});

Deno.test("no clientEntry renders from the store's own readiness", async () => {
  const offenders = (await entries())
    .filter(([, source]) => source.includes("sessionStore.ready"))
    .map(([name]) => name);
  assertEquals(
    offenders,
    [],
    "render from the mount's `ready`, not the store's",
  );
});

Deno.test("the guards would notice", () => {
  // Vacuous otherwise: all three look for something absent, so they would pass
  // just as well against a directory with nothing in it.
  const offender = 'sessionStore.addEventListener("change", () => x());';
  assertEquals(
    offender.includes('sessionStore.addEventListener("change"'),
    true,
  );
});

Deno.test("every entry that reaches the session goes through the helper", async () => {
  const reaching = (await entries())
    .filter(([, source]) => source.includes("sessionStore."));

  // Not every clientEntry needs a session — the install card is about the
  // browser, not the player — so this counts the ones that do.
  assertEquals(reaching.length > 5, true);
  assertEquals(
    reaching.filter(([, source]) => !source.includes("mountSession(")).map((
      [name],
    ) => name),
    [],
  );
});
