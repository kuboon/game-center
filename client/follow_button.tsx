/**
 * FollowButton — the follower counts, the follow control, and the way in for
 * someone who arrived from a link.
 *
 * The page around it is server-rendered and identical for everyone, because a
 * player's games and records are public. Whether *you* follow them is not
 * something the server can know: SSR carries no DPoP proof.
 *
 * The counts live here rather than on the page, because following changes one
 * of them and two places showing one number would disagree the moment the
 * button is pressed. They are seeded from props, so the server-rendered paint
 * already carries the right numbers and nothing moves when the browser catches
 * up.
 *
 * A signed-out visitor is offered sign-in, and this is the most important
 * thing on the page. The way people arrive at game-center is that an author
 * posts this URL somewhere and someone follows the link — so the visitor who
 * is not signed in is not a stray, they are the point. Pressing the button
 * remembers who they meant to follow, and the follow happens for them when
 * they come back with a session.
 *
 * That intent is kept in `sessionStorage` rather than in the return URL. A URL
 * can be shared, and a link that silently makes whoever opens it follow
 * somebody is not something to hand out.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { rememberFollowIntent, takeFollowIntent } from "./follow_intent.ts";
import { mountSession, sessionStore } from "./session.ts";

export interface FollowButtonProps {
  /** The player whose page this is. */
  handle: string;
  /** Their display name, for the line confirming the follow. */
  displayName: string;
  /** Counts as the server rendered them, so the first paint is already right. */
  followers: number;
  followees: number;
  [key: string]: SerializableValue;
}

/** What every `/api/internal/follows` route answers. */
interface FollowState {
  following: boolean;
  self: boolean;
  followers: number;
  followees: number;
}

export const FollowButton = clientEntry(
  "/follow_button.js#FollowButton",
  function FollowButton(handle: Handle<FollowButtonProps>) {
    let state: FollowState | null = null;
    let busy = false;
    /** Whose session `state` was fetched for, so a re-render does not re-ask. */
    let probedFor: string | null = null;
    /** Set when the follow happened on the visitor's behalf, not by a press. */
    let announced = false;

    const target = () => encodeURIComponent(handle.props.handle);

    const request = async (
      path: string,
      init: RequestInit = {},
    ): Promise<FollowState | null> => {
      const fetchDpop = sessionStore.fetchDpop;
      if (!fetchDpop) return null;
      const response = await fetchDpop(path, init);
      if (!response.ok) return null;
      return await response.json() as FollowState;
    };

    const sendFollow = () =>
      request("/api/internal/follows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: handle.props.handle }),
      });

    /** Ask once per signed-in identity, and forget the answer on sign-out. */
    const load = async () => {
      const userId = sessionStore.userId;
      if (!userId) {
        probedFor = null;
        state = null;
        return handle.update();
      }
      if (probedFor === userId) return;
      probedFor = userId;

      state = await request(`/api/internal/follows/@${target()}`);
      handle.update();

      // Whatever the visitor asked for before signing in, do it now. Taken
      // unconditionally so a stale intent cannot sit around waiting for the
      // next profile page to load.
      const intended = takeFollowIntent();
      if (
        intended === handle.props.handle && state && !state.self &&
        !state.following
      ) {
        const followed = await sendFollow();
        if (followed) {
          state = followed;
          announced = true;
          handle.update();
        }
      }
    };

    const session = mountSession(handle, load);

    const signInToFollow = () => {
      rememberFollowIntent(handle.props.handle);
      sessionStore.signIn(globalThis.location.pathname);
    };

    const toggle = async () => {
      if (busy || !state) return;
      busy = true;
      announced = false;
      handle.update();

      const next = state.following
        ? await request(`/api/internal/follows/@${target()}`, {
          method: "DELETE",
        })
        : await sendFollow();

      // A failed call leaves the old state showing rather than flipping the
      // label: the button says what the hub knows, not what was attempted.
      if (next) state = next;
      busy = false;
      handle.update();
    };

    return () => {
      const followers = state?.followers ?? handle.props.followers;
      const followees = state?.followees ?? handle.props.followees;
      // Bound rather than tested inline so the null check narrows `state`.
      const active = session.ready && sessionStore.userId && state &&
          !state.self
        ? state
        : null;
      const invited = session.ready && !sessionStore.userId;

      return (
        <div class="space-y-2">
          <span class="flex flex-wrap items-center gap-4">
            {active
              ? (
                <button
                  type="button"
                  class={active.following
                    ? "btn btn-outline btn-sm"
                    : "btn btn-primary btn-sm"}
                  disabled={busy}
                  mix={[on("click", () => void toggle())]}
                >
                  {busy
                    ? <span class="loading loading-spinner loading-xs"></span>
                    : active.following
                    ? "フォロー中"
                    : "フォローする"}
                </button>
              )
              : null}
            {invited
              ? (
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  mix={[on("click", signInToFollow)]}
                >
                  サインインしてフォロー
                </button>
              )
              : null}
            <span class="text-sm opacity-70">
              フォロワー {followers} / フォロー中 {followees}
            </span>
          </span>

          {announced
            ? (
              <p class="text-success text-sm">
                {handle.props.displayName} さんをフォローしました
              </p>
            )
            : null}
          {invited
            ? (
              <p class="text-sm opacity-70">
                game-center
                は、いろんなミニゲームの実績を一箇所に集めるハブです。
                サインインすると、この人の新しいゲームと記録を追えます。
              </p>
            )
            : null}
        </div>
      );
    };
  },
);
