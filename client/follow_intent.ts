/**
 * A follow that is waiting for the visitor to sign in.
 *
 * The way most people reach game-center is that an author posts their profile
 * URL somewhere and a reader follows the link. That reader has no session yet,
 * so the follow they want cannot happen at the moment they ask for it. This
 * carries the request across the round trip to the IdP and back.
 *
 * `sessionStorage` rather than the return URL: a URL can be shared, and a link
 * that silently makes whoever opens it follow somebody is not something to
 * hand out. This belongs to one tab and one visit, and nothing anybody else
 * sends can put a value in it.
 *
 * Never throws. Storage can be unavailable — a private window, a browser set
 * to block site data — and a visitor who cannot store the intent should still
 * be able to sign in and press the button again.
 */

/** Where the pending follow is kept. */
const KEY = "gc:follow-after-sign-in";

/** Remember whose page the visitor pressed follow on. */
export function rememberFollowIntent(handle: string): void {
  try {
    sessionStorage.setItem(KEY, handle);
  } catch {
    // Losing this costs one button press, which is cheap next to failing here.
  }
}

/**
 * Read the pending follow and forget it.
 *
 * Taken rather than peeked, and taken whether or not the caller can use it, so
 * a request from an earlier page cannot sit in storage waiting to fire on some
 * unrelated profile later in the same visit.
 *
 * @returns The handle the visitor meant to follow, or null
 */
export function takeFollowIntent(): string | null {
  try {
    const handle = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return handle;
  } catch {
    return null;
  }
}
