/**
 * What players have reported about your games, as {@link DevConsole} shows it.
 *
 * Newest first, across every game you own, each with who sent it and from
 * which game. There is no reply: the hub carries notes to an author, not
 * conversations. What an author can do with a note is act on it and throw it
 * away.
 *
 * Renders nothing until there is something to read. An author with no reports
 * has nothing to do here, and a player with no games has no reason to see the
 * heading at all.
 */

import { on } from "@remix-run/component";

import { formatDate } from "./achievement_view.tsx";

export interface Report {
  id: number;
  gameId: string;
  gameTitle: string;
  kind: "bug" | "request" | "other";
  message: string;
  createdAt: string;
  sender: { handle: string | null; displayName: string };
  /** Arrived since the author last opened the inbox. */
  unseen: boolean;
}

const KIND_LABELS: Record<Report["kind"], string> = {
  bug: "不具合",
  request: "要望",
  other: "その他",
};

/**
 * @param reports The inbox, newest first
 * @param deleting The report whose removal is in flight, if any
 * @param onRemove Throw a report away
 */
export function feedbackInbox(
  reports: readonly Report[],
  deleting: number | null,
  onRemove: (id: number) => void,
) {
  if (reports.length === 0) return null;

  return (
    <div class="card card-border bg-base-100">
      <div class="card-body">
        <h2 class="card-title">届いたフィードバック {reports.length} 件</h2>
        <p class="text-sm opacity-70">
          {"あなたのゲームを遊んだ人からの不具合報告と要望です。"}
          {"返信の仕組みはありません。対応したら消してください。"}
        </p>
        <ul class="space-y-4">
          {reports.map((report) => (
            <li
              key={report.id}
              class="border-base-300 space-y-1 border-t pt-3"
            >
              <div class="flex flex-wrap items-baseline gap-x-2 text-sm">
                {report.unseen
                  ? <span class="badge badge-warning badge-sm">新着</span>
                  : null}
                <span class="badge badge-outline badge-sm">
                  {KIND_LABELS[report.kind]}
                </span>
                <a
                  class="link font-bold"
                  href={`/@${report.gameId}`}
                  data-rmx-target="content"
                >
                  {report.gameTitle}
                </a>
                <span class="opacity-70">
                  {report.sender.handle
                    ? (
                      <a
                        class="link"
                        href={`/@${report.sender.handle}`}
                        data-rmx-target="content"
                      >
                        {report.sender.displayName}
                      </a>
                    )
                    : report.sender.displayName} · {formatDate(
                      report.createdAt,
                    )}
                </span>
              </div>
              {
                /* A player's words, shown as theirs: kept apart from the
                  hub's own text, and never interpreted as markup. */
              }
              <blockquote class="border-base-300 border-l-4 pl-3 whitespace-pre-wrap break-words">
                {report.message}
              </blockquote>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                disabled={deleting === report.id}
                mix={[on("click", () => onRemove(report.id))]}
              >
                消す
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
