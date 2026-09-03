/**
 * Sending a notification through the IdP.
 *
 * The hub holds no VAPID key and no push subscriptions. The IdP owns both: the
 * browser subscribes against the IdP's VAPID key and registers the
 * subscription there, and the IdP records the `Origin` it was registered from.
 * `POST /rp/notifications` then delivers only to subscriptions whose origin is
 * this hub's domain, so a hub can wake its own players and nobody else's.
 *
 * Best-effort, always. A follow is recorded before this is called and stays
 * recorded whatever happens here — a push service that is slow, a player with
 * no device registered, or a hub with no signing key must not turn a follow
 * into a failed request. Failures are logged and swallowed.
 */

import { getConfig } from "../config.ts";
import { clientAssertion, NoSigningKeyError } from "./rp_identity.ts";

/** How long to wait on the IdP before giving up on a notification. */
const TIMEOUT_MS = 5_000;

/** What one notification says. */
export interface Notification {
  readonly title: string;
  readonly body: string;
  /** Where a tap should land. Relative to this hub. */
  readonly url?: string;
  /**
   * Number for the app icon's badge, or omitted to leave it alone.
   *
   * Only shows in an installed PWA. Zero clears it.
   */
  readonly badgeCount?: number;
}

/**
 * Notify players, by the IdP's own user identifiers.
 *
 * @param externalIds IdP user ids — `users.external_id`, not the local key
 * @param notification What to show
 * @returns True when the IdP accepted the request
 */
export async function notify(
  externalIds: readonly string[],
  notification: Notification,
): Promise<boolean> {
  if (externalIds.length === 0) return false;
  const config = getConfig();

  let assertion: string;
  try {
    assertion = await clientAssertion(config);
  } catch (error) {
    if (error instanceof NoSigningKeyError) {
      // A hub with no key cannot notify. That is a deployment fact, not a
      // per-request problem, and it must not fail the thing being notified about.
      console.warn("[notify] no signing key; skipping", error.message);
      return false;
    }
    throw error;
  }

  try {
    const response = await fetch(`${config.idpOrigin}/rp/notifications`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${assertion}`,
      },
      body: JSON.stringify({ userIds: externalIds, notification }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn("[notify] IdP answered", response.status);
      return false;
    }
    return true;
  } catch (cause) {
    // The IdP being unreachable is the IdP's problem, not the caller's.
    console.warn("[notify] could not reach the IdP:", (cause as Error).message);
    return false;
  }
}
