/**
 * PlayButton — 遊ぶ, as a `clientEntry`.
 *
 * Launching a game means minting a launch token, and that needs a DPoP proof
 * the server-rendered page cannot carry. So the button asks the hub for the
 * URL at click time and then navigates to it.
 *
 * A signed-out visitor still gets to play: the plain game URL works, they just
 * arrive without a token and the game falls back to claim URLs. That is the
 * whole point of the graded design — going through the hub is better, going
 * around it is not broken.
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

    const onPlayClick = async () => {
      const { fetchDpop, userId } = sessionStore;
      if (!userId || !fetchDpop) {
        globalThis.open(handle.props.gameUrl, "_blank", "noopener");
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
        globalThis.open(handle.props.gameUrl, "_blank", "noopener");
      } finally {
        busy = false;
        handle.update();
      }
    };

    return () => (
      <>
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy}
          mix={[on("click", onPlayClick)]}
        >
          遊ぶ
        </button>
        {!sessionStore.ready || sessionStore.userId
          ? null
          : (
            <p class="text-sm opacity-70">
              サインインすると、実績がこのアカウントに記録されます。
            </p>
          )}
        {error ? <p class="text-warning text-sm">{error}</p> : null}
      </>
    );
  },
);
