/**
 * Reading a list of unlocks out of a request body.
 *
 * Two endpoints take the same list — the game's REST call replaying whatever
 * it could not send at the time, and the hub's own claim page recording what a
 * player just confirmed — so the shape is described once. Both also still take
 * the older single-achievement form, because games ship their own copy of the
 * SDK and the copies already out there send it.
 */

import type { UnlockRequest } from "../db/unlocks.ts";

/**
 * How many unlocks one call may carry.
 *
 * A game that kept a queue while it could not reach the hub replays it in one
 * request, so the ceiling is on a batch rather than a sitting. It exists to
 * bound the work a single request can ask for, not to ration achievements: no
 * real manifest is near it.
 */
export const MAX_UNLOCKS_PER_CALL = 50;

export type ParsedUnlocks =
  | { readonly ok: true; readonly unlocks: UnlockRequest[] }
  | { readonly ok: false; readonly message: string };

/** Whether a body means the list form rather than the single-achievement one. */
export function isBulkBody(body: { unlocks?: unknown }): boolean {
  return body.unlocks !== undefined;
}

/**
 * Validate the `unlocks` array of a request body.
 *
 * Rejects rather than skips a bad entry: a caller that got the shape wrong
 * should hear about it, and unlike an unknown achievement key — which is a
 * fact about the manifest and answered per entry — this is a fact about the
 * request.
 *
 * @param value The body's `unlocks` field, unvalidated
 * @returns The requests to record, or why the body cannot be read
 */
export function parseUnlocks(value: unknown): ParsedUnlocks {
  if (!Array.isArray(value)) {
    return { ok: false, message: "unlocks must be an array" };
  }
  if (value.length === 0) {
    return { ok: false, message: "unlocks must not be empty" };
  }
  if (value.length > MAX_UNLOCKS_PER_CALL) {
    return {
      ok: false,
      message: `unlocks must hold at most ${MAX_UNLOCKS_PER_CALL} entries`,
    };
  }

  const unlocks: UnlockRequest[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, message: `unlocks[${index}] must be an object` };
    }
    const { key, score } = entry as { key?: unknown; score?: unknown };
    if (typeof key !== "string" || !key) {
      return { ok: false, message: `unlocks[${index}].key is required` };
    }
    if (score !== undefined && score !== null) {
      if (typeof score !== "number" || !Number.isInteger(score)) {
        return {
          ok: false,
          message: `unlocks[${index}].score must be an integer`,
        };
      }
      unlocks.push({ key, score });
      continue;
    }
    unlocks.push({ key, score: null });
  }
  return { ok: true, unlocks };
}
