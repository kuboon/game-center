/**
 * FeedbackInbox — what players have reported about your games, on /dev, as a
 * `clientEntry`.
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

import { clientEntry, type Handle, on } from "@remix-run/ui";

import { formatDate } from "./achievement_view.tsx";
import { mountSession, sessionStore } from "./session.ts";

interface Report {
  id: number;
  gameId: string;
  gameTitle: string;
  kind: "bug" | "request" | "other";
  message: string;
  createdAt: string;
  sender: { handle: string | null; displayName: string };
}

const KIND_LABELS: Record<Report["kind"], string> = {
  bug: "不具合",
  request: "要望",
  other: "その他",
};

export const FeedbackInbox = clientEntry(
  "/feedback_inbox.js#FeedbackInbox",
  function FeedbackInbox(handle: Handle) {
    let reports: Report[] | null = null;
    /** Whose session the list belongs to, so a re-render does not re-ask. */
    let loadedFor: string | null = null;
    let deleting: number | null = null;

    const load = async () => {
      const userId = sessionStore.userId;
      if (!userId) {
        loadedFor = null;
        reports = null;
        return handle.update();
      }
      if (loadedFor === userId) return;
      loadedFor = userId;

      const fetchDpop = sessionStore.fetchDpop;
      if (!fetchDpop) return;
      const response = await fetchDpop("/api/internal/feedback");
      if (response.ok) {
        reports = (await response.json() as { feedback: Report[] }).feedback;
      }
      handle.update();
    };

    mountSession(handle, () => load());

    const remove = async (id: number) => {
      const fetchDpop = sessionStore.fetchDpop;
      if (!fetchDpop || deleting !== null) return;
      deleting = id;
      handle.update();
      const response = await fetchDpop(`/api/internal/feedback/${id}`, {
        method: "DELETE",
      });
      // Gone either way: a 404 means it was already removed elsewhere.
      if (response.ok || response.status === 404) {
        reports = (reports ?? []).filter((report) => report.id !== id);
      }
      deleting = null;
      handle.update();
    };

    return () => {
      if (!reports || reports.length === 0) return null;

      return (
        <div class="card card-border bg-base-100">
          <div class="card-body">
            <h2 class="card-title">届いたフィードバック</h2>
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
                    mix={[on("click", () => void remove(report.id))]}
                  >
                    消す
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    };
  },
);
