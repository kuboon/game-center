/**
 * PeerScores — your records in this game next to the records of the people you
 * follow, as a `clientEntry`.
 *
 * The achievement list above is server-rendered and reads the same for a
 * visitor as for a signed-in player. This cannot join it: which rows to show
 * depends on who you follow, and SSR carries no DPoP proof. So it sits below
 * as its own section and appears only when there is something to compare.
 *
 * There is no game-wide ranking here, and adding one is not a later step. An
 * unlock is a claim rather than a fact, and a leaderboard is where making a
 * false one starts to pay — see docs/grand_design.md.
 */

import {
  clientEntry,
  type Handle,
  type SerializableValue,
} from "@remix-run/ui";

import { sessionStore } from "./session.ts";

export interface PeerScoresProps {
  /** Author handle and slug, to address the endpoint. */
  handle: string;
  slug: string;
  [key: string]: SerializableValue;
}

interface Entry {
  handle: string;
  displayName: string;
  score: number | null;
  unlockedAt: string;
  self: boolean;
}

interface PeerAchievement {
  key: string;
  /** Already masked by the server when the achievement is hidden. */
  title: string;
  hidden: boolean;
  entries: Entry[];
}

export const PeerScores = clientEntry(
  "/peer_scores.js#PeerScores",
  function PeerScores(handle: Handle<PeerScoresProps>) {
    let achievements: PeerAchievement[] | null = null;
    /** Whose session the data belongs to, so a re-render does not re-ask. */
    let loadedFor: string | null = null;

    const load = async () => {
      const userId = sessionStore.userId;
      if (!userId) {
        loadedFor = null;
        achievements = null;
        return handle.update();
      }
      if (loadedFor === userId) return;
      loadedFor = userId;

      const fetchDpop = sessionStore.fetchDpop;
      if (!fetchDpop) return;
      const { handle: author, slug } = handle.props;
      const response = await fetchDpop(
        `/api/internal/games/@${encodeURIComponent(author)}/${
          encodeURIComponent(slug)
        }/peers`,
      );
      if (response.ok) {
        achievements =
          (await response.json() as { achievements: PeerAchievement[] })
            .achievements;
      }
      handle.update();
    };

    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => void load(), {
        signal: handle.signal,
      });
      void sessionStore.load();
    }

    return () => {
      // Signed out, or nobody you follow has played this. Either way there is
      // nothing to say, and an empty heading saying it would be worse.
      if (!achievements || achievements.length === 0) return null;

      return (
        <div class="card card-border bg-base-100">
          <div class="card-body">
            <h2 class="card-title">フォロー中の人の記録</h2>
            <ul class="space-y-4">
              {achievements.map((achievement) => (
                <li
                  key={achievement.key}
                  class="border-base-300 border-t pt-3"
                >
                  <div class="flex items-baseline gap-2">
                    <span class="font-bold">{achievement.title}</span>
                    {achievement.hidden
                      ? (
                        <span class="badge badge-outline badge-sm">
                          隠し実績
                        </span>
                      )
                      : null}
                  </div>
                  <ul class="mt-2 space-y-1">
                    {achievement.entries.map(entry)}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    };
  },
);

/** One person's record. A plain function, like the rows on the page above. */
function entry(record: Entry) {
  return (
    <li
      key={record.handle}
      class="flex flex-wrap items-baseline justify-between gap-2 text-sm"
    >
      <span class={record.self ? "font-bold" : ""}>
        <a
          class="link link-hover"
          href={`/@${record.handle}`}
          data-rmx-target="content"
        >
          {record.displayName}
        </a>
        {record.self ? " (あなた)" : ""}
      </span>
      <span class="flex items-baseline gap-2">
        {record.score !== null
          ? <span class="badge badge-sm">{record.score}</span>
          : null}
        <span class="opacity-70">{record.unlockedAt.slice(0, 10)}</span>
      </span>
    </li>
  );
}
