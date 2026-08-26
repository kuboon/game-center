/**
 * FollowButton — the follower counts, and the one control that depends on who
 * is looking, as a `clientEntry`.
 *
 * The page around it is server-rendered and identical for everyone, because a
 * player's games and records are public. Whether *you* follow them is not
 * something the server can know: SSR carries no DPoP proof.
 *
 * The counts come along for the ride rather than being rendered by the page,
 * because following changes one of them. Two places showing the same number
 * would disagree the moment the button is pressed. So this owns both, seeded
 * from props so the server-rendered paint already carries the right numbers,
 * and nothing moves when the browser takes over.
 *
 * A signed-out visitor sees the counts and no button. Offering a sign-in here
 * would be a detour away from a page they reached from somebody's link, for a
 * feature whose value they cannot see yet.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { sessionStore } from "./session.ts";

export interface FollowButtonProps {
  /** The player whose page this is. */
  handle: string;
  /** Counts as the server rendered them, so the first paint is already right. */
  followers: number;
  followees: number;
  [key: string]: SerializableValue;
}

/** What `/api/internal/follows/@{handle}` answers. */
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
    /** Whose session the current `state` was fetched for, to avoid re-asking. */
    let probedFor: string | null = null;

    const target = () => encodeURIComponent(handle.props.handle);

    const request = async (
      path: string,
      init: RequestInit,
    ): Promise<FollowState | null> => {
      const fetchDpop = sessionStore.fetchDpop;
      if (!fetchDpop) return null;
      const response = await fetchDpop(path, init);
      if (!response.ok) return null;
      return await response.json() as FollowState;
    };

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
      state = await request(`/api/internal/follows/@${target()}`, {});
      handle.update();
    };

    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => void load(), {
        signal: handle.signal,
      });
      void sessionStore.load();
    }

    const toggle = async () => {
      if (busy || !state) return;
      busy = true;
      handle.update();

      const next = state.following
        ? await request(`/api/internal/follows/@${target()}`, {
          method: "DELETE",
        })
        : await request("/api/internal/follows", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handle: handle.props.handle }),
        });

      // A failed call leaves the old state showing rather than flipping the
      // label: the button says what the hub knows, not what was attempted.
      if (next) state = next;
      busy = false;
      handle.update();
    };

    return () => {
      const followers = state?.followers ?? handle.props.followers;
      const followees = state?.followees ?? handle.props.followees;
      // Bound rather than tested inline so the null check narrows `state`
      // for the branch that reads it.
      const active = sessionStore.ready && sessionStore.userId && state &&
          !state.self
        ? state
        : null;

      return (
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
          <span class="text-sm opacity-70">
            フォロワー {followers} / フォロー中 {followees}
          </span>
        </span>
      );
    };
  },
);
