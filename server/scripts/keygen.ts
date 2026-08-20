/**
 * Print a fresh launch-token signing key, for `RP_SIGNING_KEY_JWK`.
 *
 * Run with `deno task keygen`. Rotating the key invalidates every launch token
 * already out there, which only costs players a re-launch.
 */

import { generateSigningKeyJwk } from "../lib/launch_token.ts";

console.log(await generateSigningKeyJwk());
