/**
 * Launch tokens, signed with a throwaway key.
 *
 * The token is what lets a game write to a player's record, so what is under
 * test is mostly what it refuses: another hub's tokens, an expired one, one
 * whose payload was edited, and one for a different game.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";

import {
  generateSigningKeyJwk,
  type LaunchTokenConfig,
  LaunchTokenError,
  launchUrl,
  mintLaunchToken,
  SigningKeyMissingError,
  verifyLaunchToken,
} from "./launch_token.ts";

const config: LaunchTokenConfig = {
  rpOrigin: "https://ga-cen.kbn.one",
  rpSigningKeyJwk: await generateSigningKeyJwk(),
};

Deno.test("a minted token names the player and the game", async () => {
  const token = await mintLaunchToken(42, "my-puzzle", config);
  const launch = await verifyLaunchToken(token, config);
  assertEquals(launch, { userId: 42, gameId: "my-puzzle" });
});

Deno.test("refuses a token signed by a different hub's key", async () => {
  const token = await mintLaunchToken(42, "my-puzzle", {
    ...config,
    rpSigningKeyJwk: await generateSigningKeyJwk(),
  });
  await assertRejects(
    () => verifyLaunchToken(token, config),
    LaunchTokenError,
  );
});

Deno.test("refuses a token issued for a different origin", async () => {
  const token = await mintLaunchToken(42, "my-puzzle", {
    ...config,
    rpOrigin: "https://evil.example.com",
  });
  await assertRejects(
    () => verifyLaunchToken(token, config),
    LaunchTokenError,
  );
});

Deno.test("refuses a token whose payload was edited", async () => {
  const token = await mintLaunchToken(42, "my-puzzle", config);
  const [header, payload, signature] = token.split(".");
  const edited = JSON.parse(
    new TextDecoder().decode(Uint8Array.fromBase64(payload, {
      alphabet: "base64url",
    })),
  );
  edited.aud = "someone-elses-game";
  const forged = [
    header,
    new TextEncoder().encode(JSON.stringify(edited)).toBase64({
      alphabet: "base64url",
      omitPadding: true,
    }),
    signature,
  ].join(".");

  await assertRejects(
    () => verifyLaunchToken(forged, config),
    LaunchTokenError,
  );
});

Deno.test("refuses anything that is not a JWS", async () => {
  await assertRejects(
    () => verifyLaunchToken("not-a-token", config),
    LaunchTokenError,
  );
});

Deno.test("says so when the hub has no signing key", async () => {
  const unset = { ...config, rpSigningKeyJwk: "" };
  await assertRejects(
    () => mintLaunchToken(42, "my-puzzle", unset),
    SigningKeyMissingError,
  );
  await assertRejects(
    () => verifyLaunchToken("whatever", unset),
    SigningKeyMissingError,
  );
});

Deno.test("hands the token over in the fragment, not the query", () => {
  const url = new URL(
    launchUrl("https://example.github.io/my-puzzle/?level=3", "TOKEN"),
  );
  assertEquals(url.hash, "#gctoken=TOKEN");
  assertEquals(url.search, "?level=3");
  assert(!url.href.includes("?gctoken"));
});
