/**
 * HandleCard — choosing the name your games will claim you by.
 *
 * A manifest names its author by handle, so this is the other end of that
 * pairing: until a player has one, no game can be attributed to them.
 *
 * Chosen once and not changed. It goes into `gamecenter.json` files the hub
 * does not control, and into author pages people link to, so renaming would
 * silently break every manifest still naming the old one. The form says so
 * before the button, rather than after.
 */

import { clientEntry, type Handle, on } from "@remix-run/ui";

import { sessionStore } from "./session.ts";

export const HandleCard = clientEntry(
  "/handle_card.js#HandleCard",
  function HandleCard(handle: Handle) {
    let myHandle: string | null = null;
    let loaded = false;
    let busy = false;
    let error: string | null = null;
    let wanted = "";

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
        const response = await fetchDpop("/api/internal/games");
        if (response.ok) {
          myHandle =
            ((await response.json()) as { handle: string | null }).handle;
        }
      } catch {
        // Leave it unknown rather than telling them they have none.
      } finally {
        loaded = true;
        handle.update();
      }
    }

    const onClaimClick = async () => {
      const fetchDpop = sessionStore.fetchDpop;
      if (!fetchDpop || !wanted.trim()) return;

      busy = true;
      error = null;
      handle.update();
      try {
        const response = await fetchDpop("/api/internal/handle", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handle: wanted.trim().toLowerCase() }),
        });
        const body = await response.json() as {
          handle?: string;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        myHandle = body.handle ?? null;
      } catch (cause) {
        error = (cause as Error).message;
      } finally {
        busy = false;
        handle.update();
      }
    };

    return () => {
      if (!sessionStore.ready || !sessionStore.userId) return null;
      if (!loaded) return <p>読み込み中…</p>;

      if (myHandle) {
        return (
          <div class="card card-border bg-base-100">
            <div class="card-body">
              <h2 class="card-title">ハンドル</h2>
              <p>
                <code>@{myHandle}</code> です。ゲームの{" "}
                <code>gamecenter.json</code> に{" "}
                <code>"author": "{myHandle}"</code>{" "}
                と書くと、そのゲームがあなたのものとして登録できます。
              </p>
              <div class="card-actions">
                <a
                  class="btn btn-outline btn-sm"
                  href={`/@${myHandle}`}
                  rmx-target="content"
                >
                  作者ページを見る
                </a>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div class="card card-border bg-base-100">
          <div class="card-body">
            <h2 class="card-title">ハンドルを決める</h2>
            <p>
              ゲームを公開するには、まずハンドルが要ります。 マニフェストの{" "}
              <code>author</code>{" "}
              にこの名前を書くことで、そのゲームがあなたのものだと分かります。
            </p>
            <p class="text-warning text-sm">
              一度決めると変更できません。
              ハンドルは公開されるファイルの中に書かれ、 あなたの作者ページの
              URL にもなるためです。
            </p>
            {error ? <div class="alert alert-error">{error}</div> : null}
            <div class="flex items-center gap-2">
              <span class="opacity-70">@</span>
              <input
                type="text"
                class="input input-bordered input-sm flex-1"
                placeholder="kuboon"
                mix={[on("input", (event) => {
                  wanted = (event.currentTarget as HTMLInputElement).value;
                })]}
              />
              <button
                type="button"
                class="btn btn-primary btn-sm"
                disabled={busy}
                mix={[on("click", onClaimClick)]}
              >
                決定
              </button>
            </div>
            <p class="text-sm opacity-70">
              英小文字・数字・ハイフンで3〜32文字。
            </p>
          </div>
        </div>
      );
    };
  },
);
