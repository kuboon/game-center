/**
 * MyRecord — the player's own record on /me, as a `clientEntry`.
 *
 * Summed up per game: how far through each one, newest first, every row a link
 * to the game's page where each achievement is listed with its state. It used
 * to be every unlock across every game in one stream, which repeated the
 * public profile in a different shape and answered no question a player asks.
 *
 * Reads `/api/internal/me/achievements`, which needs a DPoP proof the
 * server-rendered page cannot carry.
 */

import { clientEntry, type Handle, on } from "@remix-run/ui";

import { type ProgressRow, progressRow } from "./achievement_view.tsx";
import { mountSession, sessionStore } from "./session.ts";

interface Summary {
  handle: string | null;
  points: number;
  unlocked: number;
  games: ProgressRow[];
}

export const MyRecord = clientEntry(
  "/my_record.js#MyRecord",
  function MyRecord(handle: Handle) {
    let record: Summary | null = null;
    let loaded = false;
    let error: string | null = null;

    const session = mountSession(handle, load);

    async function load(): Promise<void> {
      const { fetchDpop, userId } = sessionStore;
      if (!userId || !fetchDpop) {
        loaded = session.ready;
        handle.update();
        return;
      }
      try {
        const response = await fetchDpop("/api/internal/me/achievements");
        const body = await response.json() as Partial<Summary> & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        record = {
          handle: body.handle ?? null,
          points: body.points ?? 0,
          unlocked: body.unlocked ?? 0,
          games: body.games ?? [],
        };
        error = null;
      } catch (cause) {
        error = (cause as Error).message;
      } finally {
        loaded = true;
        handle.update();
      }
    }

    const onSignInClick = () => sessionStore.signIn("/me");

    return () => {
      if (!session.ready || (sessionStore.userId && !loaded)) {
        return <p class="opacity-70">読み込み中…</p>;
      }
      if (!sessionStore.userId) {
        return (
          <div class="space-y-3">
            <p>サインインすると、遊んだゲームごとの記録がここに出ます。</p>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              mix={[on("click", onSignInClick)]}
            >
              id.kbn.one でサインイン
            </button>
          </div>
        );
      }
      if (error) return <div class="alert alert-error">{error}</div>;
      if (!record || record.games.length === 0) {
        return (
          <p>
            まだ実績はありません。{" "}
            <a class="link" href="/" data-rmx-target="content">カタログ</a>{" "}
            からゲームを選んでみてください。
          </p>
        );
      }

      return (
        <div class="space-y-4">
          {record.handle
            ? (
              <p class="text-sm">
                <a
                  class="link"
                  href={`/@${record.handle}`}
                  data-rmx-target="content"
                >
                  公開プロフィールで見る
                </a>
              </p>
            )
            : null}
          <dl class="stats stats-horizontal border-base-300 w-full border">
            <div class="stat px-4 py-3">
              <dt class="stat-title text-xs">獲得ポイント</dt>
              <dd class="stat-value text-2xl tabular-nums">{record.points}</dd>
            </div>
            <div class="stat px-4 py-3">
              <dt class="stat-title text-xs">解除</dt>
              <dd class="stat-value text-2xl tabular-nums">
                {record.unlocked}
              </dd>
            </div>
            <div class="stat px-4 py-3">
              <dt class="stat-title text-xs">遊んだゲーム</dt>
              <dd class="stat-value text-2xl tabular-nums">
                {record.games.length}
              </dd>
            </div>
          </dl>
          <ul class="border-base-300 border-b">
            {record.games.map(progressRow)}
          </ul>
          <p class="text-sm opacity-70">
            最後に解除した順。押すとゲームのページで一件ずつ見られます。
          </p>
        </div>
      );
    };
  },
);
