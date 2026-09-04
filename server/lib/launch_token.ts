/**
 * Launch tokens: what a game gets when the hub sends a player to it.
 *
 * The hub mints one when a signed-in player presses 遊ぶ, and hands it over in
 * the URL fragment so it never reaches the game host's access log. The game
 * sends it back as a Bearer token, and it is the only thing that lets a game
 * write anything: the `aud` claim pins it to one game, so a token leaked from
 * one game cannot touch another's achievements.
 *
 * It carries nothing but `sub`, `aud` and `exp`, because it travels through a
 * URL a player can read and paste.
 */

import {
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  SignJWT,
} from "jose";

import { getConfig } from "../config.ts";

/**
 * How long a launch token stays usable.
 *
 * A week rather than a sitting, because the token is the only path that
 * records an unlock without the player doing anything. It lives in the game's
 * `localStorage`, so a player who bookmarks the game and comes back tomorrow
 * still has one; expire it in hours and that visit silently stops recording
 * and falls back to a claim the player has to confirm by hand.
 *
 * The length costs little. `aud` pins the token to one game and `sub` to one
 * player, so all it can ever do is unlock that player's achievements in that
 * game — which the player can do themselves at the claim page anyway. It is
 * not a session: it cannot read anything about the player beyond their name,
 * and it cannot touch another game.
 */
export const LAUNCH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const ALGORITHM = "ES256";

/**
 * What signing and verifying need from the configuration.
 *
 * Passed explicitly so tests can sign with a throwaway key without touching
 * the process environment, the same way `verifyIdpToken` takes its issuer.
 */
export interface LaunchTokenConfig {
  readonly rpOrigin: string;
  readonly rpSigningKeyJwk: string;
}

/** What a verified launch token says. */
export interface Launch {
  /** Local user id of the player the token was minted for. */
  readonly userId: number;
  /** The one game this token may act on. */
  readonly gameId: string;
}

/** Raised when a launch token is missing, malformed, expired, or foreign. */
export class LaunchTokenError extends Error {
  override readonly name = "LaunchTokenError";
}

/** Raised when the hub has no signing key, so it can mint nothing. */
export class SigningKeyMissingError extends Error {
  override readonly name = "SigningKeyMissingError";
}

/**
 * Mint a launch token.
 *
 * @param userId The player being sent to the game
 * @param gameId The game they are being sent to
 * @returns The signed JWT
 * @throws {SigningKeyMissingError} when `RP_SIGNING_KEY_JWK` is unset
 */
export async function mintLaunchToken(
  userId: number,
  gameId: string,
  config: LaunchTokenConfig = getConfig(),
): Promise<string> {
  return await new SignJWT()
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(String(userId))
    .setAudience(gameId)
    .setIssuer(config.rpOrigin)
    .setIssuedAt()
    .setExpirationTime(`${LAUNCH_TOKEN_TTL_SECONDS}s`)
    .sign(await signingKey(config));
}

/**
 * Verify a launch token and read who and what it is for.
 *
 * @param token The JWT the game sent back
 * @returns The player and game it authorises
 * @throws {LaunchTokenError} when it does not verify
 * @throws {SigningKeyMissingError} when `RP_SIGNING_KEY_JWK` is unset
 */
export async function verifyLaunchToken(
  token: string,
  config: LaunchTokenConfig = getConfig(),
): Promise<Launch> {
  // Imported before the try, so a deployment with no key raises
  // SigningKeyMissingError rather than being reported as a bad token.
  const key = await verifyingKey(config);

  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      issuer: config.rpOrigin,
      algorithms: [ALGORITHM],
    }));
  } catch (cause) {
    throw new LaunchTokenError(
      `Launch token is not valid: ${(cause as Error).message}`,
    );
  }

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new LaunchTokenError("Launch token names no player");
  }
  // A token is minted for exactly one game, so `aud` is a single string here.
  // Anything else means it was not minted by this code path.
  const gameId = typeof payload.aud === "string" ? payload.aud : "";
  if (!gameId) throw new LaunchTokenError("Launch token names no game");

  return { userId, gameId };
}

/**
 * Where the game is opened, with the token in the fragment.
 *
 * The fragment is never sent to the game's host, so the token stays out of
 * GitHub Pages' logs and out of any referrer.
 */
export function launchUrl(gameUrl: string, token: string): string {
  const url = new URL(gameUrl);
  url.hash = `gctoken=${token}`;
  return url.href;
}

/** Generate a signing key, for `deno task keygen`. */
export async function generateSigningKeyJwk(): Promise<string> {
  const { privateKey } = await generateKeyPair(ALGORITHM, {
    extractable: true,
  });
  return JSON.stringify(await exportJWK(privateKey));
}

/**
 * Imported keys, kept for the life of the isolate and keyed by the JWK plus
 * which half of the pair it is. Signing needs the private key and verifying
 * needs the public one, and WebCrypto refuses to use either in the other role.
 */
const keys = new Map<string, Promise<CryptoKey>>();

const signingKey = (config: LaunchTokenConfig) => importKey(config, "private");
const verifyingKey = (config: LaunchTokenConfig) => importKey(config, "public");

function importKey(
  { rpSigningKeyJwk }: LaunchTokenConfig,
  half: "private" | "public",
): Promise<CryptoKey> {
  if (!rpSigningKeyJwk) {
    throw new SigningKeyMissingError(
      "RP_SIGNING_KEY_JWK is unset, so this deployment cannot launch games",
    );
  }
  const cacheKey = `${half}:${rpSigningKeyJwk}`;
  let key = keys.get(cacheKey);
  if (!key) {
    key = (async () => {
      const jwk = JSON.parse(rpSigningKeyJwk);
      if (typeof jwk?.d !== "string") {
        throw new SigningKeyMissingError(
          "RP_SIGNING_KEY_JWK is not a private key",
        );
      }
      // The public half is the same JWK without the private scalar. `key_ops`
      // goes too: it would name signing and so forbid verification.
      const { d: _d, key_ops: _ops, ...pub } = jwk;
      const imported = await importJWK(
        half === "private" ? jwk : pub,
        ALGORITHM,
      );
      if (!(imported instanceof CryptoKey)) {
        throw new SigningKeyMissingError(
          "RP_SIGNING_KEY_JWK is not an asymmetric key",
        );
      }
      return imported;
    })();
    keys.set(cacheKey, key);
  }
  return key;
}
