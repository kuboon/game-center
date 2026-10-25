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
 * It also carries the hub's notifications, because this is the one element on
 * every page:
 *
 * - On your name, a count of people who followed you since you last looked.
 *   Being followed is the only thing that happens to a player without them
 *   doing anything, so it is the only thing they will never go and check.
 * - On "開発者", what `/dev` has waiting: submissions naming you as author,
 *   and feedback from players since you last opened the inbox. An author has
 *   no other reason to open `/dev` on any given day, and a CI run stays stuck
 *   on a 202 until they do.
 *
 * The link itself is always there, signed in or not, and in the first render
 * too: someone who wants to make a game has not signed in yet, and a link that
 * appears late shoves the name across the bar.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/component";

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
     * Ask what is new: followers, and what `/dev` has waiting.
     *
     * Reading either endpoint deliberately marks nothing seen — a badge has to
     * survive until the player has actually looked at what it counts.
     */
    const askUnseen = async () => {
      const { userId, fetchDpop } = sessionStore;
      if (!userId || !fetchDpop) {
        askedFor = null;
        return;
      }
      if (askedFor === userId) return;
      askedFor = userId;

      const [followers, dev] = await Promise.all([
        fetchDpop("/api/internal/followers"),
        fetchDpop("/api/internal/dev/attention"),
      ]);
      if (followers.ok) {
        const { unseen } = await followers.json() as { unseen: number };
        sessionStore.setUnseenFollowers(unseen);
      }
      if (dev.ok) {
        const { pending, feedback } = await dev.json() as {
          pending: number;
          feedback: number;
        };
        sessionStore.setDevAttention(pending + feedback);
      }
    };

    const session = mountSession(handle, askUnseen);

    return () => (
      <div class="flex items-center gap-1">
        {devLink()}
        {account()}
      </div>
    );

    function devLink() {
      const waiting = session.ready && sessionStore.userId
        ? sessionStore.devAttention ?? 0
        : 0;
      return (
        <a
          class="btn btn-ghost btn-sm text-arcade-ink px-2"
          href="/dev"
          data-rmx-target="content"
        >
          開発者
          {waiting > 0
            ? (
              <span
                class="badge badge-warning badge-sm"
                title={`開発者ページに ${waiting} 件`}
              >
                {waiting}
              </span>
            )
            : null}
        </a>
      );
    }

    function account() {
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
          class="btn btn-ghost btn-sm text-arcade-ink max-w-28 px-2 sm:max-w-40"
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
    }
  },
);
