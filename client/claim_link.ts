/**
 * The claim link's payload, as the hub reads it.
 *
 * A game that could not reach the hub keeps its unlocks and hands the player a
 * link carrying all of them at once. The list rides in the URL **fragment**:
 *
 * ```
 * https://ga-cen.kbn.one/claim/@kuboon/my-puzzle#gc=first_clear,high_score:1200
 * ```
 *
 * A fragment rather than a POST body, and rather than a query string, for
 * three reasons. It stays a plain link, so it works from a sandboxed page and
 * the browser owns the navigation. It never reaches the server, so nothing a
 * game claims is written down — or logged — before the player has agreed to
 * it. And back and reload do nothing surprising, which a re-submitted POST
 * does.
 *
 * Plain text rather than base64 JSON because achievement keys are already
 * limited to lowercase letters, digits, underscores and hyphens, so `,` and
 * `:` cannot appear in one. That leaves a link a person can read before
 * following it, which is the whole point of the page it leads to.
 *
 * The SDK writes this format; nothing is shared between the two, so it is part
 * of the protocol rather than an implementation detail (see `docs/protocol.md`).
 */

/** One achievement a claim link is asking to record. */
export interface ClaimItem {
  readonly key: string;
  readonly score: number | null;
}

/** The fragment parameter the list travels in. */
export const CLAIM_PARAM = "gc";

/** The parameter naming what a game may now forget, on the way back to it. */
export const CLAIMED_PARAM = "gcclaimed";

/**
 * Read the claim list out of a URL fragment.
 *
 * Skips anything malformed rather than refusing the lot: the list comes from a
 * page the hub does not control, and one bad entry should not cost the player
 * the other nine. A score that is not a plain integer is dropped, keeping the
 * unlock.
 *
 * @param hash `location.hash`, with or without its leading `#`
 * @returns What the link asks to record, in the order it was written
 */
export function parseClaimLink(hash: string): ClaimItem[] {
  const raw = new URLSearchParams(hash.replace(/^#/, "")).get(CLAIM_PARAM);
  if (!raw) return [];

  const items: ClaimItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw.split(",")) {
    const [key, rawScore] = entry.split(":", 2);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const score = rawScore === undefined ? Number.NaN : Number(rawScore);
    items.push({ key, score: Number.isInteger(score) ? score : null });
  }
  return items;
}

/** The fragment that tells a game which unlocks it may stop carrying. */
export function claimedFragment(keys: readonly string[]): string {
  return `#${CLAIMED_PARAM}=${keys.join(",")}`;
}
