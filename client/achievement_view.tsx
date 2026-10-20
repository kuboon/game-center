/**
 * How achievements and a game's progress look, wherever they appear.
 *
 * The same unlock used to be drawn three ways: a ghost badge for points and a
 * bare-number badge for the score on `/me`, a plain badge for the score on a
 * profile, full timestamps in one place and dates in another. Each page was
 * right about itself and they disagreed with each other, so a number meant
 * whatever the page around it said it meant.
 *
 * These are the words and marks, kept in one place:
 *
 * - `70 pt` is points earned. `70 / 120 pt` is earned out of what the game
 *   declares, and always in that order — the two never appear as separate
 *   figures that look alike
 * - `3 / 6 解除`, and `全解除` once there is nothing left
 * - `スコア 1,200`: a score is named, because a number alone next to `30 pt`
 *   reads as another point count
 * - dates as `2026-10-14`, never with the time
 *
 * Plain functions rather than components, like `gameCard` in home.tsx: static
 * markup needs no handle. Both the server-rendered pages and the `clientEntry`
 * components draw with them, which is the point.
 */

/** `スコア 1,200`. */
export function formatScore(score: number): string {
  return `スコア ${score.toLocaleString("ja-JP")}`;
}

/** `2026-10-14`, from either an SQLite timestamp or an ISO one. */
export function formatDate(at: string): string {
  return at.slice(0, 10);
}

/** `3 / 6 解除`, or `5 / 5 全解除`. */
export function formatCount(unlocked: number, total: number): string {
  return total > 0 && unlocked >= total
    ? `${unlocked} / ${total} 全解除`
    : `${unlocked} / ${total} 解除`;
}

/** `70 pt`, or `70 / 120 pt` when the game's total is beside it. */
export function formatPoints(points: number, total?: number): string {
  return total === undefined ? `${points} pt` : `${points} / ${total} pt`;
}

/**
 * The mark in front of an achievement.
 *
 * Shape and word both say the state, never colour alone: a filled circle with
 * a tick for unlocked, an empty ring for not yet, a ring with a question mark
 * for a secret not yet earned. Hidden from assistive technology, because the
 * row says the same thing in words.
 */
export function achievementMark(state: "unlocked" | "locked" | "secret") {
  if (state === "unlocked") {
    return (
      <span
        aria-hidden="true"
        class="bg-success text-success-content mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold"
      >
        ✓
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      class="border-base-content/40 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold opacity-70"
    >
      {state === "secret" ? "?" : ""}
    </span>
  );
}

/** The tag beside a hidden achievement whose title is being shown. */
export function hiddenTag() {
  return <span class="badge badge-outline badge-xs">隠し</span>;
}

/** One game in a player's record. Mirrors `GameProgress` on the server. */
export interface ProgressRow {
  readonly gameId: string;
  readonly gameTitle: string;
  readonly unlocked: number;
  readonly total: number;
  readonly points: number;
  readonly totalPoints: number;
  readonly lastUnlockedAt: string;
}

/**
 * One game, as far as a player has got through it.
 *
 * The whole row is the link: what someone wants from it is the game's page,
 * where every achievement is listed with its state.
 */
export function progressRow(row: ProgressRow) {
  const complete = row.total > 0 && row.unlocked >= row.total;
  return (
    <li key={row.gameId} class="border-base-300 border-t">
      <a
        class="flex flex-col gap-2 py-3"
        href={`/@${row.gameId}`}
        data-rmx-target="content"
      >
        <span class="flex items-baseline justify-between gap-3">
          <span class="link-hover font-bold">{row.gameTitle}</span>
          <span
            class={complete
              ? "text-sm font-bold tabular-nums"
              : "text-sm tabular-nums opacity-70"}
          >
            {formatCount(row.unlocked, row.total)}
          </span>
        </span>
        <progress
          class={complete
            ? "progress progress-success h-1.5 w-full"
            : "progress progress-primary h-1.5 w-full"}
          value={String(row.unlocked)}
          max={String(Math.max(row.total, 1))}
          aria-label={`${row.total} 件中 ${row.unlocked} 件解除`}
        >
        </progress>
        <span class="flex justify-between text-xs tabular-nums opacity-70">
          <span>{formatPoints(row.points, row.totalPoints)}</span>
          <span>最終 {formatDate(row.lastUnlockedAt)}</span>
        </span>
      </a>
    </li>
  );
}
