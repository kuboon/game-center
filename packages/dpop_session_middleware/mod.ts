/**
 * DPoP session middleware for Remix v3 (fetch-router).
 *
 * Identifies a session by the JWK thumbprint (RFC 7638) of the client's DPoP
 * key (RFC 9449) rather than a signed cookie, which is what lets the hub share
 * a signed-in identity with id.kbn.one without setting one.
 *
 * A request without a valid DPoP proof passes through with no session set, so
 * ordinary page loads keep working — SSR documents cannot carry a proof. Each
 * handler decides what a missing session means: `context.has(DpopSession)` is
 * false, and JSON endpoints answer 401 while pages render signed-out.
 *
 * Vendored for the same reason as the session storage: id.kbn.one and
 * deno-remix-reference each keep their own copy of this middleware.
 *
 * ```ts
 * const router = createRouter({ middleware: [dpopSession({ sessionStorage })] });
 * router.map("/me", ({ get, has }) =>
 *   has(DpopSession)
 *     ? Response.json({ thumbprint: get(DpopSession).thumbprint })
 *     : new Response(null, { status: 401 }));
 * ```
 *
 * @module
 */

import type { Middleware } from "@remix-run/fetch-router";
import { Session, type SessionStorage } from "@remix-run/session";
import { computeThumbprint } from "@kuboon/dpop/common.ts";
import { verifyDpopProofFromRequest } from "@kuboon/dpop/server.ts";
import type { VerifyDpopProofOptions } from "@kuboon/dpop/types.ts";

/**
 * A session whose ID is the JWK thumbprint of the client's DPoP key.
 *
 * Used as a context key — `context.get(DpopSession)` returns the instance.
 */
export class DpopSession extends Session {
  /** The verified public key the proof was signed with. */
  readonly jwk: JsonWebKey;

  constructor(
    thumbprint: string,
    jwk: JsonWebKey,
    initialData?: Session["data"],
  ) {
    super(thumbprint, initialData);
    this.jwk = jwk;
  }

  /** Alias for {@link Session.id} — the thumbprint of the bound key. */
  get thumbprint(): string {
    return this.id;
  }

  /**
   * Not supported: the ID is derived from the client's key, so the server
   * cannot choose a new one.
   */
  override regenerateId(_deleteOldSession?: boolean): void {
    throw new Error(
      "Cannot regenerate ID of a DpopSession — the ID is derived from the client key",
    );
  }
}

/** Decides whether a proof's `jti` has been seen before. */
export interface ReplayDetector {
  /** Return true when the `jti` is acceptable, false when it is a replay. */
  check(jti: string): boolean | Promise<boolean>;
}

/**
 * Remembers every `jti` in this isolate's memory.
 *
 * Enough for a single long-lived process; on Deno Deploy, where isolates come
 * and go, it only narrows the replay window rather than closing it. Pass a
 * shared detector when that matters.
 */
export class InMemoryReplayDetector implements ReplayDetector {
  #seen = new Set<string>();

  check(jti: string): boolean {
    if (this.#seen.has(jti)) return false;
    this.#seen.add(jti);
    return true;
  }
}

export interface DpopSessionMiddlewareOptions {
  /** Where session data is persisted. */
  sessionStorage: SessionStorage;
  /** Detects replayed `jti` values. Defaults to an in-memory detector. */
  replayDetector?: ReplayDetector;
  /** Maximum age of a proof, in seconds. Defaults to 300. */
  maxAgeSeconds?: number;
  /** Allowed clock skew when validating `iat`, in seconds. Defaults to 60. */
  clockSkewSeconds?: number;
}

type SetDpopSessionContextTransform = readonly [
  { key: typeof DpopSession; value: DpopSession },
];

/**
 * Verify the DPoP proof on each request and expose the matching session.
 *
 * @param options Storage and proof-validation settings
 * @returns Middleware that sets {@link DpopSession} when a proof verifies
 */
export function dpopSession(
  options: DpopSessionMiddlewareOptions,
): Middleware<SetDpopSessionContextTransform> {
  const { sessionStorage } = options;
  const replayDetector = options.replayDetector ?? new InMemoryReplayDetector();

  const verifyOptions: VerifyDpopProofOptions = {
    maxAgeSeconds: options.maxAgeSeconds ?? 300,
    clockSkewSeconds: options.clockSkewSeconds ?? 60,
    checkReplay: (jti: string) => replayDetector.check(jti),
  };

  return async (context, next) => {
    const result = await verifyDpopProofFromRequest(
      context.request,
      verifyOptions,
    );
    // No or invalid proof: continue without a session rather than rejecting, so
    // routes that do not need one still work.
    if (!result.valid) return next();

    const thumbprint = await computeThumbprint(result.jwk);
    const stored = await sessionStorage.read(thumbprint);
    const session = new DpopSession(thumbprint, result.jwk, stored.data);
    context.set(DpopSession, session);

    const response = await next();

    if (session !== context.get(DpopSession)) {
      throw new Error(
        "Cannot save DPoP session that was replaced by another middleware/handler",
      );
    }
    await sessionStorage.save(session);

    return response;
  };
}
