/**
 * DevConsole — the /dev dashboard, as a `clientEntry`.
 *
 * Everything here needs a DPoP proof, which a server-rendered document cannot
 * carry, so the whole panel is filled in by the browser after hydration.
 *
 * Two ways to register, and the difference is worth showing rather than
 * hiding. Registering a URL is what a game should normally do — the hub reads
 * the manifest from the game's own page, so nothing here has to be kept in
 * sync. Pasting is for a game the hub cannot fetch, such as a Claude Artifact,
 * whose public URL serves a shell rather than the author's HTML.
 *
 * The queue is the other half of a registration. Anyone may ask the hub to read
 * a manifest naming you as its author — the submission proves control of a URL,
 * and approving it here is you agreeing to be that author. Which is also why
 * the queue can hold things you never asked for, and dismissing costs one
 * click.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { mountSession, sessionStore } from "./session.ts";

export interface DevConsoleProps {
  /** Where the IdP should send the browser back to after authenticating. */
  returnTo: string;
  [key: string]: SerializableValue;
}

interface Achievement {
  key: string;
  title: string;
  points: number;
  hidden: boolean;
}

interface Game {
  /** `{author}/{slug}` — the game's full name. */
  id: string;
  slug: string;
  title: string;
  url: string;
  manifestUrl: string | null;
  status: string;
  achievements: Achievement[];
  /** How many unlocks players hold. Decides what removing it can mean. */
  unlocks: number;
}

/** A submission naming this account as author, not yet agreed to. */
interface Pending {
  id: number;
  /** The slug asked for. Not qualified yet, because it is not taken yet. */
  slug: string;
  title: string;
  manifestUrl: string;
  gameUrl: string;
  achievements: number;
  submittedAt: string;
}

interface ManifestIssue {
  path: string;
  message: string;
}

/** What the last registration did, shown above whichever form ran it. */
interface Outcome {
  readonly ok: boolean;
  readonly text: string;
  readonly issues?: readonly ManifestIssue[];
}

const sample = (handle: string) =>
  `{
  "$schema": "https://ga-cen.kbn.one/schema/gamecenter.json",
  "id": "my-puzzle",
  "author": "${handle}",
  "title": "My Puzzle",
  "icon": "/favicon.svg",
  "url": "https://claude.ai/public/artifacts/…",
  "achievements": [
    { "key": "first_clear", "title": "はじめてのクリア", "points": 10 }
  ]
}`;

