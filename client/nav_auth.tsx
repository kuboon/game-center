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
 *
 * It also carries the one notification the hub has: a dot when somebody has
 * followed you since you last looked. Being followed is the only thing that
 * happens to a player without them doing anything, so it is the only thing
 * they will never go and check. The dot is here because this is the one
 * element on every page.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { mountSession, sessionStore } from "./session.ts";

export interface NavAuthProps {
  /** Where the IdP should send the browser back to after authenticating. */
  returnTo: string;
  [key: string]: SerializableValue;
}

export const NavAuth = clientEntry(
  "/nav_auth.js#NavAuth",
  function NavAuth(handle: Handle<NavAuthProps>) {
    const onSignInClick = () => sessionStore.signIn(handle.props.returnTo);

    /** Whose session the count belongs to, so a re-render does not re-ask. */
    let askedFor: string | null = null;

    /**
     * Ask how many followers are new.
     *
     * Reading that endpoint deliberately marks nothing seen — the dot has to
     * survive until the player has actually looked at the names.
     */
    const askUnseen = async () => {
      const { userId, fetchDpop } = sessionStore;
      if (!userId || !fetchDpop) {
        askedFor = null;
        return;
      }
      if (askedFor === userId) return;
      askedFor = userId;

      const response = await fetchDpop("/api/internal/followers");
      if (!response.ok) return;
      const { unseen } = await response.json() as { unseen: number };
      sessionStore.setUnseenFollowers(unseen);
    };

    const session = mountSession(handle, askUnseen);

    return () => {
      if (!session.ready) {
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
      const unseen = sessionStore.unseenFollowers ?? 0;
      return (
        <a
          class="btn btn-ghost btn-sm text-arcade-ink max-w-40"
          href="/me"
          data-rmx-target="content"
        >
          <span class="truncate">
            {sessionStore.displayName ?? sessionStore.userId}
          </span>
          {unseen > 0
            ? (
              <span
                class="badge badge-primary badge-sm"
                title={`新しいフォロワー ${unseen} 人`}
              >
                {unseen}
              </span>
            )
            : null}
        </a>
      );
    };
  },
);
