/**
 * Rebuilding the preview branch, with a stub in place of the Platform API.
 *
 * This is the one piece of the repository that deletes a database, so most of
 * what is tested is when it refuses to.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";

import {
  type BranchConfig,
  databaseName,
  readBranchConfig,
  rebuildPreviewBranch,
} from "./preview_branch.ts";

const PREVIEW_URL =
  "libsql://game-center-preview-kuboon.aws-ap-northeast-1.turso.io";

/** An environment as Deno.env presents one. */
const env = (vars: Record<string, string>) => ({
  get: (key: string) => vars[key],
});

const configured = {
  TURSO_PLATFORM_TOKEN: "platform-token",
  TURSO_ORG: "kuboon",
  TURSO_SOURCE_DATABASE: "game-center",
  TURSO_DATABASE_URL: PREVIEW_URL,
};

Deno.test("reads the preview database's name out of its own URL", () => {
  // Named once, not twice: two names for one database is how the wrong one
  // gets deleted.
  assertEquals(databaseName(PREVIEW_URL, "kuboon"), "game-center-preview");
  assertEquals(
    databaseName("libsql://game-center-kuboon.turso.io", "kuboon"),
    "game-center",
  );
});

Deno.test("reads nothing from a URL that is not this organization's", () => {
  assertEquals(databaseName(PREVIEW_URL, "someone-else"), null);
  assertEquals(databaseName("not a url", "kuboon"), null);
});

Deno.test("stays inert until every part is configured", () => {
  assertEquals(readBranchConfig(env({})), null);
  for (const missing of Object.keys(configured)) {
    const partial = { ...configured };
    delete (partial as Record<string, string>)[missing];
    assertEquals(readBranchConfig(env(partial)), null, `without ${missing}`);
  }
  assert(readBranchConfig(env(configured)));
});

Deno.test("refuses to rebuild the database it would copy from", () => {
  // The one unrecoverable mistake: a preview URL that resolves to production.
  assertThrows(
    () =>
      readBranchConfig(env({
        ...configured,
        TURSO_SOURCE_DATABASE: "game-center-preview",
      })),
    Error,
    "it is the source database",
  );
});

Deno.test("deletes the preview and branches it again from the source", async () => {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  await rebuildPreviewBranch(
    readBranchConfig(env(configured))!,
    (input, init) => {
      calls.push(`${init?.method} ${input}`);
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );

  assertEquals(calls, [
    "DELETE https://api.turso.tech/v1/organizations/kuboon/databases/game-center-preview",
    "POST https://api.turso.tech/v1/organizations/kuboon/databases",
  ]);
  assertEquals(bodies[0], {
    name: "game-center-preview",
    group: "default",
    seed: { type: "database", name: "game-center" },
  });
});

Deno.test("takes a missing preview database as nothing to delete", async () => {
  // A previous build that died between the two calls leaves exactly this.
  const seen: string[] = [];
  await rebuildPreviewBranch(
    readBranchConfig(env(configured))!,
    (_input, init) => {
      seen.push(String(init?.method));
      return Promise.resolve(
        init?.method === "DELETE"
          ? new Response("not found", { status: 404 })
          : new Response("{}", { status: 200 }),
      );
    },
  );
  assertEquals(seen, ["DELETE", "POST"]);
});

Deno.test("stops rather than migrating a database it failed to rebuild", async () => {
  const config = readBranchConfig(env(configured)) as BranchConfig;

  await assertRejects(
    () =>
      rebuildPreviewBranch(
        config,
        () => Promise.resolve(new Response("nope", { status: 403 })),
      ),
    Error,
    "Could not delete",
  );

  await assertRejects(
    () =>
      rebuildPreviewBranch(config, (_input, init) =>
        Promise.resolve(
          init?.method === "DELETE"
            ? new Response("{}", { status: 200 })
            : new Response("no such database", { status: 400 }),
        )),
    Error,
    "Could not branch",
  );
});
