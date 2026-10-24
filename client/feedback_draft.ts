/**
 * A report a game has already started writing, carried in the link.
 *
 * `/feedback/@{author}/{slug}#kind=bug&message=…` opens the form with the type
 * chosen and the text box filled. A game knows things the player would
 * otherwise have to copy out by hand — the stage, the score, the error it
 * just caught — and this is how it hands them over.
 *
 * A fragment for the claim link's reasons: it never reaches a server, so a
 * draft the player has not agreed to send is never logged; and a plain link
 * works from inside a sandbox. It is only ever a draft. Nothing is sent until
 * the player presses the button, or a link could post reports in the name of
 * whoever opened it.
 *
 * A fragment does not survive signing in — the hub hands the IdP a return
 * path, not a whole URL — so the form keeps it in `sessionStorage` across the
 * round trip, as the claim page does. One tab, one visit, taken once.
 */

export type FeedbackKind = "bug" | "request" | "other";

/** What a link may prefill. Either half may be missing. */
export interface FeedbackDraft {
  readonly kind?: FeedbackKind;
  readonly message?: string;
}

const KINDS: readonly FeedbackKind[] = ["bug", "request", "other"];

/**
 * Read a draft out of a fragment.
 *
 * Whatever does not parse is dropped rather than refused: a draft is a
 * convenience, and the form works without one.
 *
 * @param hash `location.hash`, with or without its leading `#`
 */
export function parseFeedbackDraft(hash: string): FeedbackDraft {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const kind = params.get("kind");
  const message = params.get("message");
  return {
    ...(KINDS.includes(kind as FeedbackKind)
      ? { kind: kind as FeedbackKind }
      : {}),
    ...(message ? { message } : {}),
  };
}

/** Where the draft waits while the player signs in. */
const KEY = "gc:feedback-after-sign-in";

/** Keep the fragment for this game until the player comes back. */
export function rememberFeedbackDraft(gameId: string, hash: string): void {
  try {
    sessionStorage.setItem(KEY, `${gameId} ${hash}`);
  } catch {
    // Losing it costs the player retyping, not the report.
  }
}

/**
 * Read the stashed fragment for this game and forget it.
 *
 * Taken whether or not it matches, so a draft for one game cannot surface on
 * another game's form later.
 */
export function takeFeedbackDraft(gameId: string): string | null {
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
