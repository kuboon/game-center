/**
 * KV-backed session storage for Remix v3.
 *
 * Adapts any `@kuboon/kv` {@link KvRepo} to the `SessionStorage` interface from
 * `@remix-run/session`: session IDs become KV keys, and the value is the
 * `[valueData, flashData]` tuple `Session#data` produces.
 *
 * Vendored rather than imported — id.kbn.one and deno-remix-reference each
 * carry their own copy because the adapter is not published. Keeping ours in a
 * workspace package means the hub's storage backend is a constructor argument:
 * Turso in production, memory in tests.
 *
 * ```ts
 * import { createKvSessionStorage } from "@game-center/session-storage-kv";
 * import { TursoKvRepo } from "@kuboon/kv/turso.ts";
 *
 * const storage = createKvSessionStorage(
 *   new TursoKvRepo(client, ["dpop-session"], { expireIn: 3_600_000 }),
 * );
 * ```
 *
 * @module
 */

import {
  createSession,
  type Session,
  type SessionStorage,
} from "@remix-run/session";
import type { KvRepo } from "@kuboon/kv";

/** What a `Session` stores: `[valueData, flashData]`. */
type SessionDataTuple = Session["data"];

/**
 * Build a `SessionStorage` over a KV repository.
 *
 * @param repo Where sessions live. Its `expireIn` option becomes the session TTL
 * @returns Storage suitable for the session middleware
 */
export function createKvSessionStorage(
  repo: KvRepo<SessionDataTuple>,
): SessionStorage {
  return {
    async read(id: string | null): Promise<Session> {
      if (id) {
        const data = await repo.entry(id).get();
        if (data !== null) return createSession(id, data);
      }
      return createSession(id ?? undefined);
    },

    async save(session: Session): Promise<string | null> {
      if (session.deleteId) {
        await repo.entry(session.deleteId).update(() => null);
      }

      if (session.destroyed) {
        await repo.entry(session.id).update(() => null);
        return "";
      }

      if (session.dirty) {
        await repo.entry(session.id).update(() => session.data);
        return session.id;
      }

      return null;
    },
  };
}
