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
 * A clientEntry wires itself up with {@link mountSession}, which is the only
 * correct way to do it — see the two traps documented there.
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
 * How long the *first* probe gets before the page stops waiting for it.
 *
 * Measured rather than guessed: `GET {IdP}/session` answers in 0.55–2.3s,
 * the TLS handshake being most of it. A longer deadline buys nothing on a
 * healthy path — it only decides how long a page sits half-drawn when the IdP
 * has gone quiet, and that page is usually `/@{handle}`, reached from a link
 * somebody posted.
 *
 * It is deliberately short because it is no longer the last word: an
 * inconclusive probe is retried in the background, so the page renders as
 * signed-out promptly and corrects itself if an answer turns up.
 */
const FIRST_PROBE_TIMEOUT_MS = 2_500;

/**
 * When to try again after an inconclusive first probe, and how long to wait
 * each time.
 *
 * Two attempts, then stop. This is for an IdP that is slow or briefly
 * unreachable; one that is down stays down, and asking forever would just burn
 * a phone's battery on a page that already works.
 */
const RETRY_DELAYS_MS = [1_000, 5_000];
const RETRY_TIMEOUT_MS = 8_000;

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
   * probe has come back saying nobody is signed in. A probe that does not
   * finish therefore does not merely delay the answer, it removes the button
   * from the page a visitor arrived at from somebody's link, which is the
   * single most important thing on it.
   *
   * So the first probe is given a short deadline and the page carries on
   * without it. An answer that never came is not the same as "signed out",
   * though, so it is asked for again in the background — the page starts
   * usable and becomes correct, instead of trading one for the other.
   */
  load(): Promise<void> {
    return (this.#loading ??= (async () => {
      let answered = false;
      try {
        const { fetchDpop, thumbprint } = await init();
        this.fetchDpop = fetchDpop;
        this.thumbprint = thumbprint;
        answered = await this.#adoptIdpSession(FIRST_PROBE_TIMEOUT_MS);
      } catch {
        // No DPoP (no IndexedDB, blocked storage). Nothing to retry: this
        // browser cannot hold a session at all.
        answered = true;
      } finally {
        this.ready = true;
        this.#emitChange();
      }
      if (!answered) void this.#retryProbe();
    })());
  }

  /**
   * Ask again, after the page is already usable.
   *
   * Only reached when the first probe was inconclusive — a timeout or a
   * network error, never a plain 401, which is a definite "signed out" and
   * needs no second opinion.
   */
  async #retryProbe(): Promise<void> {
    for (const delay of RETRY_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      // Signing in during the wait settles the question by itself.
      if (this.userId) return;
      if (await this.#adoptIdpSession(RETRY_TIMEOUT_MS)) {
        // A late session is worth telling everyone about; a late "signed out"
        // is what the page is already showing.
        if (this.userId) this.#emitChange();
        return;
      }
    }
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
   *
   * @param timeoutMs How long to wait for the IdP
   * @returns True when the round trip reached a conclusion, either way. False
   * means nobody answered, which is the one case worth asking again.
   */
  async #adoptIdpSession(timeoutMs: number): Promise<boolean> {
    if (!this.fetchDpop) return true;
    let session: IdpSession;
    try {
      const response = await this.fetchDpop(`${IDP_ORIGIN}/session`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      // A 401 is the IdP saying nobody is signed in. That is an answer.
      if (!response.ok) return true;
      session = await response.json() as IdpSession;
    } catch {
      // Timed out, or the request never left. Not an answer.
      return false;
    }
    if (!session.userId || !session.jws) return true;

    try {
      const response = await this.fetchDpop("/api/internal/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jws: session.jws }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return true;

      const hub = await response.json() as {
        userId: string;
        displayName: string;
        handle: string | null;
      };
      this.userId = hub.userId;
      this.displayName = hub.displayName;
      this.handle = hub.handle;
      return true;
    } catch {
      // The IdP vouched for this browser but the hub did not answer. Worth
      // asking again: the identity token is still good.
      return false;
    }
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

/** What {@link mountSession} gives a clientEntry to render from. */
export interface SessionMount {
  /**
   * Whether this entry has seen the session answer.
   *
   * Not the same as `sessionStore.ready`, and the difference is the point:
   * `ready` asks whether the *store* has finished, which on a frame navigation
   * was true long before this entry existed. This asks whether *this entry*
   * has been told, and it is false for the first render every time.
   */
  readonly ready: boolean;
}

/**
 * Wire a clientEntry to the shared session.
 *
 * Two things go wrong when this is written by hand, and both of them only go
 * wrong on a frame navigation — which is how most people move around the hub,
 * and which never happens while developing a single page by reloading it.
 *
 * **The change event does not come.** `load()` is idempotent: the second
 * caller gets the first call's promise and no event. An entry mounted into a
 * page whose session settled minutes ago will wait forever for a `change` that
 * has already happened, so whatever it meant to fetch is never fetched. That
 * is how `/@{handle}` lost its follow button and the game page stopped minting
 * launch tokens. So `whenSettled` is called once from here as well.
 *
 * **The first render must match the server.** The server has no session and
 * always renders the unknown state; a browser that already knows renders
 * something else, and the two disagree. Hence {@link SessionMount.ready},
 * which is false for the first render and true from the second — rather than
 * `sessionStore.ready`, which is whatever the store happens to know.
 *
 * @param handle The clientEntry's handle, for re-rendering and unmount
 * @param whenSettled Called once on mount and again on every later change
 * @returns What to render from
 */
export function mountSession(
  handle: { update(): void; signal: AbortSignal },
  whenSettled?: () => unknown,
): SessionMount {
  const mount = { ready: false };
  if (typeof document === "undefined") return mount;

  sessionStore.addEventListener("change", () => {
    handle.update();
    void whenSettled?.();
  }, { signal: handle.signal });

  void sessionStore.load().then(() => {
    mount.ready = true;
    handle.update();
    whenSettled?.();
  });

  return mount;
}
