/**
 * Timeline — what the people you follow have been doing, as a `clientEntry`.
 *
 * The main thing on `/me`. It is a fetch rather than SSR because the feed is
 * built from your follow graph and a server-rendered document carries no DPoP
 * proof — the same reason `CatalogSections` works this way.
 *
 * Every row leads to the game. That is the point of the page: a record of what
 * your people played is only useful if it is one click from playing it too.
 *
 * There is no "everyone" feed behind this one. See docs/grand_design.md,
 * "偽装は防がない、代わりに誰を見るかを選ばせる".
 */

import {
  clientEntry,
  type Handle,
  type SerializableValue,
} from "@remix-run/ui";

import { sessionStore } from "./session.ts";

export interface TimelineProps {
  [key: string]: SerializableValue;
}

/** One row, as `/api/internal/timeline` sends it. */
interface TimelineEvent {
  kind: "unlock" | "game";
  at: string;
  handle: string;
  displayName: string;
  gameId: string;
  gameSlug: string;
  gameTitle: string;
  gameAuthorHandle: string | null;
  achievementTitle: string | null;
  points: number | null;
  score: number | null;
  hidden: boolean;
}

export const Timeline = clientEntry(
  "/timeline.js#Timeline",
  function Timeline(handle: Handle<TimelineProps>) {
    let events: TimelineEvent[] | null = null;
    /** Whose session `events` belongs to, so a re-render does not re-ask. */
    let loadedFor: string | null = null;

    const load = async () => {
      const userId = sessionStore.userId;
      if (!userId) {
        loadedFor = null;
        events = null;
        return handle.update();
      }
      if (loadedFor === userId) return;
      loadedFor = userId;

      const fetchDpop = sessionStore.fetchDpop;
      if (!fetchDpop) return;
      const response = await fetchDpop("/api/internal/timeline");
      if (response.ok) {
        events = (await response.json() as { events: TimelineEvent[] }).events;
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
      if (!sessionStore.ready) return <p class="opacity-70">確認中…</p>;
      if (!sessionStore.userId) {
        return (
          <p class="opacity-70">
            サインインすると、フォローしている人のうごきがここに流れます。
          </p>
        );
      }
      if (!events) return <p class="opacity-70">読み込み中…</p>;
      if (events.length === 0) {
        return (
          <p class="opacity-70">
            まだ何もありません。作者やプレイヤーのページでフォローすると、
            その人の実績と新しいゲームがここに流れます。
          </p>
        );
      }
      return <ul class="space-y-4">{events.map(row)}</ul>;
    };
  },
);

/**
 * One event.
 *
 * A plain function rather than a component, for the same reason `gameCard` in
 * home.tsx is one: static markup does not need a handle and a render function.
 */
function row(event: TimelineEvent) {
  const gameHref = event.gameAuthorHandle
    ? `/@${event.gameAuthorHandle}/${event.gameSlug}`
    : null;
  const gameLink = gameHref
    ? (
      <a
        class="link link-hover font-bold"
        href={gameHref}
        data-rmx-target="content"
      >
        {event.gameTitle}
      </a>
    )
    : <span class="font-bold">{event.gameTitle}</span>;

  return (
    <li
      key={`${event.kind}:${event.gameId}:${event.handle}:${event.at}`}
      class="border-base-300 border-t pt-4"
    >
      <p class="text-sm opacity-70">
        <a class="link" href={`/@${event.handle}`} data-rmx-target="content">
          {event.displayName}
        </a>
        {event.kind === "game" ? " がゲームを登録しました" : " が実績を解除"}
        {" · "}
        {event.at.slice(0, 10)}
      </p>
      {event.kind === "unlock"
        ? (
          <div class="flex flex-wrap items-baseline gap-2">
            <span class={event.hidden ? "font-bold opacity-70" : "font-bold"}>
              {event.achievementTitle}
            </span>
            {event.points !== null
              ? (
                <span class="badge badge-ghost badge-sm">
                  {event.points} pt
                </span>
              )
              : null}
            {event.score !== null
              ? <span class="badge badge-sm">{event.score}</span>
              : null}
          </div>
        )
        : null}
      <p class={event.kind === "unlock" ? "text-sm" : ""}>{gameLink}</p>
    </li>
  );
}
