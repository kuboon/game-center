import { assert, assertEquals } from "@std/assert";

import { formatIssues, parseManifest, type ParseResult } from "./mod.ts";

/** A manifest with everything filled in, as a base for the invalid cases. */
const valid = () => ({
  id: "my-puzzle",
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
  assertEquals(paths(result).sort(), ["achievements", "id", "title", "url"]);
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
