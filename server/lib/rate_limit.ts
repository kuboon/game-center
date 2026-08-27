/**
 * A counter per caller per window, kept in the `kv` table.
 *
 * `POST /api/registry/v1/games` takes no credential, and every call makes the
 * hub fetch a URL somebody else chose. The pending queue is already bounded
 * per author, so what is unbounded is the fetching itself: without a limit the
 * endpoint is a way to make this server retrieve arbitrary URLs, as fast as
 * anyone likes, with the hub's own address on the request.
 *
 * A fixed window rather than anything cleverer. It admits a burst across a
 * window boundary, which for this purpose is fine — the point is to put a
 * ceiling on sustained use, not to smooth traffic. Being simple enough to read
 * in one sitting is worth more here than precision.
 *
 * Rows expire: `expires_at` is set on every write, and a window that has
 * passed is never read again.
 */

import type { Client } from "../db/client.ts";

/** What a caller is allowed, and when to try again if they are not. */
export interface RateLimitResult {
  readonly allowed: boolean;
  /** Seconds until the window turns over. Zero when allowed. */
  readonly retryAfter: number;
}

export interface RateLimitOptions {
  /** Calls permitted per window. */
  readonly limit: number;
  /** Window length in seconds. */
  readonly windowSeconds: number;
  /** Milliseconds since the epoch. Injected so tests need no clock. */
  readonly now?: number;
}

/**
 * Count one call against `key`, and say whether it is allowed.
 *
 * Counts the call even when it refuses it: a caller hammering a closed door
 * should not have their window reset by their own attempts.
 *
 * @param client Database holding the `kv` table
 * @param key What is being limited — an address, usually
 * @param options How many, how often, and what time it is
 */
export async function takeToken(
  client: Client,
  key: string,
  { limit, windowSeconds, now = Date.now() }: RateLimitOptions,
): Promise<RateLimitResult> {
  const seconds = Math.floor(now / 1000);
  const window = Math.floor(seconds / windowSeconds);
  const expiresAt = (window + 1) * windowSeconds;

  const result = await client.execute({
    sql: `insert into kv (key, value, expires_at) values (?, '1', ?)
          on conflict (key) do update
            set value = cast(kv.value as integer) + 1
          returning value`,
    args: [`ratelimit:${key}:${window}`, expiresAt],
  });

  const count = Number(result.rows[0].value);
  return count <= limit
    ? { allowed: true, retryAfter: 0 }
    : { allowed: false, retryAfter: Math.max(1, expiresAt - seconds) };
}

/**
 * The caller's address, as far as it can be known.
 *
 * Deno Deploy sits behind a proxy, so the socket address is the proxy's and
 * `x-forwarded-for` carries the chain. The first entry is the original client
 * — and is also the only part a client can forge, which is why this is a way
 * to slow somebody down rather than to keep them out.
 */
export function callerAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || "unknown";
}
