import { assert, assertEquals } from "@std/assert";

import {
  extractManifestScript,
  formatIssues,
  gameRef,
  MANIFEST_SCRIPT_TYPE,
  parseGameRef,
  parseManifest,
  parseManifestText,
  type ParseResult,
} from "./mod.ts";

/** A manifest with everything filled in, as a base for the invalid cases. */
const valid = () => ({
  id: "my-puzzle",
  author: "kuboon",
  title: "My Puzzle",
  description: "3分で遊べるパズル",
  url: "https://example.github.io/my-puzzle/",
  icon: "https://example.github.io/my-puzzle/icon.png",
  achievements: [
    {
      key: "first_clear",
      title: "はじめてのクリア",
      description: "ステージ1をクリアする",
      points: 10,
      hidden: false,
    },
  ],
});

/** The issue paths a result carries, for asserting on what was rejected. */
function paths(result: ParseResult): string[] {
  assert(!result.ok, "expected the manifest to be rejected");
  return result.issues.map((issue) => issue.path);
}

Deno.test("accepts a complete manifest", () => {
  const result = parseManifest(valid());
  assert(result.ok, "a complete manifest should parse");
  assertEquals(result.manifest.id, "my-puzzle");
  assertEquals(
    result.manifest.iconUrl,
    "https://example.github.io/my-puzzle/icon.png",
  );
  assertEquals(result.manifest.achievements[0].points, 10);
});

Deno.test("fills in the optional achievement fields", () => {
  const result = parseManifest({
    ...valid(),
    achievements: [{ key: "first_clear", title: "はじめてのクリア" }],
  });
  assert(result.ok);
  assertEquals(result.manifest.achievements[0].points, 0);
  assertEquals(result.manifest.achievements[0].hidden, false);
  assertEquals(result.manifest.achievements[0].description, undefined);
});

Deno.test("accepts a game with no achievements yet", () => {
  const result = parseManifest({ ...valid(), achievements: [] });
  assert(result.ok);
  assertEquals(result.manifest.achievements.length, 0);
});

Deno.test("rejects anything that is not an object", () => {
  for (const value of ["a string", 42, null, [], undefined]) {
    const result = parseManifest(value);
    assert(
      !result.ok,
      `${JSON.stringify(value) ?? "undefined"} should not parse`,
    );
  }
});

Deno.test("reports every missing required field at once", () => {
  const result = parseManifest({});
  assertEquals(paths(result).sort(), [
    "achievements",
    "author",
    "id",
    "title",
  ]);
});

Deno.test("accepts a manifest with no url, since its location is its url", () => {
  const { url: _, ...withoutUrl } = valid();
  const result = parseManifest(withoutUrl);
  assert(result.ok, "url should be optional");
  assertEquals(result.manifest.url, undefined);
});

Deno.test("leaves a relative icon alone, for the registry to resolve", () => {
  const result = parseManifest({ ...valid(), icon: "icon.png" });
  assert(result.ok);
  assertEquals(result.manifest.iconUrl, "icon.png");
});

Deno.test("rejects a slug that would not survive a URL", () => {
  for (
    const id of [
      "My-Puzzle",
      "my puzzle",
      "-leading",
      "trailing-",
      "ab",
      "パズル",
    ]
  ) {
    assertEquals(
      paths(parseManifest({ ...valid(), id })),
      ["id"],
      `accepted: ${id}`,
    );
  }
});

Deno.test("rejects an author that could not survive a URL", () => {
  for (const author of ["ku boon", "-lead", "trail-", "a", "作者", "a/b", ""]) {
    assertEquals(
      paths(parseManifest({ ...valid(), author })),
      ["author"],
      `accepted: ${author}`,
    );
  }
});

Deno.test("takes whatever shape the IdP issues as a handle", () => {
  // Not ours to legislate: a UUID, an opaque token, or a number are all ids
  // someone might actually sign in with.
  for (
    const author of [
      "550e8400-e29b-41d4-a716-446655440000",
      "Vk9tZ3JlZW4",
      "1042",
      "kuboon",
    ]
  ) {
    assert(parseManifest({ ...valid(), author }).ok, `rejected: ${author}`);
  }
});

Deno.test("rejects a game url that is not https", () => {
  assertEquals(
    paths(parseManifest({ ...valid(), url: "http://example.com/" })),
    [
      "url",
    ],
  );
  assertEquals(paths(parseManifest({ ...valid(), url: "/relative" })), ["url"]);
  assertEquals(
    paths(parseManifest({ ...valid(), url: "javascript:alert(1)" })),
    ["url"],
  );
});

