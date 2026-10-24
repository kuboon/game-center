/**
 * AchievementBoard — a game's achievements, with where you stand on each, as a
 * `clientEntry`.
 *
 * The question a signed-in player brings to a game page is "how far have I
 * got", and the page used to have no answer. The list was server-rendered and
 * the same for everybody; your own records turned up only further down, as
 * "(あなた)" among the people you follow. So the list and your state are one
 * thing now: each row says whether you have it, when, and with what score, and
 * the people you follow fold into the same row instead of repeating the list
 * in a card of their own.
 *
 * The first render is what the server rendered — the list as anyone sees it —
 * because the server has no session and the browser must start from the same
 * markup. Your marks, the summary and the filter arrive with the session.
 *
 * Hidden achievements reach this component without their wording: the props
 * are serialized into the page, and the page is public. A hidden title you
 * have earned comes back from the progress endpoint, which only ever answers
 * with your own unlocks.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/component";

import { MASKED_TITLE } from "../server/lib/spoilers.ts";
import {
  achievementMark,
  formatCount,
  formatDate,
  formatPoints,
  formatScore,
  hiddenTag,
} from "./achievement_view.tsx";
import { mountSession, sessionStore } from "./session.ts";

/** One achievement as anyone may see it. */
export type PublicAchievement = {
  key: string;
  /** Null when hidden. */
  title: string | null;
  /** Null when hidden, or when the manifest gives none. */
  description: string | null;
  points: number;
  hidden: boolean;
};

export interface AchievementBoardProps {
  /** Author handle and slug, to address the endpoint. */
  handle: string;
  slug: string;
  /** Live achievements, in manifest order. */
  achievements: PublicAchievement[];
  [key: string]: SerializableValue;
}

/** One of your own unlocks, with the wording even when it is hidden. */
interface Mine {
  key: string;
  title: string;
  description: string | null;
  score: number | null;
  unlockedAt: string;
}

/** Somebody you follow, on one achievement. */
interface Peer {
  handle: string;
  displayName: string;
  score: number | null;
  unlockedAt: string;
}

type Filter = "all" | "locked" | "unlocked";

