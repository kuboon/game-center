/**
 * ClaimAllPanel — everything a game has waiting, confirmed in one press.
 *
 * The game hands the player a link naming every unlock it could not record at
 * the time. This page turns those keys into titles, says which are already in
 * the player's record and which are not, and writes only when the player says
 * so. Landing on a URL must not write to somebody's record — and the person
 * holding the link may not even be the one who played.
 *
 * The keys come from a page the hub does not control, so nothing here trusts
 * them: the titles, the points and the already-recorded flags all come from
 * the hub's own copy of the manifest, and a key it does not know is shown as
 * unrecordable rather than dropped. A line that quietly disappears is worse
 * than one that says why it cannot be recorded.
 *
 * All of it is a `clientEntry` because none of it is knowable on the server —
 * the list is in the fragment, and reading the player's record needs a DPoP
 * proof an SSR request cannot carry.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { rememberClaimIntent, takeClaimIntent } from "./claim_intent.ts";
import {
  claimedFragment,
  type ClaimItem,
  parseClaimLink,
} from "./claim_link.ts";
import { sessionStore } from "./session.ts";

export interface ClaimAllPanelProps {
  gameId: string;
  /** Where the game lives, for the way back once the record is written. */
  gameUrl: string;
  [key: string]: SerializableValue;
}

/** One line of what the hub knows about a key the link named. */
interface PreviewItem {
  key: string;
  known: boolean;
  title?: string;
  points?: number;
  unlocked?: boolean;
  score?: number | null;
}

interface PreviewResponse {
  items?: PreviewItem[];
  error?: string;
}

interface ClaimOutcome {
  key: string;
  ok: boolean;
  created?: boolean;
  scoreImproved?: boolean;
}

interface ClaimResponse {
  results?: ClaimOutcome[];
  error?: string;
}

/** What one line will do if the player presses the button. */
type Effect = "new" | "score" | "recorded" | "unknown";

function effectOf(item: PreviewItem, asked: ClaimItem | undefined): Effect {
  if (!item.known) return "unknown";
  if (!item.unlocked) return "new";
  const score = asked?.score ?? null;
  const kept = item.score ?? null;
  if (score !== null && (kept === null || score > kept)) return "score";
  return "recorded";
}

const EFFECT_LABEL: Record<Effect, string> = {
  new: "新しく記録します",
  score: "スコアを更新します",
  recorded: "記録済み",
  unknown: "このゲームの実績ではありません",
};

