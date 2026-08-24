/**
 * PlayFrame — the game in an iframe, and the thing that answers it.
 *
 * The SDK inside the frame posts `gc:unlock` to its parent. This listens, and
 * records the achievement with the player's own session, so the game never
 * holds a credential of any kind.
 *
 * **Every message is checked against the game's origin before anything else.**
 * `window.addEventListener("message")` hears from any frame and any window that
 * has a handle on this one, so without that check any page could unlock
 * anything. The origin comes from the registered game's URL, server-rendered
 * into this component, not from the message.
 */

import {
  clientEntry,
  type Handle,
  type SerializableValue,
} from "@remix-run/ui";

import { sessionStore } from "./session.ts";

export interface PlayFrameProps {
  /** `{author}/{slug}` — what the achievement is recorded against. */
  gameId: string;
  gameUrl: string;
  /** The only origin whose messages are acted on. */
  gameOrigin: string;
  [key: string]: SerializableValue;
}

interface UnlockMessage {
  type: string;
  id?: string;
  achievement?: string;
  score?: number;
}

export const PlayFrame = clientEntry(
  "/play_frame.js#PlayFrame",
  function PlayFrame(handle: Handle<PlayFrameProps>) {
    let recorded = 0;
    let note: string | null = null;

    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => handle.update(), {
        signal: handle.signal,
      });
      void sessionStore.load();
      globalThis.addEventListener("message", onMessage, {
        signal: handle.signal,
      });
    }

    async function onMessage(event: MessageEvent): Promise<void> {
      // The check that makes this safe. Anything else is not this game.
      if (event.origin !== handle.props.gameOrigin) return;

      const data = event.data as UnlockMessage | null;
      if (data?.type !== "gc:unlock" || typeof data.achievement !== "string") {
        return;
      }

      const ok = await record(data.achievement, data.score);
      // The SDK waits briefly for this and falls through to the REST API or a
      // claim URL when it does not come, so a refusal has to be answered too.
      (event.source as Window | null)?.postMessage(
        { type: "gc:unlocked", id: data.id, ok },
        event.origin,
      );
    }

    async function record(key: string, score?: number): Promise<boolean> {
      const fetchDpop = sessionStore.fetchDpop;
      if (!sessionStore.userId || !fetchDpop) {
        note = "サインインしていないので、実績は記録されません。";
        handle.update();
        return false;
      }
      try {
        const response = await fetchDpop("/api/internal/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            gameId: handle.props.gameId,
            key,
            via: "postmessage",
            ...(typeof score === "number" ? { score } : {}),
          }),
        });
        if (!response.ok) {
          const body = await response.json() as { error?: string };
          note = body.error ?? `HTTP ${response.status}`;
          handle.update();
          return false;
        }
        recorded++;
        note = null;
        handle.update();
        return true;
      } catch (cause) {
        note = (cause as Error).message;
        handle.update();
        return false;
      }
    }

    return () => (
      <div class="space-y-2">
        {!sessionStore.ready || sessionStore.userId
          ? null
          : (
            <div class="alert alert-warning">
              サインインすると、このゲームの実績が記録されます。
            </div>
          )}
        {note ? <div class="alert alert-error">{note}</div> : null}
        {recorded > 0
          ? (
            <div class="alert alert-success">
              実績を {recorded} 件記録しました。
            </div>
          )
          : null}
        <iframe
          src={handle.props.gameUrl}
          title="game"
          class="border-base-300 aspect-video w-full rounded-box border"
          allow="autoplay; fullscreen; gamepad"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        >
        </iframe>
        <p class="text-sm opacity-70">
          埋め込みを許可していないゲームは、ここでは表示されません。
          上の「別のタブで開く」 からどうぞ。実績は claim リンクで記録できます。
        </p>
      </div>
    );
  },
);
