/**
 * NavAuth — the navbar's sign-in state, as a `clientEntry`.
 *
 * The shell is server-rendered without a DPoP proof, so the server cannot know
 * whether the visitor is signed in. This entry fills that in from the browser:
 * it renders a neutral placeholder during SSR and swaps to a sign-in button or
 * the player's name once {@link sessionStore} has probed the IdP.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { sessionStore } from "./session.ts";

export interface NavAuthProps {
  /** Where the IdP should send the browser back to after authenticating. */
  returnTo: string;
  [key: string]: SerializableValue;
}

export const NavAuth = clientEntry(
  "/nav_auth.js#NavAuth",
  function NavAuth(handle: Handle<NavAuthProps>) {
    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => handle.update(), {
        signal: handle.signal,
      });
      void sessionStore.load();
    }

    const onSignInClick = () => sessionStore.signIn(handle.props.returnTo);

    return () => {
      if (!sessionStore.ready) {
        return <span class="loading loading-spinner loading-sm"></span>;
      }
      if (!sessionStore.userId) {
        return (
          <button
            type="button"
            class="btn btn-primary btn-sm"
            mix={[on("click", onSignInClick)]}
          >
            サインイン
          </button>
        );
      }
      return (
        <a class="btn btn-ghost btn-sm" href="/me" rmx-target="content">
          {sessionStore.displayName ?? sessionStore.userId}
        </a>
      );
    };
  },
);
