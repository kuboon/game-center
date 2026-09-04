/**
 * Followers — who followed you, as a `clientEntry`.
 *
 * The one thing on `/me` that happened *to* the player. Everything else there
 * is a consequence of something they did and can be found by retracing it;
 * being followed cannot, which is why it is worth a section of its own and a
 * mark of what is new.
 *
 * Rendering the list is what marks it seen — not fetching it. The navbar reads
 * the same endpoint on every page load to decide whether to show a dot, and if
 * the read cleared the mark the dot would go out before anyone had read a name.
 */

import {
  clientEntry,
  type Handle,
  type SerializableValue,
} from "@remix-run/ui";

import { mountSession, sessionStore } from "./session.ts";

export interface FollowersProps {
  [key: string]: SerializableValue;
}

/** One row, as `/api/internal/followers` sends it. */
interface Follower {
  handle: string;
  displayName: string;
  followedAt: string;
  unseen: boolean;
}

export const Followers = clientEntry(
  "/followers.js#Followers",
  function Followers(handle: Handle<FollowersProps>) {
    let followers: Follower[] | null = null;
    let unseen = 0;
    /** Whose session the list belongs to, so a re-render does not re-ask. */
    let loadedFor: string | null = null;

    const load = async () => {
      const userId = sessionStore.userId;
      if (!userId) {
        loadedFor = null;
        followers = null;
        return handle.update();
      }
      if (loadedFor === userId) return;
      loadedFor = userId;

      const fetchDpop = sessionStore.fetchDpop;
      if (!fetchDpop) return;
      const response = await fetchDpop("/api/internal/followers");
      if (!response.ok) return;
      const body = await response.json() as {
        followers: Follower[];
        unseen: number;
      };
      followers = body.followers;
      unseen = body.unseen;
      handle.update();

      // Now that the names are on screen, they count as seen. Reported as the
      // newest row actually rendered rather than as "now", so a follow that
      // lands during the round trip is still new next time.
      const newest = followers[0]?.followedAt;
      if (unseen > 0 && newest) {
        await fetchDpop("/api/internal/followers/seen", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ through: newest }),
        });
        sessionStore.setUnseenFollowers(0);
      }
    };

    const session = mountSession(handle, () => load());

    return () => {
      if (!session.ready) return <p class="opacity-70">確認中…</p>;
      if (!sessionStore.userId) {
        return (
          <p class="opacity-70">
            サインインすると、あなたをフォローした人がここに出ます。
          </p>
        );
      }
      if (!followers) return <p class="opacity-70">読み込み中…</p>;
      if (followers.length === 0) {
        return (
          <p class="opacity-70">
            まだフォロワーはいません。プロフィールの URL を貼ると、
            見た人がここから追えるようになります。
          </p>
        );
      }
      return <ul class="space-y-3">{followers.map(row)}</ul>;
    };
  },
);

/**
 * One follower.
 *
 * A plain function rather than a component, for the same reason `gameCard` in
 * home.tsx is one: static markup does not need a handle and a render function.
 */
function row(follower: Follower) {
  return (
    <li key={follower.handle} class="border-base-300 border-t pt-3">
      <div class="flex flex-wrap items-baseline gap-2">
        <a
          class="link link-hover font-bold"
          href={`/@${follower.handle}`}
          data-rmx-target="content"
        >
          {follower.displayName}
        </a>
        {follower.unseen
          ? <span class="badge badge-primary badge-sm">new</span>
          : null}
        <span class="text-sm opacity-70">
          {follower.followedAt.slice(0, 10)}
        </span>
      </div>
    </li>
  );
}
