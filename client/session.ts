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

/**
 * How long to wait for the IdP before deciding this browser is signed out.
 *
 * Generous enough for a slow phone on a bad connection, short enough that a
 * page whose IdP is down still becomes usable rather than sitting on a
 * spinner.
 */
const IDP_PROBE_TIMEOUT_MS = 8_000;

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
  /**
   * The public handle, which is what `/@{handle}` is keyed by.
   *
   * A column of its own at the hub rather than the IdP id, so it is asked for
   * rather than derived from {@link userId} — the two start equal and are free
   * to diverge.
   */
  handle: string | null = null;
  /** True once the initial probe has resolved, successfully or not. */
  ready = false;
  /**
   * Followers who arrived since this player last looked, or null until asked.
   *
   * Lives here rather than in a component because two of them need the same
   * number: the navbar draws a dot from it, and the `/me` list clears it after
   * showing the names. The store is the one thing both already share.
   */
  unseenFollowers: number | null = null;

  #loading?: Promise<void>;

  /**
   * Generate or reuse the DPoP key, probe the IdP, and — when signed in — hand
   * the hub the identity token so it opens a server-side session.
   *
   * Always resolves, even when DPoP is unavailable or the IdP never answers,
   * so subscribers leave the loading state instead of hanging.
   *
   * That last case is the one that matters. Every signed-in control on this
   * hub waits on {@link ready}, and so does every *signed-out* one — the
   * "サインインしてフォロー" button on a profile page is drawn only once the
   * probe has come back saying nobody is signed in. A probe with no deadline
   * therefore does not merely delay the answer, it removes the button from the
   * page a visitor arrived at from somebody's link, which is the single most
   * important thing on it.
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

  /**
   * Publish a new unseen-follower count to everyone rendering from it.
   *
   * Whoever learned the number sets it — the navbar after asking the hub, the
   * `/me` list after marking them seen. Nothing here fetches, because the two
   * callers want different things from the same endpoint and neither should
   * pay for the other's.
   */
  setUnseenFollowers(count: number): void {
    if (this.unseenFollowers === count) return;
    this.unseenFollowers = count;
    this.#emitChange();
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
    this.handle = null;
    // Somebody else's badge is not this browser's to keep showing.
    this.unseenFollowers = null;
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
      const response = await this.fetchDpop(`${IDP_ORIGIN}/session`, {
        signal: AbortSignal.timeout(IDP_PROBE_TIMEOUT_MS),
      });
      if (!response.ok) return;
      session = await response.json() as IdpSession;
    } catch {
      // Signed out, or the IdP did not answer in time. Both mean the same
      // thing to the page: carry on without a session. A visitor who was in
      // fact signed in gets a sign-in button that signs them straight back in,
      // which is recoverable; a page that never finishes loading is not.
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
      handle: string | null;
    };
    this.userId = hub.userId;
    this.displayName = hub.displayName;
    this.handle = hub.handle;
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
