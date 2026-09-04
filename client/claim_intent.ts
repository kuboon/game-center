/**
 * A claim that is waiting for the player to sign in.
 *
 * The list of unlocks arrives in the URL fragment, and a fragment does not
 * survive the round trip to the IdP: the hub sends a return path, not a whole
 * URL, and the browser never sends a fragment to a server anyway. So the page
 * puts it here before handing the visitor to the IdP, and picks it up when
 * they come back.
 *
 * `sessionStorage` rather than the return URL, for the reason
 * `follow_intent.ts` gives: a return URL can be shared, and this one would
 * carry a list of achievements somebody else's browser would then be asked to
 * record. This belongs to one tab and one visit.
 *
 * Never throws. Storage can be unavailable, and a player who loses this can
 * still follow the link from the game again.
 */

/** Where the pending claim is kept. */
const KEY = "gc:claim-after-sign-in";

/** Remember the fragment the player arrived with. */
export function rememberClaimIntent(gameId: string, hash: string): void {
  try {
    sessionStorage.setItem(KEY, `${gameId} ${hash}`);
  } catch {
    // Losing this costs one trip back to the game, not the record.
  }
}

/**
 * Read the pending claim for this game and forget it.
 *
 * Taken whether or not it matches, so a list left by an earlier visit cannot
 * sit in storage waiting to appear on some other game's claim page.
 *
 * @param gameId The game whose claim page is asking
 * @returns The fragment the player arrived with, or null
 */
export function takeClaimIntent(gameId: string): string | null {
  try {
    const stored = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!stored) return null;
    const [storedGame, ...rest] = stored.split(" ");
    return storedGame === gameId ? rest.join(" ") : null;
  } catch {
    return null;
  }
}