export const DevConsole = clientEntry(
  "/dev_console.js#DevConsole",
  function DevConsole(handle: Handle<DevConsoleProps>) {
    let games: Game[] = [];
    let pending: Pending[] = [];
    let myHandle: string | null = null;
    let loaded = false;
    let loadError: string | null = null;
    let outcome: Outcome | null = null;
    let busy = false;

    let gameUrl = "";
    let manifestText = "";
    /** Which game's removal is waiting for a second press. */
    let confirming: string | null = null;

    const session = mountSession(handle, refresh);

    function api(path: string, init?: RequestInit): Promise<Response> {
      const fetchDpop = sessionStore.fetchDpop;
      if (!fetchDpop) throw new Error("この端末では DPoP を利用できません");
      return fetchDpop(path, init);
    }

    async function messageOf(response: Response): Promise<string> {
      try {
        const body = await response.json() as { error?: string };
        return body.error ?? `HTTP ${response.status}`;
      } catch {
        return `HTTP ${response.status}`;
      }
    }

    async function refresh(): Promise<void> {
      if (!sessionStore.userId) {
        loaded = session.ready;
        handle.update();
        return;
      }
      try {
        const response = await api("/api/internal/games");
        if (!response.ok) throw new Error(await messageOf(response));
        const body = await response.json() as {
          handle: string | null;
          games: Game[];
          pending: Pending[];
        };
        games = body.games;
        pending = body.pending;
        myHandle = body.handle;
        loadError = null;
      } catch (cause) {
        loadError = (cause as Error).message;
      } finally {
        loaded = true;
        handle.update();
      }
    }

    /** Both forms post to the same endpoint; only the body differs. */
    async function register(body: unknown): Promise<void> {
      busy = true;
      outcome = null;
      handle.update();
      try {
        const response = await api("/api/internal/games", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json() as {
          error?: string;
          issues?: ManifestIssue[];
          game?: Game;
          created?: boolean;
          retired?: string[];
          source?: string;
        };
        if (!response.ok) {
          outcome = {
            ok: false,
            text: result.error ?? `HTTP ${response.status}`,
            issues: result.issues,
          };
          return;
        }
        const retired = result.retired?.length
          ? `、${result.retired.length} 件の実績を retire しました`
          : "";
        const found = result.source === "embedded"
          ? "(ページ内の script から読みました)"
          : result.source === "file"
          ? "(gamecenter.json から読みました)"
          : "";
        outcome = {
          ok: true,
          text: `${result.game?.title} を${
            result.created ? "登録" : "更新"
          }しました${retired}${found}`,
        };
        await refresh();
      } catch (cause) {
        outcome = { ok: false, text: (cause as Error).message };
      } finally {
        busy = false;
        handle.update();
      }
    }

    /** Approving is the half of a registration only the named author can give. */
    const decide = async (entry: Pending, approve: boolean) => {
      busy = true;
      outcome = null;
      handle.update();
      try {
        const response = await api(`/api/internal/registrations/${entry.id}`, {
          method: approve ? "POST" : "DELETE",
        });
        const result = await response.json() as {
          error?: string;
          game?: Game;
        };
        if (!response.ok) {
          outcome = {
            ok: false,
            text: result.error ?? `HTTP ${response.status}`,
          };
          return;
        }
        outcome = {
          ok: true,
          text: approve
            ? `${result.game?.title} を登録しました`
            : `${entry.title} の登録を却下しました`,
        };
        await refresh();
      } catch (cause) {
        outcome = { ok: false, text: (cause as Error).message };
      } finally {
        busy = false;
        handle.update();
      }
    };

    /**
     * Removing a game asks twice.
     *
     * Not a `confirm()`, which cannot say what is about to happen: the two
     * outcomes differ, and which one it is depends on whether anybody has
     * played. So the row itself opens and spells it out.
     */
    const remove = async (game: Game) => {
      busy = true;
      outcome = null;
      handle.update();
      try {
        const response = await api(`/api/internal/games/@${game.id}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error(await messageOf(response));
        const { outcome: what } = await response.json() as {
          outcome: "deleted" | "withdrawn";
        };
        outcome = {
          ok: true,
          text: what === "deleted"
            ? `${game.title} を削除しました`
            : `${game.title} を公開停止にしました。解除済みの実績は残ります`,
        };
        confirming = null;
        await refresh();
      } catch (cause) {
        outcome = { ok: false, text: (cause as Error).message };
      } finally {
        busy = false;
        handle.update();
      }
    };

    const restore = async (game: Game) => {
      busy = true;
      outcome = null;
      handle.update();
      try {
        const response = await api(
          `/api/internal/games/@${game.id}/restore`,
          { method: "POST" },
        );
        if (!response.ok) throw new Error(await messageOf(response));
        outcome = { ok: true, text: `${game.title} を再公開しました` };
        await refresh();
      } catch (cause) {
        outcome = { ok: false, text: (cause as Error).message };
      } finally {
        busy = false;
        handle.update();
      }
    };

    const onSignInClick = () => sessionStore.signIn(handle.props.returnTo);

    const onRegisterUrlClick = () => {
      if (!gameUrl.trim()) return;
      return register({ url: gameUrl.trim() });
    };

    const onRegisterPasteClick = () => {
      let manifest: unknown;
      try {
        manifest = JSON.parse(manifestText);
      } catch (cause) {
        outcome = {
          ok: false,
          text: `JSON として読めません: ${(cause as Error).message}`,
        };
        handle.update();
        return;
      }
      return register({ manifest });
    };

    return () => {
      if (!session.ready || (sessionStore.userId && !loaded)) {
        return <p>読み込み中…</p>;
      }
      if (!sessionStore.userId) {
        return (
          <div class="card card-border bg-base-100">
            <div class="card-body">
              <h2 class="card-title">サインインが必要です</h2>
              <p>
                このページからゲームを登録するにはアカウントが要ります。 CI から
                URL を登録するだけなら、アカウントも認証も要りません。
              </p>
              <div class="card-actions">
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  mix={[on("click", onSignInClick)]}
                >
                  id.kbn.one でサインイン
                </button>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div class="space-y-6">
          {loadError ? <div class="alert alert-error">{loadError}</div> : null}
          {outcome
            ? (
              <div
                class={outcome.ok ? "alert alert-success" : "alert alert-error"}
              >
                <div>
                  <p>{outcome.text}</p>
                  {outcome.issues
                    ? (
                      <ul class="list-disc pl-5 text-sm">
                        {outcome.issues.map((issue) => (
                          <li key={issue.path}>
                            <code>{issue.path}</code>: {issue.message}
                          </li>
                        ))}
                      </ul>
                    )
                    : null}
                </div>
              </div>
            )
            : null}

          {myHandle
            ? (
              <div class="alert">
                <div>
                  <p>
                    あなたの作者 ID は <code class="break-all">{myHandle}</code>
                    {" "}
                    です。マニフェストの <code>author</code>{" "}
                    にこれを書きます。 AI に渡す手順一式は{" "}
                    <a class="link" href="/me" data-rmx-target="content">
                      マイページ
                    </a>{" "}
                    からコピーできます。
                  </p>
                </div>
              </div>
            )
            : null}

          {pending.length === 0
            ? null
            : (
              <div class="card card-border border-warning bg-base-100">
                <div class="card-body">
                  <h2 class="card-title">承認待ち {pending.length} 件</h2>
                  <p class="text-sm opacity-70">
                    あなたを作者として名指ししているマニフェストです。
                    <strong>取得元の URL を確かめてから</strong>{" "}
                    承認してください。承認すると、以後その URL
                    からの更新は素通しになります。
                    心当たりがなければ却下します。
                  </p>
                  <ul class="space-y-3">
                    {pending.map((entry) => (
                      <li key={entry.id} class="border-base-300 border-t pt-3">
                        <div class="flex items-baseline gap-2">
                          <span class="font-bold">{entry.title}</span>
                          <code class="text-sm opacity-70">
                            {myHandle ? `${myHandle}/` : ""}
                            {entry.slug}
                          </code>
                        </div>
                        <p class="text-sm break-all">
                          取得元 <code>{entry.manifestUrl}</code>
                        </p>
                        <p class="text-sm opacity-70">
                          実績 {entry.achievements} 件 / {entry.submittedAt}
                        </p>
                        <div class="mt-2 flex gap-2">
                          <button
                            type="button"
                            class="btn btn-primary btn-xs"
                            disabled={busy}
                            mix={[on("click", () =>
                              decide(entry, true))]}
                          >
                            承認して登録
                          </button>
                          <button
                            type="button"
                            class="btn btn-outline btn-error btn-xs"
                            disabled={busy}
                            mix={[on("click", () =>
                              decide(entry, false))]}
                          >
                            却下
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

          <div class="card card-border bg-base-100">
            <div class="card-body">
              <h2 class="card-title">URL から登録</h2>
              <p class="text-sm opacity-70">
                ゲームのページを指定すると、ハブがそこから{" "}
                <code>gamecenter.json</code>{" "}
                を読みます。ページ内の script
                が先で、無ければ隣のファイルを見ます。 以後の更新も同じ URL
                を送るだけです。
              </p>
              <div class="flex gap-2">
                <input
                  type="url"
                  class="input input-bordered input-sm flex-1"
                  placeholder="https://example.github.io/my-puzzle/"
                  mix={[on("input", (event) => {
                    gameUrl = (event.currentTarget as HTMLInputElement).value;
                  })]}
                />
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  disabled={busy}
                  mix={[on("click", onRegisterUrlClick)]}
                >
                  登録
                </button>
              </div>
            </div>
          </div>

          <div class="card card-border bg-base-100">
            <div class="card-body">
              <h2 class="card-title">登録したゲーム</h2>
              {games.length === 0
                ? <p>まだありません。</p>
                : (
                  <ul class="space-y-3">
                    {games.map((game) => (
                      <li key={game.id} class="border-base-300 border-t pt-3">
                        <div class="flex items-baseline gap-2">
                          <span class="font-bold">{game.title}</span>
                          <code class="text-sm opacity-70">{game.id}</code>
                          <span class="badge badge-ghost badge-sm">
                            {game.manifestUrl ? "URL 登録" : "貼り付け登録"}
                          </span>
                        </div>
                        <a
                          class="link text-sm break-all"
                          href={game.url}
                          rel="noreferrer"
                        >
                          {game.url}
                        </a>
                        <p class="text-sm opacity-70">
                          実績 {game.achievements.length} 件{game.unlocks > 0
                            ? ` / 解除 ${game.unlocks} 件`
                            : null}
                        </p>
                        {game.status === "hidden"
                          ? (
                            <div class="mt-2 flex flex-wrap items-center gap-2">
                              <span class="text-sm opacity-70">
                                公開停止中。カタログに出ず、新しい解除も受け付けません。
                              </span>
                              <button
                                type="button"
                                class="btn btn-outline btn-xs"
                                disabled={busy}
                                mix={[on("click", () => void restore(game))]}
                              >
                                再公開する
                              </button>
                            </div>
                          )
                          : confirming === game.id
                          ? (
                            <div class="mt-2 flex flex-wrap items-center gap-2">
                              <span class="text-sm">
                                {game.unlocks > 0
                                  ? `${game.unlocks} 件の解除があるので、削除ではなく公開停止になります。プレイヤーの記録はそのまま残ります。`
                                  : "まだ誰も遊んでいないので、完全に削除します。この id は空きに戻ります。"}
                              </span>
                              <button
                                type="button"
                                class="btn btn-error btn-xs"
                                disabled={busy}
                                mix={[on("click", () => void remove(game))]}
                              >
                                {game.unlocks > 0
                                  ? "公開停止にする"
                                  : "削除する"}
                              </button>
                              <button
                                type="button"
                                class="btn btn-ghost btn-xs"
                                disabled={busy}
                                mix={[on("click", () => {
                                  confirming = null;
                                  handle.update();
                                })]}
                              >
                                やめる
                              </button>
                            </div>
                          )
                          : (
                            <div class="mt-1 flex flex-wrap items-center gap-3">
                              {
                                /* Only a game the hub can fetch. A pasted one
                                  has no source to read again — its author
                                  updates it by pasting.

                                  The page URL rather than `manifestUrl`: the
                                  hub discovers a manifest by reading the page
                                  and then looking beside it, so handing it the
                                  `gamecenter.json` it found last time would be
                                  a different request from the one that
                                  registered the game. */
                              }
                              {game.manifestUrl
                                ? (
                                  <button
                                    type="button"
                                    class="link text-sm opacity-70"
                                    disabled={busy}
                                    mix={[on(
                                      "click",
                                      () => void register({ url: game.url }),
                                    )]}
                                  >
                                    再読み込み
                                  </button>
                                )
                                : null}
                              <button
                                type="button"
                                class="link text-sm opacity-70"
                                disabled={busy}
                                mix={[on("click", () => {
                                  confirming = game.id;
                                  outcome = null;
                                  handle.update();
                                })]}
                              >
                                {game.unlocks > 0 ? "公開停止" : "削除"}
                              </button>
                            </div>
                          )}
                      </li>
                    ))}
                  </ul>
                )}
              <p class="text-sm opacity-70">
                あなたが作者として登録されているゲームです。 URL
                登録のものは、その URL からの更新をそのまま受け付けます。
                「再読み込み」は、その URL
                をいま読み直してマニフェストを反映します。
              </p>
            </div>
          </div>

          <div class="card card-border bg-base-100">
            <div class="card-body">
              <h2 class="card-title">貼り付けて登録</h2>
              <p class="text-sm opacity-70">
                ハブが fetch できない場所のゲーム向けです。Claude Artifacts
                は公開 URL を開いても著者の HTML ではなく殻が返るので、こちらを
                使います。この場合は <code>url</code> が必須で、
                <code>author</code>{" "}
                はあなた自身でなければなりません。 URL
                の裏付けがないので、他人の名義では貼れません。
              </p>
              <textarea
                class="textarea textarea-bordered h-64 w-full font-mono text-sm"
                placeholder={sample(myHandle ?? "your-handle")}
                mix={[on("input", (event) => {
                  manifestText = (event.currentTarget as HTMLTextAreaElement)
                    .value;
                })]}
              >
              </textarea>
              <div class="card-actions">
                <button
                  type="button"
                  class="btn btn-outline btn-sm"
                  disabled={busy}
                  mix={[on("click", onRegisterPasteClick)]}
                >
                  登録する
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    };
  },
);
