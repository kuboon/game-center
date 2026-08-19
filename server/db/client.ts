/**
 * The libSQL client the hub talks to Turso through.
 *
 * Built from `@libsql/client/web` — the fetch/WebSocket build with no native
 * addon, so it runs on Deno Deploy. Tests build their own client from
 * `@libsql/client/node` against a local file and pass it in, which is why every
 * function that touches the database takes a `Client` rather than reaching for
 * this module's singleton.
 */

import { type Client, createClient } from "@libsql/client/web";

import { getConfig } from "../config.ts";

export type { Client };

let cached: Client | null | undefined;

/**
 * The shared database client, or `null` when `TURSO_DATABASE_URL` is unset.
 *
 * Returning `null` instead of throwing keeps the server bootable without a
 * database — pages that do not read one still render.
 */
export function getDb(): Client | null {
  if (cached !== undefined) return cached;
  const { tursoDatabaseUrl, tursoAuthToken } = getConfig();
  return cached = tursoDatabaseUrl
    ? createClient({
      url: tursoDatabaseUrl,
      authToken: tursoAuthToken || undefined,
    })
    : null;
}

/** The shared client, throwing when the database is unconfigured. */
export function requireDb(): Client {
  const client = getDb();
  if (!client) {
    throw new Error("TURSO_DATABASE_URL is not set — no database configured");
  }
  return client;
}
