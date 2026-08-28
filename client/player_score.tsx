/**
 * PlayerScore — the cabinet's score display, showing the visitor their own.
 *
 * This is where an arcade would put a high-score table, and it deliberately
 * does not. A table ranking every player is the one place where forging an
 * unlock would start to pay, and the hub does not have one — see
 * docs/grand_design.md, "偽装は防がない、代わりに誰を見るかを選ばせる".
 *
 * What goes here instead is your own score, which is a number nobody has any
 * reason to lie to themselves about. For a signed-out visitor it is an empty
 * frame with an invitation, which is the more useful thing to show anyway: the
 * landing page's job is to give someone a reason to sign in.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { sessionStore } from "./session.ts";

export interface PlayerScoreProps {
  [key: string]: SerializableValue;
}

/** What `/api/internal/me/achievements` answers. */
interface Record_ {
  points: number;
  unlocks: unknown[];
}

export const PlayerScore = clientEntry(
  "/player_score.js#PlayerScore",
  function PlayerScore(handle: Handle<PlayerScoreProps>) {
    let record: Record_ | null = null;
    /** Whose session `record` belongs to, so a re-render does not re-ask. */
    let loadedFor: string | null = null;

    const load = async () => {
      const userId = sessionStore.userId;
      if (!userId) {
        loadedFor = null;
        record = null;
        return handle.update();
      }
      if (loadedFor === userId) return;
      loadedFor = userId;

      const fetchDpop = sessionStore.fetchDpop;
      if (!fetchDpop) return;
      const response = await fetchDpop("/api/internal/me/achievements");
      if (response.ok) record = await response.json() as Record_;
      handle.update();
    };

    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => void load(), {
        signal: handle.signal,
      });
      void sessionStore.load();
    }

    return () => {
      const signedIn = sessionStore.ready && sessionStore.userId;

      return (
        <div class="font-dot flex flex-col gap-3">
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-arcade-dim text-sm">SCORE</span>
            <span class="text-arcade-amber text-3xl tabular-nums">
              {record ? record.points : "—"}
            </span>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-arcade-dim text-sm">ACHIEVEMENTS</span>
            <span class="text-arcade-ink text-xl tabular-nums">
              {record ? record.unlocks.length : "—"}
            </span>
          </div>

          {signedIn
            ? (
              <a
                class="text-arcade-cyan mt-1 text-xs hover:underline"
                href="/me"
                rmx-target="content"
              >
                MY RECORDS ▸
              </a>
            )
            : (
              <button
                type="button"
                class="border-arcade-amber text-arcade-amber hover:bg-arcade-amber hover:text-arcade-screen mt-1 rounded-lg border-2 px-4 py-2 text-sm transition"
                disabled={!sessionStore.ready}
                mix={[on("click", () => sessionStore.signIn("/"))]}
              >
                INSERT COIN
              </button>
            )}
        </div>
      );
    };
  },
);
