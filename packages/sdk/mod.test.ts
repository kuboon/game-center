/// <reference lib="deno.ns" />
// The package is scoped to browser libs so a Deno API cannot slip into a file
// that ships inside someone's game. The tests need Deno, and only the tests.
/**
 * The SDK's two ways to the hub, with the browser stubbed.
 *
 * What matters is the floor: an unlock the hub could not be told about is kept
 * rather than lost, and one link records everything that is waiting — never an
 * error, never a popup.
 */

import { assert, assertEquals } from "@std/assert";

import { GameCenter } from "./mod.ts";

const HUB = "https://hub.example";
const GAME = "kuboon/my-puzzle";

/**
 * Install just enough browser for the SDK, and undo it afterwards.
 *
 * Defined rather than assigned: Deno's own `localStorage` is a getter, so
 * `globalThis.localStorage = stub` does nothing at all — silently, which means
 * a test would keep passing while reading the real store and leaking its
 * queue into the next test.
 */
function browser(
  { hash = "", stored = {}, fetch: fetchImpl }: {
    hash?: string;
    /** What `localStorage` already holds, as a returning player's would. */
    stored?: Record<string, string>;
    fetch?: typeof globalThis.fetch;
  } = {},
) {
  const store = new Map<string, string>(Object.entries(stored));
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    if (!saved.has(key)) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    }
    Object.defineProperty(globalThis, key, { value, configurable: true });
  };

  install("location", { hash, pathname: "/game/", search: "" });
  install("history", { replaceState: () => {} });
  install("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  if (fetchImpl) install("fetch", fetchImpl);

  return {
    store,
    restore() {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as unknown as Record<string, unknown>)[key];
      }
    },
  };
}

const ok = () => Promise.resolve(new Response("{}", { status: 200 }));
const QUEUE = `gc:pending:${GAME}`;

Deno.test("queues an unlock nobody can be told about", async () => {
  const env = browser();
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    const result = await gc.unlock("first_clear");

    assertEquals(result.recorded, false);
    assertEquals(result.pending, 1);
    assertEquals(gc.pending, [{ key: "first_clear", score: null }]);
  } finally {
    env.restore();
  }
});

Deno.test("one claim link carries everything waiting", async () => {
  const env = browser();
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    await gc.unlock("first_clear");
    await gc.unlock("high_score", { score: 1200 });

    assertEquals(
      gc.claimUrl(),
      `${HUB}/claim/@${GAME}#gc=first_clear,high_score:1200`,
    );
  } finally {
    env.restore();
  }
});

Deno.test("offers no link when there is nothing to record", () => {
  const env = browser();
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    assertEquals(gc.claimUrl(), null);
    assertEquals(gc.claimLink(), null);
  } finally {
    env.restore();
  }
});

Deno.test("keeps the higher score when the same key comes twice", async () => {
  const env = browser();
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    await gc.unlock("high_score", { score: 1200 });
    await gc.unlock("high_score", { score: 900 });

    assertEquals(gc.pending, [{ key: "high_score", score: 1200 }]);
  } finally {
    env.restore();
  }
});

Deno.test("the queue survives the page being closed", async () => {
  const env = browser();
  try {
    const first = GameCenter.init({ gameId: GAME, hub: HUB });
    await first.unlock("first_clear");
    assert(env.store.has(QUEUE));

    // A second visit, with whatever the first one left behind.
    const again = browser({ stored: Object.fromEntries(env.store) });
    try {
      const gc = GameCenter.init({ gameId: GAME, hub: HUB });
      assertEquals(gc.pending, [{ key: "first_clear", score: null }]);
    } finally {
      again.restore();
    }
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

    assertEquals(result.recorded, true);
    assertEquals(result.pending, 0);
    const unlock = calls.find((c) => c.url.endsWith("/unlock"));
    assertEquals(unlock?.auth, "Bearer LAUNCH");
    assertEquals(unlock?.body, { achievement: "first_clear", score: 10 });
  } finally {
    env.restore();
  }
});

Deno.test("sends a waiting queue as soon as a token turns up", async () => {
  const sent: unknown[] = [];
  const env = browser({
    hash: "#gctoken=LAUNCH",
    stored: {
      [QUEUE]: JSON.stringify([
        { key: "first_clear", score: null },
        { key: "high_score", score: 1200 },
      ]),
    },
    fetch: (input, init) => {
      if (String(input).endsWith("/me")) {
        return Promise.resolve(
          new Response(JSON.stringify({ player: { name: "kuboon" } })),
        );
      }
      sent.push(JSON.parse(String(init?.body)));
      return Promise.resolve(
        new Response(JSON.stringify({
          results: [
            { key: "first_clear", ok: true },
            { key: "high_score", ok: true },
          ],
        })),
      );
    },
  });
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    await gc.ready;

    assertEquals(sent, [{
      unlocks: [
        { key: "first_clear", score: null },
        { key: "high_score", score: 1200 },
      ],
    }]);
    assertEquals(gc.pending, []);
    assertEquals(env.store.has(QUEUE), false);
  } finally {
    env.restore();
  }
});

