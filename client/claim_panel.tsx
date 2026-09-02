/**
 * ClaimPanel — the claim URL's confirm button, as a `clientEntry`.
 *
 * This is the unlock path that works everywhere, including inside Claude
 * Artifacts: the game opens a link, and the player confirms here. The
 * confirmation is deliberate rather than automatic — landing on a URL should
 * not silently write to someone's record, and the player may not even be the
 * one who clicked.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { sessionStore } from "./session.ts";

export interface ClaimPanelProps {
  gameId: string;
  achievementKey: string;
  /** Score to record with the unlock, from `?score=`. Null when absent. */
  score: number | null;
  [key: string]: SerializableValue;
}

interface ClaimResponse {
  created?: boolean;
  scoreImproved?: boolean;
  unlock?: { title: string; points: number; score: number | null };
  error?: string;
}

export const ClaimPanel = clientEntry(
  "/claim_panel.js#ClaimPanel",
  function ClaimPanel(handle: Handle<ClaimPanelProps>) {
    let busy = false;
    let error: string | null = null;
    let done: ClaimResponse | null = null;

    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => handle.update(), {
        signal: handle.signal,
      });
      void sessionStore.load();
    }

    const returnTo = () =>
      `/claim/@${handle.props.gameId}/${handle.props.achievementKey}` +
      (handle.props.score === null ? "" : `?score=${handle.props.score}`);

    const onSignInClick = () => sessionStore.signIn(returnTo());

    const onClaimClick = async () => {
      const fetchDpop = sessionStore.fetchDpop;
      if (!fetchDpop) return;

      busy = true;
      error = null;
      handle.update();
      try {
        const response = await fetchDpop("/api/internal/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            gameId: handle.props.gameId,
            key: handle.props.achievementKey,
            ...(handle.props.score === null
              ? {}
              : { score: handle.props.score }),
          }),
        });
        const body = await response.json() as ClaimResponse;
        if (!response.ok) {
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        done = body;
      } catch (cause) {
        error = (cause as Error).message;
      } finally {
        busy = false;
        handle.update();
      }
    };

    return () => {
      if (!sessionStore.ready) return <p>確認中…</p>;

      if (!sessionStore.userId) {
        return (
          <div class="space-y-3">
            <p>実績を記録するにはサインインが必要です。</p>
            <button
              type="button"
              class="btn btn-primary"
              mix={[on("click", onSignInClick)]}
            >
              id.kbn.one でサインイン
            </button>
          </div>
        );
      }

      if (done) {
        return (
          <div class="space-y-3">
            <div class="alert alert-success">
              {done.created
                ? `「${done.unlock?.title}」を解除しました(${done.unlock?.points} ポイント)`
                : done.scoreImproved
                ? `ハイスコアを ${done.unlock?.score} に更新しました`
                : "この実績はすでに解除済みです"}
            </div>
            <a
              class="btn btn-outline btn-sm"
              href="/me"
              data-rmx-target="content"
            >
              自分の実績を見る
            </a>
          </div>
        );
      }

      return (
        <div class="space-y-3">
          {error ? <div class="alert alert-error">{error}</div> : null}
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy}
            mix={[on("click", onClaimClick)]}
          >
            実績を解除する
          </button>
        </div>
      );
    };
  },
);
