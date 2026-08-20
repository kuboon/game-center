/**
 * DevConsole — the /dev dashboard, as a `clientEntry`.
 *
 * Everything here needs a DPoP proof, which a server-rendered document cannot
 * carry, so the whole panel is filled in by the browser after hydration. It
 * talks to `/api/internal`, the same surface with the same session as the rest
 * of the hub; the API tokens it issues are for CI, which has no session.
 *
 * A token's plaintext exists only in the response that created it, so it is
 * held in memory and shown until the page is left. Nothing re-fetches it.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { sessionStore } from "./session.ts";

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
  id: string;
  title: string;
  url: string;
  status: string;
  achievements: Achievement[];
}

interface ApiToken {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ManifestIssue {
  path: string;
  message: string;
}

/** What the last manifest submission did, shown above the form. */
interface Outcome {
  readonly ok: boolean;
  readonly text: string;
  /** Present when the manifest was rejected field by field. */
  readonly issues?: readonly ManifestIssue[];
}

const SAMPLE = `{
  "$schema": "/schema/gamecenter.json",
  "id": "my-puzzle",
  "title": "My Puzzle",
  "url": "https://example.github.io/my-puzzle/",
  "achievements": [
    { "key": "first_clear", "title": "はじめてのクリア", "points": 10 }
  ]
}`;

