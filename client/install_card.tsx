/**
 * InstallCard — "add to home screen", as a `clientEntry`.
 *
 * Installing is worth offering for its own sake — a launcher icon and no
 * address bar over the cabinet — but it is also load-bearing: **on iOS, Web
 * Push works only inside a home-screen PWA.** So this is the first half of
 * "notify me", and it has to come before the notification switch, not beside
 * it.
 *
 * `@kuboon/browser-how-to` answers the part that is otherwise a pile of UA
 * sniffing: whether this browser can install at all, whether it wants the
 * native prompt or a manual walkthrough, and whether the page is trapped in an
 * in-app browser that blocks the whole thing. The card only decides whether to
 * appear; the modal is the library's.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { createA2hs } from "@kuboon/browser-how-to/a2hs";
import { showA2hsGuide } from "@kuboon/browser-how-to/a2hs/ui";

export interface InstallCardProps {
  [key: string]: SerializableValue;
}

export const InstallCard = clientEntry(
  "/install_card.js#InstallCard",
  function InstallCard(handle: Handle<InstallCardProps>) {
    // Created lazily: the module registers a `beforeinstallprompt` listener on
    // import, which is meaningless during SSR.
    const a2hs = typeof document === "undefined" ? null : createA2hs();

    if (a2hs) {
      // The native prompt can arrive after first paint, so the card has to be
      // able to appear late rather than deciding once.
      const stop = a2hs.onChange(() => handle.update());
      handle.signal.addEventListener("abort", stop, { once: true });
    }

    const onInstallClick = () => {
      showA2hsGuide({ onInstalled: () => handle.update() });
    };

    return () => {
      if (!a2hs) return null;
      const { support } = a2hs.getStatus();
      // Nothing to offer: already installed, or a browser that cannot.
      if (support === "installed" || support === "unsupported") return null;

      return (
        <div class="card card-border bg-base-100">
          <div class="card-body">
            <h2 class="card-title">ホーム画面に追加</h2>
            <p>
              アイコンから直接開けるようになります。
              {support === "in-app-blocked"
                ? "いまはアプリ内ブラウザで開いているので、先にブラウザで開き直す必要があります。"
                : null}
            </p>
            <p class="text-sm opacity-70">
              iPhone と iPad では、通知を受け取るのにもこの追加が要ります。
            </p>
            <div class="card-actions">
              <button
                type="button"
                class="btn btn-primary btn-sm"
                mix={[on("click", onInstallClick)]}
              >
                追加のしかたを見る
              </button>
            </div>
          </div>
        </div>
      );
    };
  },
);
