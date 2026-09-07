import { assertEquals } from "@std/assert";

import type { Game } from "../db/games.ts";
import type { NamedUser } from "../db/users.ts";
import { gameMeta, profileMeta } from "./share_cards.ts";

const author: NamedUser = {
  id: 1,
  externalId: "u-1",
  displayName: "Ohkubo KOHEI",
  avatarUrl: "https://avatars.example/48445",
  handle: "kuboon",
};

const game: Game = {
  id: "kuboon/my-puzzle",
  ownerId: 1,
  slug: "my-puzzle",
  manifestUrl: "https://kuboon.github.io/my-puzzle/",
  title: "My Puzzle",
  description: "  ちいさな\n\n  パズルゲーム。  ",
  url: "https://kuboon.github.io/my-puzzle/",
  iconUrl: "https://kuboon.github.io/my-puzzle/icon.png",
  status: "active",
};

Deno.test("a profile card names the person and what they have done", () => {
  const meta = profileMeta(author, {
    games: 2,
    unlocks: 7,
    points: 120,
    followers: 3,
  });
  assertEquals(meta.title, "Ohkubo KOHEI (@kuboon)");
  assertEquals(
    meta.description,
    "ゲーム 2 本、解除した実績 7 件 / 120 ポイント。フォロワー 3 人。",
  );
  assertEquals(meta.image, "https://avatars.example/48445");
  assertEquals(meta.type, "profile");
});

Deno.test("a profile with no avatar names no picture of its own", () => {
  const meta = profileMeta({ ...author, avatarUrl: null }, {
    games: 0,
    unlocks: 0,
    points: 0,
    followers: 0,
  });
  assertEquals(meta.image, undefined);
  // Still says something true. A brand-new account is not a broken page.
  assertEquals(
    meta.description,
    "ゲーム 0 本、解除した実績 0 件 / 0 ポイント。フォロワー 0 人。",
  );
});

Deno.test("a game card prefers the game's own words", () => {
  const meta = gameMeta(game, { achievements: 5, points: 100 }, "kuboon");
  assertEquals(meta.title, "My Puzzle");
  // Flattened: a manifest description can carry newlines and a card cannot.
  assertEquals(meta.description, "ちいさな パズルゲーム。");
  assertEquals(meta.image, "https://kuboon.github.io/my-puzzle/icon.png");
});

Deno.test("a game with nothing to say gets described by its achievements", () => {
  const meta = gameMeta(
    { ...game, description: null },
    { achievements: 5, points: 100 },
    "kuboon",
  );
  assertEquals(meta.description, "実績 5 件 / 100 ポイント。作者 @kuboon。");
});

Deno.test("a game card leaves out an author it does not have", () => {
  const meta = gameMeta({ ...game, description: null }, {
    achievements: 1,
    points: 0,
  });
  assertEquals(meta.description, "実績 1 件 / 0 ポイント。");
});

Deno.test("a game that supplied no icon names no picture of its own", () => {
  // Nothing is invented to stand in for the icon here. The shell falls back
  // to the hub's own card, which says game-center rather than pretending to
  // be this game's picture.
  const meta = gameMeta({ ...game, iconUrl: null }, {
    achievements: 1,
    points: 0,
  });
  assertEquals(meta.image, undefined);
});