Deno.test("allows http for localhost, so a game can be developed first", () => {
  assert(parseManifest({ ...valid(), url: "http://localhost:8080/" }).ok);
  assert(parseManifest({ ...valid(), url: "http://127.0.0.1:8080/" }).ok);
});

Deno.test("rejects a duplicated achievement key", () => {
  const result = parseManifest({
    ...valid(),
    achievements: [
      { key: "same", title: "One" },
      { key: "same", title: "Two" },
    ],
  });
  assertEquals(paths(result), ["achievements[1].key"]);
});

Deno.test("rejects malformed achievement keys and negative points", () => {
  const result = parseManifest({
    ...valid(),
    achievements: [
      { key: "Shouty", title: "One" },
      { key: "fine", title: "Two", points: -1 },
    ],
  });
  assertEquals(paths(result), [
    "achievements[0].key",
    "achievements[1].points",
  ]);
});

Deno.test("rejects achievements that are not an array", () => {
  assertEquals(paths(parseManifest({ ...valid(), achievements: {} })), [
    "achievements",
  ]);
});

Deno.test("names the offending achievement by index", () => {
  const result = parseManifest({
    ...valid(),
    achievements: [{ key: "ok", title: "One" }, { key: "no-title" }],
  });
  assertEquals(paths(result), ["achievements[1].title"]);
});

Deno.test("formats issues one per line, with the field first", () => {
  const result = parseManifest({});
  assert(!result.ok);
  const text = formatIssues(result.issues);
  assertEquals(text.split("\n").length, 4);
  assert(text.includes("id: is required"), text);
});

Deno.test("reports broken JSON like any other mistake in the document", () => {
  const result = parseManifestText("{ not json");
  assert(!result.ok);
  assertEquals(result.issues.length, 1);
  assert(result.issues[0].message.startsWith("is not valid JSON"));
});

Deno.test("finds an embedded manifest among other scripts", () => {
  const html = `<!doctype html><html><head>
    <script src="/game.js"></script>
    <script type="application/ld+json">{"@type":"WebSite"}</script>
    <script type="${MANIFEST_SCRIPT_TYPE}">{"id":"my-puzzle"}</script>
    </head><body></body></html>`;
  assertEquals(extractManifestScript(html)?.trim(), '{"id":"my-puzzle"}');
});

Deno.test("reads the type attribute however it was written", () => {
  for (
    const tag of [
      `<script type='${MANIFEST_SCRIPT_TYPE}'>`,
      `<script  TYPE = "${MANIFEST_SCRIPT_TYPE}" >`,
      `<script id="gc" type=${MANIFEST_SCRIPT_TYPE}>`,
    ]
  ) {
    assertEquals(
      extractManifestScript(`${tag}{"id":"x"}</script>`),
      '{"id":"x"}',
      tag,
    );
  }
});

Deno.test("finds nothing in a page that declares no manifest", () => {
  assertEquals(extractManifestScript("<html><body>hi</body></html>"), null);
  assertEquals(
    extractManifestScript('<script type="application/json">{}</script>'),
    null,
  );
  assertEquals(extractManifestScript('<script src="/game.js"></script>'), null);
});

Deno.test("ends the script where a browser would", () => {
  // HTML forbids `</script` inside a script element, so a manifest that needs
  // the sequence has to escape it — and stopping at the first one is what the
  // browser does too.
  const html =
    `<script type="${MANIFEST_SCRIPT_TYPE}">{"title":"a<\\/script>b"}</script><p>after`;
  const text = extractManifestScript(html);
  assertEquals(text, '{"title":"a<\\/script>b"}');
});

Deno.test("a game's full name is its author and its slug", () => {
  assertEquals(gameRef("kuboon", "my-puzzle"), "kuboon/my-puzzle");
  assertEquals(parseGameRef("kuboon/my-puzzle"), {
    author: "kuboon",
    slug: "my-puzzle",
  });
  // The leading @ is how it is written in a URL.
  assertEquals(parseGameRef("@kuboon/my-puzzle")?.author, "kuboon");
});

Deno.test("refuses a reference that is not one", () => {
  for (
    const ref of [
      "my-puzzle",
      "kuboon/",
      "/my-puzzle",
      "kuboon/my-puzzle/extra",
      "kuboon/My-Puzzle",
      "",
    ]
  ) {
    assertEquals(parseGameRef(ref), null, `accepted: ${ref}`);
  }
});
