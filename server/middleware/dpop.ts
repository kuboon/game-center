/**
 * The hub's DPoP session middleware, pre-configured.
 *
 * Sessions live in the `kv` table through `@kuboon/kv`'s Turso repository, so
 * they survive the isolate that created them without Deno KV. Controllers
 * import {@link DpopSession} from here rather than from the package, keeping
 * the storage choice in one place.
 */

import { TursoKvRepo } from "@kuboon/kv/turso.ts";
import type { Session } from "@remix-run/session";
import type { Middleware } from "@remix-run/fetch-router";
import { dpopSession } from "@game-center/dpop-session-middleware";
import { createKvSessionStorage } from "@game-center/session-storage-kv";

import { getDb } from "../db/client.ts";

export { DpopSession } from "@game-center/dpop-session-middleware";

/** How long a signed-in session survives without being touched. */
const SESSION_TTL_MS = 3_600_000;

/** What the hub keeps in a session: the signed-in player's IdP userId. */
export const SESSION_USER_ID = "userId";

/**
 * Middleware for the router, or `null` when no database is configured.
 *
 * Without Turso there is nowhere to persist sessions, so the hub runs
 * signed-out rather than failing to boot — the same posture `getDb()` takes.
 */
export function dpopSessionMiddleware(): Middleware | null {
  const client = getDb();
  if (!client) return null;

  const storage = createKvSessionStorage(
    new TursoKvRepo<Session["data"]>(client, ["dpop-session"], {
      expireIn: SESSION_TTL_MS,
    }),
  );
  return dpopSession({ sessionStorage: storage }) as unknown as Middleware;
}
