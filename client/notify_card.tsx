/**
 * NotifyCard — turning on push, as a `clientEntry`.
 *
 * The hub holds no VAPID key and stores no subscriptions. **id.kbn.one owns
 * both**: this page asks it for the VAPID public key, subscribes with that key
 * so only the IdP can push to the result, and registers the subscription
 * there. The IdP records the `Origin` it came from and its
 * `POST /rp/notifications` only delivers to subscriptions from the calling
 * hub's own domain — so a subscription made here can be woken by this hub and
 * by nothing else.
 *
 * The VAPID key belongs to whoever sends. It is baked into the subscription at
 * `subscribe()` time and the push service refuses anything not signed by the
 * matching private key, which is why this fetches the IdP's key rather than
 * minting one.
 *
 * `@kuboon/browser-how-to` decides whether asking is even possible — on iOS,
 * push works only inside a home-screen PWA, so `needs-install` sends the
 * player through the install walkthrough first.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { detectPushStatus } from "@kuboon/browser-how-to/push";
import { showPushGuide } from "@kuboon/browser-how-to/push/ui";

import { IDP_ORIGIN } from "./idp.ts";
import { mountSession, sessionStore } from "./session.ts";

export interface NotifyCardProps {
  [key: string]: SerializableValue;
}

export const NotifyCard = clientEntry(
  "/notify_card.js#NotifyCard",
  function NotifyCard(handle: Handle<NotifyCardProps>) {
    let subscribed: boolean | null = null;
    let busy = false;
    let error: string | null = null;

    const refresh = async () => {
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      subscribed = (await registration.pushManager.getSubscription()) !== null;
      handle.update();
    };

    const enable = async () => {
      busy = true;
      error = null;
      handle.update();
      try {
        const status = detectPushStatus();
        if (status.support !== "ready") {
          // Not askable yet: iOS before installing, an in-app browser, or a
          // permission the player already refused. The library knows which.
          showPushGuide();
          return;
        }

        if ((await Notification.requestPermission()) !== "granted") {
          error = "通知が許可されませんでした。";
          return;
        }

        const fetchDpop = sessionStore.fetchDpop;
        if (!fetchDpop) {
          error = "サインインし直してください。";
          return;
        }

        const keyResponse = await fetchDpop(`${IDP_ORIGIN}/push/vapid-key`);
        if (!keyResponse.ok) throw new Error(`vapid-key ${keyResponse.status}`);
        const { publicKey } = await keyResponse.json() as { publicKey: string };

        const registration = await navigator.serviceWorker.ready;
        // The base64url string form, which the Push API accepts directly —
        // no byte conversion, and nothing to get wrong on older Safari.
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });

        const saved = await fetchDpop(`${IDP_ORIGIN}/push/subscriptions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
        if (!saved.ok) {
          // A subscription the IdP does not know about is one nothing can
          // reach, so do not leave it behind pretending to work.
          await subscription.unsubscribe();
          throw new Error(`subscriptions ${saved.status}`);
        }

        subscribed = true;
      } catch (cause) {
        error = `通知を有効にできませんでした(${(cause as Error).message})`;
      } finally {
        busy = false;
        handle.update();
      }
    };

    const disable = async () => {
      busy = true;
      error = null;
      handle.update();
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        // Dropping it here stops delivery; the IdP prunes what the push
        // service reports as gone.
        if (subscription) await subscription.unsubscribe();
        subscribed = false;
      } catch (cause) {
        error = `通知を切れませんでした(${(cause as Error).message})`;
      } finally {
        busy = false;
        handle.update();
      }
    };

    const session = mountSession(handle);

    if (typeof document !== "undefined") {
      void refresh();
    }

    return () => {
      if (!session.ready) return null;
      if (!sessionStore.userId) return null;

      return (
        <div class="card card-border bg-base-100">
          <div class="card-body">
            <h2 class="card-title">通知</h2>
            <p>
              フォローされたときに、この端末に通知します。
            </p>
            <p class="text-sm opacity-70">
              通知は id.kbn.one から届きます。iPhone と iPad
              では、先にホーム画面へ追加しておく必要があります。
            </p>
            <div class="card-actions">
              {subscribed
                ? (
                  <button
                    type="button"
                    class="btn btn-outline btn-sm"
                    disabled={busy}
                    mix={[on("click", () => void disable())]}
                  >
                    この端末の通知を切る
                  </button>
                )
                : (
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    disabled={busy}
                    mix={[on("click", () => void enable())]}
                  >
                    この端末で通知を受け取る
                  </button>
                )}
            </div>
            {error ? <p class="text-warning text-sm">{error}</p> : null}
          </div>
        </div>
      );
    };
  },
);