export const ClaimAllPanel = clientEntry(
  "/claim_all_panel.js#ClaimAllPanel",
  function ClaimAllPanel(handle: Handle<ClaimAllPanelProps>) {
    /** What the link asked for. Read once, because the fragment can be lost. */
    let asked: ClaimItem[] = [];
    let preview: PreviewItem[] | null = null;
    let results: ClaimOutcome[] | null = null;
    let busy = false;
    let error: string | null = null;
    /** Whose session the preview was fetched for, so a re-render does not re-ask. */
    let previewedFor: string | null = null;

    if (typeof document !== "undefined") {
      // The fragment first, then whatever was stashed before signing in. The
      // stash is taken either way so it cannot surface on a later visit.
      asked = parseClaimLink(globalThis.location.hash);
      const stashed = takeClaimIntent(handle.props.gameId);
      if (asked.length === 0 && stashed) asked = parseClaimLink(stashed);

      sessionStore.addEventListener("change", () => void load(), {
        signal: handle.signal,
      });
      void sessionStore.load();
    }

    const load = async () => {
      const { fetchDpop, userId } = sessionStore;
      if (!userId || !fetchDpop || asked.length === 0) return handle.update();
      if (previewedFor === userId) return;
      previewedFor = userId;

      handle.update();
      try {
        const response = await fetchDpop("/api/internal/claim/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            gameId: handle.props.gameId,
            keys: asked.map((item) => item.key),
          }),
        });
        const body = await response.json() as PreviewResponse;
        if (!response.ok || !body.items) {
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        preview = body.items;
      } catch (cause) {
        previewedFor = null;
        error = (cause as Error).message;
      } finally {
        handle.update();
      }
    };

    const onSignInClick = () => {
      rememberClaimIntent(handle.props.gameId, globalThis.location.hash);
      sessionStore.signIn(globalThis.location.pathname);
    };

    const onConfirmClick = async () => {
      const fetchDpop = sessionStore.fetchDpop;
      if (!fetchDpop || busy) return;

      busy = true;
      error = null;
      handle.update();
      try {
        // Everything the link asked for, including what is already recorded:
        // unlocking is idempotent, and deciding here which lines to leave out
        // would be a second place that has to agree with the first.
        const response = await fetchDpop("/api/internal/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            gameId: handle.props.gameId,
            unlocks: asked.map(({ key, score }) => ({ key, score })),
          }),
        });
        const body = await response.json() as ClaimResponse;
        if (!response.ok || !body.results) {
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        results = body.results;
      } catch (cause) {
        error = (cause as Error).message;
      } finally {
        busy = false;
        handle.update();
      }
    };

    const titleOf = (item: PreviewItem) => item.title ?? item.key;

    return () => {
      if (!sessionStore.ready) return <p>確認中…</p>;

      if (asked.length === 0) {
        return (
          <div class="space-y-3">
            <p>このリンクは記録するものを指していません。</p>
            <a class="btn btn-outline btn-sm" href={handle.props.gameUrl}>
              ゲームに戻る
            </a>
          </div>
        );
      }

      if (!sessionStore.userId) {
        return (
          <div class="space-y-3">
            <p>
              {asked.length} 件の実績を記録します。サインインが必要です。
            </p>
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

      if (results) {
        // Only what was actually recorded may be forgotten by the game. A key
        // the hub refused stays in its queue, where the next manifest update
        // can still make it land.
        const kept = results.filter((result) => result.ok).map((r) => r.key);
        const created = results.filter((r) => r.ok && r.created).length;
        const improved = results.filter((r) => r.ok && r.scoreImproved).length;
        const refused = results.length - kept.length;
        return (
          <div class="space-y-3">
            <div class="alert alert-success">
              {created > 0 ? `${created} 件を解除しました。` : null}
              {improved > 0 ? `${improved} 件のスコアを更新しました。` : null}
              {created === 0 && improved === 0
                ? "すべて記録済みでした。"
                : null}
            </div>
            {refused > 0
              ? (
                <p class="text-sm opacity-70">
                  {refused}{" "}
                  件はこのゲームの実績として登録されていないため記録できませんでした。
                </p>
              )
              : null}
            <div class="flex flex-wrap gap-2">
              <a
                class="btn btn-primary btn-sm"
                href={`${handle.props.gameUrl}${claimedFragment(kept)}`}
              >
                ゲームに戻る
              </a>
              <a
                class="btn btn-outline btn-sm"
                href="/me"
                data-rmx-target="content"
              >
                自分の実績を見る
              </a>
            </div>
          </div>
        );
      }

      if (!preview) {
        return (
          <div class="space-y-3">
            {error ? <div class="alert alert-error">{error}</div> : null}
            <p>読み込み中…</p>
          </div>
        );
      }

      const byKey = new Map(asked.map((item) => [item.key, item]));
      const effects = preview.map((item) =>
        effectOf(item, byKey.get(item.key))
      );
      const changes =
        effects.filter((e) => e === "new" || e === "score").length;

      return (
        <div class="space-y-4">
          {error ? <div class="alert alert-error">{error}</div> : null}
          <ul class="divide-base-300 divide-y">
            {preview.map((item, index) => (
              <li class="flex items-baseline justify-between gap-4 py-2">
                <span class={effects[index] === "unknown" ? "opacity-50" : ""}>
                  {titleOf(item)}
                  {item.points !== undefined
                    ? (
                      <span class="text-sm opacity-70">
                        {` ${item.points} ポイント`}
                      </span>
                    )
                    : null}
                </span>
                <span
                  class={effects[index] === "new" || effects[index] === "score"
                    ? "text-primary text-sm whitespace-nowrap"
                    : "text-sm whitespace-nowrap opacity-70"}
                >
                  {EFFECT_LABEL[effects[index]]}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy || changes === 0}
            mix={[on("click", () => void onConfirmClick())]}
          >
            {changes === 0
              ? "記録するものはありません"
              : `${changes} 件を記録する`}
          </button>
        </div>
      );
    };
  },
);
