/**
 * Manifest discovery, with a stub in place of the network.
 *
 * The hub fetches URLs that strangers name, so what is under test is as much
 * what it refuses as what it finds: private hosts, plain http, endless
 * redirects, and responses too large to be a manifest.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";

import { MANIFEST_SCRIPT_TYPE } from "@game-center/protocol";
import { fetchManifest, ManifestFetchError } from "./manifest_fetch.ts";

const PAGE = "https://example.github.io/my-puzzle/";
const MANIFEST = JSON.stringify({
  id: "my-puzzle",
  title: "My Puzzle",
  achievements: [{ key: "first_clear", title: "はじめてのクリア", points: 10 }],
});

/** A fetch that answers from a map of URL to response. */
function stub(routes: Record<string, Response | (() => Response)>) {
  return (input: string | URL | Request): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const route = routes[url];
    if (!route) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return Promise.resolve(typeof route === "function" ? route() : route);
  };
}

const html = (body: string) =>
  new Response(body, { headers: { "content-type": "text/html" } });

Deno.test("reads a manifest embedded in the game's page", async () => {
  const found = await fetchManifest(PAGE, {
    fetch: stub({
      [PAGE]: html(
        `<html><body><h1>My Puzzle</h1>
         <script type="${MANIFEST_SCRIPT_TYPE}">${MANIFEST}</script>
         </body></html>`,
      ),
    }),
  });

  assertEquals(found.source, "embedded");
  assertEquals(found.manifest.id, "my-puzzle");
  assertEquals(found.gameUrl, PAGE);
  assertEquals(found.manifestUrl, PAGE);
});

Deno.test("falls back to gamecenter.json beside the page", async () => {
  const found = await fetchManifest(PAGE, {
    fetch: stub({
      [PAGE]: html("<html><body>no manifest here</body></html>"),
      [`${PAGE}gamecenter.json`]: new Response(MANIFEST),
    }),
  });

  assertEquals(found.source, "file");
  assertEquals(found.manifestUrl, `${PAGE}gamecenter.json`);
  assertEquals(found.gameUrl, PAGE);
});

Deno.test("prefers the embedded manifest when both exist", async () => {
  const found = await fetchManifest(PAGE, {
    fetch: stub({
      [PAGE]: html(
        `<script type="${MANIFEST_SCRIPT_TYPE}">${MANIFEST}</script>`,
      ),
      [`${PAGE}gamecenter.json`]: new Response(
        JSON.stringify({ id: "stale", title: "Stale", achievements: [] }),
      ),
    }),
  });
  assertEquals(found.manifest.id, "my-puzzle");
});

Deno.test("says what is missing when a page carries no manifest at all", async () => {
  const error = await assertRejects(
    () =>
      fetchManifest(PAGE, {
        fetch: stub({ [PAGE]: html("<html><body>hi</body></html>") }),
      }),
    ManifestFetchError,
  );
  assert(error.message.includes(MANIFEST_SCRIPT_TYPE), error.message);
  assert(error.message.includes("gamecenter.json"), error.message);
});

Deno.test("reports the manifest's own problems field by field", async () => {
  const error = await assertRejects(
    () =>
      fetchManifest(PAGE, {
        fetch: stub({
          [PAGE]: html(
            `<script type="${MANIFEST_SCRIPT_TYPE}">{"title":"No id"}</script>`,
          ),
        }),
      }),
    ManifestFetchError,
  );
  assertEquals(error.issues.map((issue) => issue.path).sort(), [
    "achievements",
    "id",
  ]);
});

Deno.test("follows a redirect, and records where it landed", async () => {
  const moved = "https://example.com/games/my-puzzle/";
  const found = await fetchManifest(PAGE, {
    fetch: stub({
      [PAGE]: new Response(null, {
        status: 301,
        headers: { location: moved },
      }),
      [moved]: html(
        `<script type="${MANIFEST_SCRIPT_TYPE}">${MANIFEST}</script>`,
      ),
    }),
  });
  // The game is where it ended up, not where the registrant pointed.
  assertEquals(found.gameUrl, moved);
});

Deno.test("checks every redirect hop, not just the first URL", async () => {
  await assertRejects(
    () =>
      fetchManifest(PAGE, {
        fetch: stub({
          [PAGE]: new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          }),
        }),
      }),
    ManifestFetchError,
  );
});

Deno.test("gives up on a redirect loop", async () => {
  const other = "https://example.com/loop";
  await assertRejects(
    () =>
      fetchManifest(PAGE, {
        fetch: stub({
          [PAGE]: () =>
            new Response(null, { status: 302, headers: { location: other } }),
          [other]: () =>
            new Response(null, { status: 302, headers: { location: PAGE } }),
        }),
      }),
    ManifestFetchError,
  );
});

Deno.test("refuses to fetch anything but public https", async () => {
  for (
    const url of [
      "http://example.github.io/my-puzzle/",
      "https://localhost/my-puzzle/",
      "https://127.0.0.1/",
      "https://192.168.1.1/",
      "https://169.254.169.254/",
      "https://build.internal/game/",
      "file:///etc/passwd",
      "not-a-url",
    ]
  ) {
    await assertRejects(
      () => fetchManifest(url, { fetch: stub({}) }),
      ManifestFetchError,
      undefined,
      url,
    );
  }
});

Deno.test("stops reading a response that is too large to be a manifest", async () => {
  const huge = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
      }),
      { headers: { "content-type": "text/html" } },
    );
  const error = await assertRejects(
    () => fetchManifest(PAGE, { fetch: stub({ [PAGE]: huge }) }),
    ManifestFetchError,
  );
  assert(error.message.includes("larger than"), error.message);
});

Deno.test("passes on the status when a game's host says no", async () => {
  const error = await assertRejects(
    () =>
      fetchManifest(PAGE, {
        fetch: stub({ [PAGE]: new Response("gone", { status: 410 }) }),
      }),
    ManifestFetchError,
  );
  assert(error.message.includes("410"), error.message);
});
