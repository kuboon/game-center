/**
 * DevConsole — the /dev dashboard, as a `clientEntry`.
 *
 * Everything here needs a DPoP proof, which a server-rendered document cannot
 * carry, so the whole panel is filled in by the browser after hydration.
 *
 * Two ways to register, and the difference is worth showing rather than
 * hiding. Registering a URL is what a game should normally do — the hub reads
 * the manifest from the game's own page, so the game owns itself and nothing
 * here has to be kept in sync. Pasting is for a game the hub cannot fetch,
 * such as a Claude Artifact, whose public URL serves a shell rather than the
 * author's HTML.
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
  manifestUrl: string | null;
  status: string;
  achievements: Achievement[];
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

const SAMPLE = `{
  "$schema": "https://ga-cen.kbn.one/schema/gamecenter.json",
  "id": "my-puzzle",
  "title": "My Puzzle",
  "url": "https://claude.ai/public/artifacts/…",
  "achievements": [
    { "key": "first_clear", "title": "はじめてのクリア", "points": 10 }
  ]
}`;

export const DevConsole = clientEntry(
  "/dev_console.js#DevConsole",
  function DevConsole(handle: Handle<DevConsoleProps>) {
    let games: Game[] = [];
    let loaded = false;
    let loadError: string | null = null;
    let outcome: Outcome | null = null;
    let busy = false;

    let gameUrl = "";
    let manifestText = "";

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
        const response = await api("/api/internal/games");
        if (!response.ok) throw new Error(await messageOf(response));
        games = ((await response.json()) as { games: Game[] }).games;
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
      if (!sessionStore.ready || (sessionStore.userId && !loaded)) {
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
                          実績 {game.achievements.length} 件
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              <p class="text-sm opacity-70">
                ここに出るのは、このアカウントが貼り付けで登録したゲームです。
                URL 登録したゲームは URL の管理権が所有権なので、アカウントには
                紐づきません。
              </p>
            </div>
          </div>

          <div class="card card-border bg-base-100">
            <div class="card-body">
              <h2 class="card-title">貼り付けて登録</h2>
              <p class="text-sm opacity-70">
                ハブが fetch できない場所のゲーム向けです。Claude Artifacts
                は公開 URL を開いても著者の HTML ではなく殻が返るので、こちらを
                使います。この場合は <code>url</code> が必須です。
              </p>
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
