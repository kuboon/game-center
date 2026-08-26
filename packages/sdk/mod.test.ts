/// <reference lib="deno.ns" />
// The package is scoped to browser libs so a Deno API cannot slip into a file
// that ships inside someone's game. The tests need Deno, and only the tests.
/**
 * The SDK's fallback chain, with the browser stubbed.
 *
 * What matters is the order and the floor: the parent frame first, the REST API
 * second, and a claim URL when neither worked — never an error, never a popup.
 */

import { assert, assertEquals } from "@std/assert";

import { GameCenter } from "./mod.ts";

const HUB = "https://hub.example";
const GAME = "kuboon/my-puzzle";

/**
 * Install just enough browser for the SDK, and undo it afterwards.
 *
 * Messages go through the real event target rather than a fake one, so the
 * listener bookkeeping under test is the listener bookkeeping that runs.
 */
function browser(
  { hash = "", parent = false, fetch: fetchImpl }: {
    hash?: string;
    parent?: boolean;
    fetch?: typeof globalThis.fetch;
  } = {},
) {
  const store = new Map<string, string>();
  const posted: Record<string, unknown>[] = [];
  const self = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const keys = ["location", "history", "localStorage", "parent", "fetch"];
  for (const key of keys) saved[key] = self[key];

  self.location = { hash, pathname: "/game/", search: "" };
  self.history = { replaceState: () => {} };
  self.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
  // A page with nothing embedding it has `parent === window`, which is what
  // the SDK checks. Getting this wrong would make every test look embedded.
  self.parent = parent
    ? { postMessage: (m: Record<string, unknown>) => posted.push(m) }
    : globalThis;
  if (fetchImpl) self.fetch = fetchImpl;

  return {
    posted,
    /** Answer the message the SDK just posted, as the hub's play page would. */
    reply(ok: boolean) {
      const sent = posted.at(-1) as { id: string };
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "gc:unlocked", id: sent.id, ok },
        }),
      );
    },
    restore() {
      for (const key of keys) {
        if (saved[key] === undefined) delete self[key];
        else self[key] = saved[key];
      }
    },
  };
}

const ok = () => Promise.resolve(new Response("{}", { status: 200 }));

Deno.test("falls back to a claim URL when nothing else can reach the hub", async () => {
  const env = browser();
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    const result = await gc.unlock("first_clear");

    // The floor. It works from a Claude Artifact, which is the whole point.
    assertEquals(result.mode, "claim");
    assertEquals(result.recorded, false);
    assertEquals(result.claimUrl, `${HUB}/claim/@${GAME}/first_clear`);
  } finally {
    env.restore();
  }
});

Deno.test("puts the score in the claim URL", async () => {
  const env = browser();
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    const result = await gc.unlock("high_score", { score: 1200 });
    assertEquals(
      result.claimUrl,
      `${HUB}/claim/@${GAME}/high_score?score=1200`,
    );
  } finally {
    env.restore();
  }
});

Deno.test("uses the launch token the hub left in the fragment", async () => {
  const calls: { url: string; auth: string | null; body: unknown }[] = [];
  const env = browser({
    hash: "#gctoken=LAUNCH",
    fetch: (input, init) => {
      calls.push({
        url: String(input),
        auth: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return ok();
    },
  });
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    const result = await gc.unlock("first_clear", { score: 10 });

    assertEquals(result.mode, "rest");
    assertEquals(result.recorded, true);
    const unlock = calls.find((c) => c.url.endsWith("/unlock"));
    assertEquals(unlock?.auth, "Bearer LAUNCH");
    assertEquals(unlock?.body, { achievement: "first_clear", score: 10 });
  } finally {
    env.restore();
  }
});

Deno.test("asks the embedding page before trying anything else", async () => {
  const env = browser({
    hash: "#gctoken=LAUNCH",
    parent: true,
    fetch: () => {
      throw new Error("the parent answered; REST should not have been tried");
    },
  });
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    const unlocking = gc.unlock("first_clear");
    await new Promise((r) => setTimeout(r, 0));
    env.reply(true);

    const result = await unlocking;
    assertEquals(result.mode, "postmessage");
    assertEquals(result.recorded, true);
    assertEquals(
      (env.posted[0] as { achievement: string }).achievement,
      "first_clear",
    );
  } finally {
    env.restore();
  }
});

Deno.test("moves on when the embedding page says no", async () => {
  const env = browser({ hash: "#gctoken=LAUNCH", parent: true, fetch: ok });
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    const unlocking = gc.unlock("first_clear");
    await new Promise((r) => setTimeout(r, 0));
    env.reply(false);

    // A parent that refuses is not a parent that is absent, but either way the
    // next way down is worth trying.
    assertEquals((await unlocking).mode, "rest");
  } finally {
    env.restore();
  }
});

Deno.test("stops using a token the hub has rejected", async () => {
  let attempts = 0;
  const env = browser({
    hash: "#gctoken=EXPIRED",
    fetch: () => {
      attempts++;
      return Promise.resolve(new Response("no", { status: 401 }));
    },
  });
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    await gc.ready;
    assertEquals(gc.player, null);

    assertEquals((await gc.unlock("a")).mode, "claim");
    const spent = attempts;
    // Every later unlock would otherwise wait on a request that cannot succeed.
    assertEquals((await gc.unlock("b")).mode, "claim");
    assertEquals(attempts, spent);
  } finally {
    env.restore();
  }
});

Deno.test("learns who is playing when the hub says", async () => {
  const env = browser({
    hash: "#gctoken=LAUNCH",
    fetch: (input) =>
      String(input).endsWith("/me")
        ? Promise.resolve(
          new Response(JSON.stringify({ player: { name: "kuboon" } })),
        )
        : ok(),
  });
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    await gc.ready;
    assertEquals(gc.player?.name, "kuboon");
  } finally {
    env.restore();
  }
});

Deno.test("knows nobody without a launch token", async () => {
  const env = browser();
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    await gc.ready;
    assertEquals(gc.player, null);
  } finally {
    env.restore();
  }
});

Deno.test("survives a hub that is unreachable", async () => {
  const env = browser({
    hash: "#gctoken=LAUNCH",
    fetch: () => Promise.reject(new Error("offline")),
  });
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    await gc.ready;
    const result = await gc.unlock("first_clear");
    // Never throws, never navigates. The claim URL still works later.
    assert(result.claimUrl);
    assertEquals(result.recorded, false);
  } finally {
    env.restore();
  }
});