export const AchievementBoard = clientEntry(
  "/achievement_board.js#AchievementBoard",
  function AchievementBoard(handle: Handle<AchievementBoardProps>) {
    /** Null until the session says who you are; then your unlocks by key. */
    let mine: Map<string, Mine> | null = null;
    let peers = new Map<string, Peer[]>();
    let filter: Filter = "all";
    /** Whose session the data belongs to, so a re-render does not re-ask. */
    let loadedFor: string | null = null;

    const load = async () => {
      const userId = sessionStore.userId;
      if (!userId) {
        loadedFor = null;
        mine = null;
        peers = new Map();
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
        }/progress`,
      );
      if (!response.ok) return;
      const body = await response.json() as {
        mine: Mine[];
        peers: Array<{ key: string; entries: Peer[] }>;
      };
      mine = new Map(body.mine.map((unlock) => [unlock.key, unlock]));
      peers = new Map(body.peers.map(({ key, entries }) => [key, entries]));
      handle.update();
    };

    mountSession(handle, () => load());

    const show = (next: Filter) => () => {
      filter = next;
      handle.update();
    };

    return () => {
      const achievements = handle.props.achievements;
      const total = achievements.length;
      const totalPoints = achievements.reduce((sum, a) => sum + a.points, 0);
      const known = mine;

      const earned = known ? achievements.filter((a) => known.has(a.key)) : [];
      const visible = !known || filter === "all"
        ? achievements
        : achievements.filter((a) =>
          known.has(a.key) === (filter === "unlocked")
        );

      return (
        <div class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <div class="flex items-baseline justify-between gap-3">
              <h2 class="card-title">実績 {total} 件</h2>
              <span class="text-sm opacity-70">全 {totalPoints} pt</span>
            </div>

            {known && total > 0 ? summary(earned, achievements, known) : null}

            {known && total > 0
              ? (
                <div role="group" aria-label="表示する実績" class="join">
                  {tab("すべて", "all")}
                  {tab(`未解除 ${total - earned.length}`, "locked")}
                  {tab(`解除済み ${earned.length}`, "unlocked")}
                </div>
              )
              : null}

            {total === 0
              ? <p>このゲームはまだ実績を定義していません。</p>
              : (
                <ul class="space-y-3">
                  {visible.map((achievement) =>
                    row(
                      achievement,
                      known?.get(achievement.key),
                      peers.get(achievement.key) ?? [],
                      known !== null,
                    )
                  )}
                </ul>
              )}
          </div>
        </div>
      );
    };

    function tab(label: string, value: Filter) {
      const active = filter === value;
      return (
        <button
          type="button"
          class={active
            ? "btn btn-sm join-item btn-active"
            : "btn btn-sm join-item"}
          aria-pressed={active ? "true" : "false"}
          mix={[on("click", show(value))]}
        >
          {label}
        </button>
      );
    }
  },
);

/** "あなたの進捗": how many, how many points, and since when. */
function summary(
  earned: readonly PublicAchievement[],
  all: readonly PublicAchievement[],
  mine: ReadonlyMap<string, Mine>,
) {
  const points = earned.reduce((sum, a) => sum + a.points, 0);
  const totalPoints = all.reduce((sum, a) => sum + a.points, 0);
  const last = earned
    .map((a) => mine.get(a.key)?.unlockedAt ?? "")
    .sort()
    .at(-1);
  return (
    <section
      aria-label="あなたの進捗"
      class="border-primary/20 bg-primary/5 rounded-box space-y-2 border p-4"
    >
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-primary text-sm font-bold">あなたの進捗</span>
        {last
          ? <span class="text-xs opacity-70">最終 {formatDate(last)}</span>
          : null}
      </div>
      <div class="flex items-baseline justify-between gap-3 tabular-nums">
        <span class="text-lg font-bold">
          {formatCount(earned.length, all.length)}
        </span>
        <span class="font-bold">{formatPoints(points, totalPoints)}</span>
      </div>
      <progress
        class="progress progress-primary w-full"
        value={String(earned.length)}
        max={String(Math.max(all.length, 1))}
        aria-label={`${all.length} 件中 ${earned.length} 件解除`}
      >
      </progress>
    </section>
  );
}

/**
 * One achievement, with your state and the people you follow on it.
 *
 * `known` is false until the session answers, and also for anyone signed out:
 * then the row is exactly what the server rendered, with no mark at all rather
 * than a mark that claims something nobody has checked.
 */
function row(
  achievement: PublicAchievement,
  mine: Mine | undefined,
  peers: readonly Peer[],
  known: boolean,
) {
  // A hidden title is yours to read once you have earned it, and nobody
  // else's: it comes from your own unlock, never from the public props.
  const title = achievement.title ?? mine?.title ?? null;
  const description = achievement.description ?? mine?.description ?? null;
  const state = mine ? "unlocked" : achievement.hidden ? "secret" : "locked";

  return (
    <li key={achievement.key} class="border-base-300 flex gap-3 border-t pt-3">
      {known ? achievementMark(state) : null}
      <div class="min-w-0 flex-1 space-y-0.5">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <span class={title ? "font-bold" : "font-bold opacity-70"}>
            {title ?? MASKED_TITLE}
          </span>
          <span class="text-xs opacity-70">
            {formatPoints(achievement.points)}
          </span>
          {achievement.hidden && title ? hiddenTag() : null}
        </div>
        {description
          ? <p class="text-sm opacity-80">{description}</p>
          : achievement.hidden && !title
          ? <p class="text-sm opacity-70">解除すると内容がわかります</p>
          : null}
        {mine
          ? (
            <p class="text-xs font-bold tabular-nums">
              {mine.score === null ? "" : `${formatScore(mine.score)} · `}
              解除 {formatDate(mine.unlockedAt)}
            </p>
          )
          : known
          ? <p class="text-xs opacity-70">未解除</p>
          : null}
        {mine && achievement.hidden
          ? <p class="text-xs opacity-70">題名はあなたにだけ見えています</p>
          : null}
        {peers.length > 0 ? peerLine(peers) : null}
      </div>
    </li>
  );
}

/** How many names to list before folding the rest into a count. */
const PEERS_SHOWN = 3;

/**
 * The people you follow, on one achievement, in one line.
 *
 * Where there are scores, the best one — the comparison is the reason to show
 * it. Otherwise the first few names. Only ever people you chose to follow:
 * see docs/grand_design.md on why there is no ranking beyond that.
 */
function peerLine(peers: readonly Peer[]) {
  const best = peers.find((peer) => peer.score !== null);
  if (best && best.score !== null) {
    return (
      <p class="text-xs opacity-70">
        フォロー中の最高: {person(best)} {formatScore(best.score)}
      </p>
    );
  }
  const shown = peers.slice(0, PEERS_SHOWN);
  const rest = peers.length - shown.length;
  return (
    <p class="text-xs opacity-70">
      フォロー中で解除: {shown.flatMap((peer, index) =>
        index === 0 ? [person(peer)] : ["・", person(peer)]
      )}
      {rest > 0 ? ` ほか ${rest} 人` : ""}
    </p>
  );
}

function person(peer: Peer) {
  return (
    <a
      key={peer.handle}
      class="link"
      href={`/@${peer.handle}`}
      data-rmx-target="content"
    >
      {peer.displayName}
    </a>
  );
}
