/**
 * AchievementList — the player's own record on /me, as a `clientEntry`.
 *
 * Reads `/api/internal/me/achievements`, which needs a DPoP proof the
 * server-rendered page cannot carry.
 */

import { clientEntry, type Handle, on } from "@remix-run/ui";

import { sessionStore } from "./session.ts";

interface Unlock {
  gameId: string;
  gameTitle: string;
  key: string;
  title: string;
  description: string | null;
  points: number;
  unlockedAt: string;
  score: number | null;
}

export const AchievementList = clientEntry(
  "/achievement_list.js#AchievementList",
  function AchievementList(handle: Handle) {
    let unlocks: Unlock[] = [];
    let points = 0;
    let loaded = false;
    let error: string | null = null;

    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => {
        void load();
      }, { signal: handle.signal });
      void sessionStore.load().then(load);
    }

    async function load(): Promise<void> {
      const { fetchDpop, userId } = sessionStore;
      if (!userId || !fetchDpop) {
        loaded = sessionStore.ready;
        handle.update();
        return;
      }
      try {
        const response = await fetchDpop("/api/internal/me/achievements");
        const body = await response.json() as {
          unlocks?: Unlock[];
          points?: number;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        unlocks = body.unlocks ?? [];
        points = body.points ?? 0;
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
      if (!sessionStore.ready || (sessionStore.userId && !loaded)) {
        return <p>読み込み中…</p>;
      }
      if (!sessionStore.userId) {
        return (
          <div class="space-y-3">
            <p>サインインすると、解除した実績がここに集まります。</p>
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
      if (unlocks.length === 0) {
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
          <p class="text-lg">
            合計 <span class="font-bold">{points}</span> ポイント /{" "}
            {unlocks.length} 件
          </p>
          <ul class="space-y-3">
            {unlocks.map((unlock) => (
              <li
                key={`${unlock.gameId}/${unlock.key}`}
                class="border-base-300 border-t pt-3"
              >
                <div class="flex items-baseline gap-2">
                  <span class="font-bold">{unlock.title}</span>
                  <span class="badge badge-ghost badge-sm">
                    {unlock.points} pt
                  </span>
                  {unlock.score === null
                    ? null
                    : (
                      <span class="badge badge-primary badge-sm">
                        {unlock.score}
                      </span>
                    )}
                </div>
                <p class="text-sm opacity-70">
                  <a
                    class="link"
                    href={`/@${unlock.gameId}`}
                    data-rmx-target="content"
                  >
                    {unlock.gameTitle}
                  </a>{" "}
                  / {unlock.unlockedAt}
                </p>
                {unlock.description
                  ? <p class="text-sm">{unlock.description}</p>
                  : null}
              </li>
            ))}
          </ul>
        </div>
      );
    };
  },
);
