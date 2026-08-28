/**
 * PlayButton — 遊ぶ, as a `clientEntry`.
 *
 * Launching a game means minting a launch token, and that needs a DPoP proof
 * the server-rendered page cannot carry. So the button asks the hub for the
 * URL at click time and then navigates to it.
 *
 * A signed-out visitor is offered sign-in instead, because the button's promise
 * is that playing records something and without an account there is nothing to
 * record it against. They are not shut out: the plain game URL still works and
 * the game falls back to claim URLs, so the smaller link below opens it as-is.
 * That is the graded design — going through the hub is better, going around it
 * is not broken.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { sessionStore } from "./session.ts";

export interface PlayButtonProps {
  gameId: string;
  /** Where the game lives, for the signed-out path. */
  gameUrl: string;
  [key: string]: SerializableValue;
}

export const PlayButton = clientEntry(
  "/play_button.js#PlayButton",
  function PlayButton(handle: Handle<PlayButtonProps>) {
    let busy = false;
    let error: string | null = null;

    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => handle.update(), {
        signal: handle.signal,
      });
      void sessionStore.load();
    }

    /** Open the game with no token — the signed-out path, and the fallback. */
    const openPlain = () => {
      globalThis.open(handle.props.gameUrl, "_blank", "noopener");
    };

    const onPlayClick = async () => {
      const { fetchDpop, userId } = sessionStore;
      if (!userId || !fetchDpop) {
        openPlain();
        return;
      }

      busy = true;
      error = null;
      handle.update();
      try {
        const response = await fetchDpop("/api/internal/launch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ gameId: handle.props.gameId }),
        });
        const body = await response.json() as { url?: string; error?: string };
        if (!response.ok || !body.url) {
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        globalThis.open(body.url, "_blank", "noopener");
      } catch (cause) {
        // Falling back rather than failing: the player asked to play.
        error = `起動トークンを取れませんでした(${
          (cause as Error).message
        })。トークンなしで開きます。`;
        openPlain();
      } finally {
        busy = false;
        handle.update();
      }
    };

    return () => {
      // Signed out only once the session has actually answered. Before that it
      // is unknown, and the label must not flip from one to the other under a
      // finger already on its way down.
      const signedOut = sessionStore.ready && !sessionStore.userId;

      return (
        <>
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy || !sessionStore.ready}
            mix={[on(
              "click",
              () =>
                signedOut
                  ? sessionStore.signIn(globalThis.location.pathname)
                  : void onPlayClick(),
            )]}
          >
            {signedOut ? "サインインしてプレイ" : "遊ぶ"}
          </button>
          {signedOut
            ? (
              <p class="text-sm opacity-70">
                実績を記録するにはサインインが要ります。{" "}
                <button
                  type="button"
                  class="link"
                  mix={[on("click", openPlain)]}
                >
                  サインインせずに遊ぶ
                </button>
              </p>
            )
            : null}
          {error ? <p class="text-warning text-sm">{error}</p> : null}
        </>
      );
    };
  },
);
