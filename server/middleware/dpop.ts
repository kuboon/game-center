/**
 * The hub's DPoP session middleware, pre-configured.
 *
 * Sessions live in the `kv` table through `@kuboon/kv`'s Turso repository, so
 * they survive the isolate that created them without Deno KV. Controllers
 * import {@link DpopSession} from here rather than from the package, keeping
 * the storage choice in one place.
 *
 * The middleware is installed whether or not a database is configured:
 * verifying a proof needs no storage, and dropping the middleware would turn a
 * missing `TURSO_DATABASE_URL` into a bare "DPoP proof required" 401 that looks
 * like a client bug. Without a database, sessions fall back to this isolate's
 * memory — enough to answer honestly, not enough to sign anyone in, which is
 * why {@link sessionsArePersistent} exists for handlers to check.
 */

import { MemoryKvRepo } from "@kuboon/kv/memory.ts";
import { TursoKvRepo } from "@kuboon/kv/turso.ts";
import type { Session } from "@remix-run/session";
import type { Middleware } from "@remix-run/fetch-router";
import { dpopSession } from "@game-center/dpop-session-middleware";
import { createKvSessionStorage } from "@game-center/session-storage-kv";

import { getDb } from "../db/client.ts";

export {
  DpopProofError,
  DpopSession,
} from "@game-center/dpop-session-middleware";

/** How long a signed-in session survives without being touched. */
const SESSION_TTL_MS = 3_600_000;

/** What the hub keeps in a session: the signed-in player's IdP userId. */
export const SESSION_USER_ID = "userId";

const client = getDb();

/**
 * Whether sessions outlive the isolate that created them.
 *
 * False when no database is configured. Handlers that establish a session
 * should say so rather than pretending to sign the player in.
 */
export const sessionsArePersistent: boolean = client !== null;

const repo = client
  ? new TursoKvRepo<Session["data"]>(client, ["dpop-session"], {
    expireIn: SESSION_TTL_MS,
  })
  : new MemoryKvRepo<Session["data"]>(["dpop-session"], {
    expireIn: SESSION_TTL_MS,
  });

/** Verifies the DPoP proof on every request and exposes the session. */
export const dpop: Middleware = dpopSession({
  sessionStorage: createKvSessionStorage(repo),
}) as unknown as Middleware;