Deno.test("keeps an unlock the hub would not take", async () => {
  const env = browser({
    hash: "#gctoken=LAUNCH",
    stored: {
      [QUEUE]: JSON.stringify([
        { key: "first_clear", score: null },
        { key: "retired_one", score: null },
      ]),
    },
    fetch: (input) =>
      String(input).endsWith("/me")
        ? Promise.resolve(new Response("{}"))
        : Promise.resolve(
          new Response(JSON.stringify({
            results: [
              { key: "first_clear", ok: true },
              { key: "retired_one", ok: false },
            ],
          })),
        ),
  });
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    await gc.ready;

    // A manifest that later declares it can still take this unlock, so it
    // stays rather than being thrown away on the hub's say-so.
    assertEquals(gc.pending, [{ key: "retired_one", score: null }]);
  } finally {
    env.restore();
  }
});

Deno.test("drops what the hub already has", async () => {
  const env = browser({
    hash: "#gctoken=LAUNCH",
    stored: {
      [QUEUE]: JSON.stringify([
        { key: "first_clear", score: null },
        { key: "high_score", score: 900 },
      ]),
    },
    fetch: (input) =>
      String(input).endsWith("/me")
        ? Promise.resolve(
          new Response(JSON.stringify({
            player: { name: "kuboon" },
            achievements: [
              { key: "first_clear", score: null },
              { key: "high_score", score: 1200 },
            ],
          })),
        )
        : Promise.resolve(new Response(JSON.stringify({ results: [] }))),
  });
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    await gc.ready;

    // Both are already recorded, and the kept score is the higher one, so
    // there is nothing left to ask the player about.
    assertEquals(gc.pending, []);
  } finally {
    env.restore();
  }
});

Deno.test("forgets what the claim page says it recorded", () => {
  const env = browser({
    hash: "#gcclaimed=first_clear",
    stored: {
      [QUEUE]: JSON.stringify([
        { key: "first_clear", score: null },
        { key: "high_score", score: 1200 },
      ]),
    },
  });
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    assertEquals(gc.pending, [{ key: "high_score", score: 1200 }]);
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

    assertEquals((await gc.unlock("a")).recorded, false);
    const spent = attempts;
    // Every later unlock would otherwise wait on a request that cannot succeed.
    assertEquals((await gc.unlock("b")).recorded, false);
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
    assertEquals(gc.player, { name: "kuboon" });
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
    assertEquals(result.recorded, false);
    assert(gc.claimUrl()?.includes("first_clear"));
  } finally {
    env.restore();
  }
});

Deno.test("lists the game's achievements with the player's progress", async () => {
  const env = browser({
    hash: "#gctoken=LAUNCH",
    fetch: (input) =>
      String(input).endsWith("/achievements")
        ? Promise.resolve(
          new Response(JSON.stringify({
            achievements: [
              {
                key: "first_clear",
                title: "はじめてのクリア",
                description: null,
                points: 10,
                hidden: false,
                unlocked: true,
                unlockedAt: "2026-09-04T00:00:00Z",
                score: null,
              },
              {
                key: "secret",
                title: null,
                description: null,
                points: 50,
                hidden: true,
                unlocked: false,
                unlockedAt: null,
                score: null,
              },
            ],
          })),
        )
        : Promise.resolve(new Response("{}")),
  });
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    await gc.ready;
    const list = await gc.achievements();

    assertEquals(list?.map((a) => [a.key, a.title, a.unlocked, a.pending]), [
      ["first_clear", "はじめてのクリア", true, false],
      // The hub keeps a hidden achievement's wording to itself until it is
      // earned, which is the whole reason a game asks the hub rather than
      // reading its own manifest.
      ["secret", null, false, false],
    ]);
  } finally {
    env.restore();
  }
});

Deno.test("shows a queued unlock as earned but not yet recorded", async () => {
  let asked = 0;
  const env = browser({
    hash: "#gctoken=LAUNCH",
    stored: {
      [QUEUE]: JSON.stringify([{ key: "high_score", score: 1200 }]),
    },
    fetch: (input) => {
      const url = String(input);
      if (url.endsWith("/achievements")) {
        asked++;
        return Promise.resolve(
          new Response(JSON.stringify({
            achievements: [{
              key: "high_score",
              title: "ハイスコア",
              description: null,
              points: 30,
              hidden: false,
              unlocked: false,
              unlockedAt: null,
              score: null,
            }],
          })),
        );
      }
      // Nothing gets through, so the queue stays put.
      return Promise.reject(new Error("offline"));
    },
  });
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    await gc.ready;

    const list = await gc.achievements();
    assertEquals(list, [{
      key: "high_score",
      title: "ハイスコア",
      description: null,
      points: 30,
      hidden: false,
      unlocked: true,
      pending: true,
      unlockedAt: null,
      score: 1200,
    }]);

    // The hub's half is kept; the queue is folded in on every call.
    await gc.achievements();
    assertEquals(asked, 1);
  } finally {
    env.restore();
  }
});

Deno.test("has no list to give without a launch token", async () => {
  const env = browser();
  try {
    const gc = GameCenter.init({ gameId: GAME, hub: HUB });
    assertEquals(await gc.achievements(), null);
  } finally {
    env.restore();
  }
});
