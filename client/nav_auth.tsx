/**
 * NavAuth — the navbar's sign-in state, as a `clientEntry`.
 *
 * The shell is server-rendered without a DPoP proof, so the server cannot know
 * whether the visitor is signed in. This entry fills that in from the browser:
 * it renders a neutral placeholder during SSR and swaps to a sign-in button or
 * the player's name once {@link sessionStore} has probed the IdP.
 *
 * The button wears the marquee rather than `btn-primary`: it sits in the
 * arcade-shell navbar directly above the cabinet, where a filled indigo button
 * reads as a stray control from another page. "INSERT COIN" is the sign-in
 * affordance an arcade already taught everybody.
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
        return (
          <span class="loading loading-spinner loading-sm text-arcade-dim">
          </span>
        );
      }
      if (!sessionStore.userId) {
        return (
          <button
            type="button"
            class="font-dot border-arcade-amber text-arcade-amber hover:bg-arcade-amber hover:text-arcade-screen rounded-lg border-2 px-4 py-2 text-sm transition"
            mix={[on("click", onSignInClick)]}
          >
            INSERT COIN
          </button>
        );
      }
      return (
        <a
          class="btn btn-ghost btn-sm text-arcade-ink max-w-40"
          href="/me"
          data-rmx-target="content"
        >
          <span class="truncate">
            {sessionStore.displayName ?? sessionStore.userId}
          </span>
        </a>
      );
    };
  },
);
