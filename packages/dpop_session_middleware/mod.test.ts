import { assert, assertEquals } from "@std/assert";
import { createSession, type Session } from "@remix-run/session";
import type { SessionStorage } from "@remix-run/session";
import { init, InMemoryKeyRepository } from "@kuboon/dpop";

import { DpopSession, dpopSession, InMemoryReplayDetector } from "./mod.ts";

const URL_UNDER_TEST = "https://hub.example/api/internal/session";

/** Session storage over a plain Map, so the tests need no database. */
function memoryStorage(): SessionStorage & {
  readonly store: Map<string, Session["data"]>;
} {
  const store = new Map<string, Session["data"]>();
  return {
    store,
    read(id) {
      const data = id ? store.get(id) : undefined;
      return Promise.resolve(
        data ? createSession(id!, data) : createSession(id ?? undefined),
      );
    },
    save(session) {
      if (session.destroyed) {
        store.delete(session.id);
        return Promise.resolve("");
      }
      if (session.dirty) {
        store.set(session.id, session.data);
        return Promise.resolve(session.id);
      }
      return Promise.resolve(null);
    },
  };
}

/**
 * A stand-in browser holding one DPoP key.
 *
 * `signedRequest()` returns a request carrying a fresh proof: `init` is given a
 * fetch that records the headers instead of sending anything, which is all the
 * middleware ever reads.
 */
async function browser(): Promise<
  { thumbprint: string; signedRequest: () => Promise<Request> }
> {
  let captured: Headers | undefined;
  const { fetchDpop, thumbprint } = await init({
    keyStore: new InMemoryKeyRepository(),
    fetch: (_input, requestInit) => {
      captured = new Headers(requestInit?.headers);
      return Promise.resolve(new Response("ok"));
    },
  });

  return {
    thumbprint,
    async signedRequest() {
      await fetchDpop(URL_UNDER_TEST, { method: "POST" });
      return new Request(URL_UNDER_TEST, {
        method: "POST",
        headers: captured,
      });
    },
  };
}

/** Drive the middleware the way the router does, and report what it saw. */
async function run(
  storage: SessionStorage,
  request: Request,
  handler: (session: DpopSession | undefined) => Response = () =>
    new Response("ok"),
): Promise<{ response: Response; session: DpopSession | undefined }> {
  const middleware = dpopSession({ sessionStorage: storage }) as unknown as (
    context: unknown,
    next: () => Promise<Response>,
  ) => Promise<Response>;

  const values = new Map<unknown, unknown>();
  let seen: DpopSession | undefined;
  const context = {
    request,
    set: (key: unknown, value: unknown) => values.set(key, value),
    get: (key: unknown) => values.get(key),
    has: (key: unknown) => values.has(key),
  };

  const response = await middleware(context, () => {
    seen = values.get(DpopSession) as DpopSession | undefined;
    return Promise.resolve(handler(seen));
  });
  return { response, session: seen };
}

Deno.test("passes through without a session when there is no proof", async () => {
  const { response, session } = await run(
    memoryStorage(),
    new Request(URL_UNDER_TEST, { method: "POST" }),
  );
  assertEquals(response.status, 200);
  assertEquals(session, undefined);
});

Deno.test("ignores a proof that is not a valid JWS", async () => {
  const { session } = await run(
    memoryStorage(),
    new Request(URL_UNDER_TEST, {
      method: "POST",
      headers: { DPoP: "not-a-proof" },
    }),
  );
  assertEquals(session, undefined);
});

Deno.test("exposes a session keyed by the proof's thumbprint", async () => {
  const { thumbprint, signedRequest } = await browser();

  const { session } = await run(memoryStorage(), await signedRequest());
  assert(session, "middleware set no session for a valid proof");
  assertEquals(session.thumbprint, thumbprint);
  assertEquals(session.id, thumbprint);
});

Deno.test("persists what a handler writes and restores it next time", async () => {
  const storage = memoryStorage();
  const { thumbprint, signedRequest } = await browser();

  await run(storage, await signedRequest(), (session) => {
    session!.set("userId", "u1");
    return new Response("ok");
  });
  assert(storage.store.has(thumbprint), "session was not persisted");

  const { session } = await run(storage, await signedRequest());
  assertEquals(session?.get("userId"), "u1");
});

Deno.test("keeps two browsers' sessions apart", async () => {
  const storage = memoryStorage();
  const alice = await browser();
  const bob = await browser();

  await run(storage, await alice.signedRequest(), (session) => {
    session!.set("userId", "alice");
    return new Response("ok");
  });

  const { session } = await run(storage, await bob.signedRequest());
  assertEquals(session?.get("userId"), undefined);
  assertEquals(session?.thumbprint, bob.thumbprint);
});

Deno.test("refuses to regenerate the session id", async () => {
  const { signedRequest } = await browser();
  const { session } = await run(memoryStorage(), await signedRequest());
  assert(session);
  let threw = false;
  try {
    session.regenerateId();
  } catch {
    threw = true;
  }
  assert(threw, "regenerateId() should reject: the id comes from the key");
});

Deno.test("replay detector accepts a jti once", () => {
  const detector = new InMemoryReplayDetector();
  assert(detector.check("jti-1"));
  assertEquals(detector.check("jti-1"), false);
});
