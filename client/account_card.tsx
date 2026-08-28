/**
 * AccountCard — the /me page's sign-in status, as a `clientEntry`.
 *
 * Shows who the hub thinks you are and a way in or out. Like the navbar it
 * renders from browser state, because a server-rendered document carries no
 * DPoP proof.
 *
 * The DPoP key thumbprint is not shown. It is the session's identifier, it is
 * of no use to the person reading the page, and printing a credential-shaped
 * string invites someone to copy it somewhere.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { sessionStore } from "./session.ts";

export interface AccountCardProps {
  /** Where the IdP should send the browser back to after authenticating. */
  returnTo: string;
  [key: string]: SerializableValue;
}

export const AccountCard = clientEntry(
  "/account_card.js#AccountCard",
  function AccountCard(handle: Handle<AccountCardProps>) {
    let signOutBusy = false;
    let error: string | null = null;

    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => handle.update(), {
        signal: handle.signal,
      });
      void sessionStore.load();
    }

    const onSignInClick = () => sessionStore.signIn(handle.props.returnTo);

    const onSignOutClick = async () => {
      signOutBusy = true;
      error = null;
      handle.update();
      try {
        await sessionStore.signOut();
      } catch (cause) {
        error = `サインアウトに失敗しました: ${(cause as Error).message}`;
      } finally {
        signOutBusy = false;
        handle.update();
      }
    };

    return () => (
      <div class="card card-border bg-base-100">
        <div class="card-body">
          <h2 class="card-title">アカウント</h2>
          {!sessionStore.ready ? <p>確認中…</p> : sessionStore.userId
            ? (
              <>
                <p>
                  <span class="font-bold">
                    {sessionStore.displayName ?? sessionStore.userId}
                  </span>{" "}
                  としてサインインしています。
                </p>
                <div class="card-actions">
                  <button
                    type="button"
                    class="btn btn-outline btn-sm"
                    disabled={signOutBusy}
                    mix={[on("click", onSignOutClick)]}
                  >
                    サインアウト
                  </button>
                </div>
              </>
            )
            : (
              <>
                <p>サインインすると、遊んだゲームの実績がここに集まります。</p>
                <div class="card-actions">
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    mix={[on("click", onSignInClick)]}
                  >
                    id.kbn.one でサインイン
                  </button>
                </div>
              </>
            )}
          {error ? <p class="text-error text-sm">{error}</p> : null}
        </div>
      </div>
    );
  },
);
