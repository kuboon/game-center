/**
 * The browser's shared DPoP session.
 *
 * Every signed-in surface — the navbar, the /me page — needs the same three
 * things: this browser's DPoP key, whether the IdP considers it signed in, and
 * whether the hub has been told about it. Each clientEntry is bundled into its
 * own `.js`, so module-level state is *not* shared between them; the store is
 * therefore anchored on `globalThis` under a global symbol, and every bundle
 * resolves to the one instance.
 *
 * {@link DpopSessionStore.load} is idempotent, so N components mounting at once
 * still probe the IdP once, and a `change` event keeps them in sync — signing
 * out in one place updates the navbar immediately.
 *
 * Subscribe with a clientEntry's `handle.signal` so the listener is dropped on
 * unmount:
 *
 * ```ts
 * sessionStore.addEventListener("change", () => handle.update(), {
 *   signal: handle.signal,
 * });
 * void sessionStore.load();
 * ```
 */

import { init } from "@kuboon/dpop";
import { TypedEventTarget } from "@remix-run/ui";

import { IDP_ORIGIN } from "./idp.ts";

export type FetchDpop = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type SessionEventMap = { change: Event };

/** What the IdP's `/session` answers a signed-in browser. */
interface IdpSession {
  readonly userId?: string | null;
  readonly jws?: string;
  readonly nickname?: string | null;
}

class DpopSessionStore extends TypedEventTarget<SessionEventMap> {
  /** DPoP-bound fetch, available once {@link load} resolves. */
  fetchDpop: FetchDpop | null = null;
  /** This browser's DPoP key thumbprint — needed to start the sign-in flow. */
  thumbprint = "";
  /** IdP user id, or `null` when signed out or not yet loaded. */
  userId: string | null = null;
  /** Display name the hub knows, once the session has been established. */
  displayName: string | null = null;
  /** True once the initial probe has resolved, successfully or not. */
  ready = false;

  #loading?: Promise<void>;

  /**
   * Generate or reuse the DPoP key, probe the IdP, and — when signed in — hand
   * the hub the identity token so it opens a server-side session.
   *
   * Always resolves, even when DPoP is unavailable, so subscribers leave the
   * loading state instead of hanging.
   */
  load(): Promise<void> {
    return (this.#loading ??= (async () => {
      try {
        const { fetchDpop, thumbprint } = await init();
        this.fetchDpop = fetchDpop;
        this.thumbprint = thumbprint;
        await this.#adoptIdpSession();
      } catch {
        // No DPoP (no IndexedDB, blocked storage): stay signed out but ready.
      } finally {
        this.ready = true;
        this.#emitChange();
      }
    })());
  }

  /** Send the browser to the IdP to authenticate, then back to `returnTo`. */
  signIn(returnTo: string): void {
    const params = new URLSearchParams({
      dpop_jkt: this.thumbprint,
      redirect_uri: new URL(returnTo, globalThis.location.origin).href,
    });
    globalThis.location.href = `${IDP_ORIGIN}/authorize?${params}`;
  }

  /** Sign out at the IdP, then notify every subscriber. */
  async signOut(): Promise<void> {
    if (!this.fetchDpop) return;
    await this.fetchDpop(`${IDP_ORIGIN}/session/logout`, { method: "POST" });
    this.userId = null;
    this.displayName = null;
    this.#emitChange();
  }

  /**
   * Ask the IdP who this key belongs to and pass the proof on to the hub.
   *
   * The hub is what actually decides we are signed in — it verifies the token's
   * signature and key binding — so a failure here leaves us signed out.
   */
  async #adoptIdpSession(): Promise<void> {
    if (!this.fetchDpop) return;
    let session: IdpSession;
    try {
      const response = await this.fetchDpop(`${IDP_ORIGIN}/session`);
      if (!response.ok) return;
      session = await response.json() as IdpSession;
    } catch {
      // Signed out: the cross-origin probe can 401 or reject outright.
      return;
    }
    if (!session.userId || !session.jws) return;

    const response = await this.fetchDpop("/api/internal/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jws: session.jws }),
    });
    if (!response.ok) return;

    const hub = await response.json() as {
      userId: string;
      displayName: string;
    };
    this.userId = hub.userId;
    this.displayName = hub.displayName;
  }

  #emitChange(): void {
    this.dispatchEvent(new Event("change"));
  }
}

// Cross-bundle singleton: independently bundled clientEntries each evaluate
// this module, so the one instance is anchored on globalThis.
const STORE_KEY = Symbol.for("game-center.dpop-session-store");
const holder = globalThis as unknown as Record<
  symbol,
  DpopSessionStore | undefined
>;

export const sessionStore: DpopSessionStore =
  (holder[STORE_KEY] ??= new DpopSessionStore());