export const DevConsole = clientEntry(
  "/dev_console.js#DevConsole",
  function DevConsole(handle: Handle<DevConsoleProps>) {
    let games: Game[] = [];
    let tokens: ApiToken[] = [];
    let loaded = false;
    let loadError: string | null = null;
    let outcome: Outcome | null = null;
    let busy = false;
    /** Shown once, then gone: the hub never returns it again. */
    let freshToken: string | null = null;

    let manifestText = "";
    let tokenName = "";

    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => {
        void refresh();
      }, { signal: handle.signal });
      void sessionStore.load().then(refresh);
    }

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
        loaded = sessionStore.ready;
        handle.update();
        return;
      }
      try {
        const [gamesResponse, tokensResponse] = await Promise.all([
          api("/api/internal/games"),
          api("/api/internal/tokens"),
        ]);
        if (!gamesResponse.ok || !tokensResponse.ok) {
          const failed = gamesResponse.ok ? tokensResponse : gamesResponse;
          throw new Error(await messageOf(failed));
        }
        games = ((await gamesResponse.json()) as { games: Game[] }).games;
        tokens = ((await tokensResponse.json()) as { tokens: ApiToken[] })
          .tokens;
        loadError = null;
      } catch (cause) {
        loadError = (cause as Error).message;
      } finally {
        loaded = true;
        handle.update();
      }
    }

    const onSignInClick = () => sessionStore.signIn(handle.props.returnTo);

    const onRegisterClick = async () => {
      busy = true;
      outcome = null;
      handle.update();
      try {
        let manifest: unknown;
        try {
          manifest = JSON.parse(manifestText);
        } catch (cause) {
          throw new Error(`JSON として読めません: ${(cause as Error).message}`);
        }
        const response = await api("/api/internal/games", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(manifest),
        });
        const body = await response.json() as {
          error?: string;
          issues?: ManifestIssue[];
          game?: Game;
          created?: boolean;
          retired?: string[];
        };
        if (!response.ok) {
          outcome = {
            ok: false,
            text: body.error ?? `HTTP ${response.status}`,
            issues: body.issues,
          };
        } else {
          const retired = body.retired?.length
            ? `、${body.retired.length} 件の実績を retire しました`
            : "";
          outcome = {
            ok: true,
            text: `${body.game?.title} を${
              body.created ? "登録" : "更新"
            }しました${retired}`,
          };
          await refresh();
        }
      } catch (cause) {
        outcome = { ok: false, text: (cause as Error).message };
      } finally {
        busy = false;
        handle.update();
      }
    };

    const onIssueTokenClick = async () => {
      if (!tokenName.trim()) return;
      busy = true;
      handle.update();
      try {
        const response = await api("/api/internal/tokens", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: tokenName.trim() }),
        });
        if (!response.ok) throw new Error(await messageOf(response));
        freshToken = ((await response.json()) as { token: string }).token;
        await refresh();
      } catch (cause) {
        loadError = (cause as Error).message;
      } finally {
        busy = false;
        handle.update();
      }
    };

    const revoke = async (id: number) => {
      busy = true;
      handle.update();
      try {
        const response = await api(`/api/internal/tokens/${id}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error(await messageOf(response));
        await refresh();
      } catch (cause) {
        loadError = (cause as Error).message;
      } finally {
        busy = false;
        handle.update();
      }
    };

    return () => {
      if (!sessionStore.ready || (sessionStore.userId && !loaded)) {
        return <p>読み込み中…</p>;
      }
      if (!sessionStore.userId) {
        return (
          <div class="card card-border bg-base-100">
            <div class="card-body">
              <h2 class="card-title">サインインが必要です</h2>
              <p>ゲームの登録と API トークンの発行にはアカウントが要ります。</p>
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

          <div class="card card-border bg-base-100">
            <div class="card-body">
              <h2 class="card-title">登録したゲーム</h2>
              {games.length === 0
                ? <p>まだありません。下のフォームから登録します。</p>
                : (
                  <ul class="space-y-3">
                    {games.map((game) => (
                      <li key={game.id} class="border-base-300 border-t pt-3">
                        <div class="flex items-baseline gap-2">
                          <span class="font-bold">{game.title}</span>
                          <code class="text-sm opacity-70">{game.id}</code>
                          {game.status === "hidden"
                            ? (
                              <span class="badge badge-ghost badge-sm">
                                非公開
                              </span>
                            )
                            : null}
                        </div>
                        <a
                          class="link text-sm break-all"
                          href={game.url}
                          rel="noreferrer"
                        >
                          {game.url}
                        </a>
                        <p class="text-sm opacity-70">
                          実績 {game.achievements.length} 件
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          </div>

          <div class="card card-border bg-base-100">
            <div class="card-body">
              <h2 class="card-title">gamecenter.json を登録</h2>
              <p class="text-sm opacity-70">
                同じ内容を何度送っても結果は同じです。 初回の登録で{" "}
                <code>id</code>{" "}
                の所有者が決まり、以後はその所有者だけが書き換えられます。
              </p>
              {outcome
                ? (
                  <div
                    class={outcome.ok
                      ? "alert alert-success"
                      : "alert alert-error"}
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
              <textarea
                class="textarea textarea-bordered h-64 w-full font-mono text-sm"
                placeholder={SAMPLE}
                mix={[on("input", (event) => {
                  manifestText = (event.currentTarget as HTMLTextAreaElement)
                    .value;
                })]}
              >
              </textarea>
              <div class="card-actions">
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  disabled={busy}
                  mix={[on("click", onRegisterClick)]}
                >
                  登録する
                </button>
              </div>
            </div>
          </div>

          <div class="card card-border bg-base-100">
            <div class="card-body">
              <h2 class="card-title">API トークン</h2>
              <p class="text-sm opacity-70">
                GitHub Action がゲームを登録するのに使います。 リポジトリの
                Secrets に入れてください。
              </p>
              {freshToken
                ? (
                  <div class="alert alert-warning">
                    <div>
                      <p>この画面を離れると二度と表示されません。</p>
                      <code class="break-all">{freshToken}</code>
                    </div>
                  </div>
                )
                : null}
              {tokens.length === 0
                ? <p>まだ発行していません。</p>
                : (
                  <ul class="space-y-2">
                    {tokens.map((token) => (
                      <li
                        key={token.id}
                        class="flex items-center justify-between gap-2 border-base-300 border-t pt-2"
                      >
                        <div>
                          <p class="font-bold">{token.name}</p>
                          <p class="text-sm opacity-70">
                            発行 {token.createdAt} / 最終使用{" "}
                            {token.lastUsedAt ?? "なし"}
                          </p>
                        </div>
                        <button
                          type="button"
                          class="btn btn-outline btn-error btn-xs"
                          disabled={busy}
                          mix={[on("click", () => revoke(token.id))]}
                        >
                          失効
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              <div class="flex gap-2">
                <input
                  type="text"
                  class="input input-bordered input-sm flex-1"
                  placeholder="owner/repo など、後で見て分かる名前"
                  mix={[on("input", (event) => {
                    tokenName = (event.currentTarget as HTMLInputElement).value;
                  })]}
                />
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  disabled={busy}
                  mix={[on("click", onIssueTokenClick)]}
                >
                  発行
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    };
  },
);
