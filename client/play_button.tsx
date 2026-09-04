/**
 * PlayButton — 遊ぶ, as a `clientEntry`.
 *
 * Launching a game means minting a launch token, and that needs a DPoP proof
 * the server-rendered page cannot carry. So the token is minted as soon as the
 * session answers, and the button is a **plain link** to the game with the
 * token already in its fragment.
 *
 * It used to be a button that minted on click and then called `window.open`.
 * That cannot work: `window.open` is only allowed inside the click's own task,
 * and the token arrives a fetch later. Safari blocks the call — visibly on the
 * desktop, silently on iPhone — so the button did nothing at all. Chrome was
 * merely lenient, which is why it looked fine.
 *
 * Being a real `<a href>` fixes more than the popup blocker. Long-press,
 * middle-click and ⌘-click work because the browser owns the navigation, and a
 * hub added to the home screen stays in its own window instead of throwing the
 * player out into the browser.
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

import { mountSession, sessionStore } from "./session.ts";

export interface PlayButtonProps {
  gameId: string;
  /** Where the game lives, for the signed-out path. */
  gameUrl: string;
  [key: string]: SerializableValue;
}

export const PlayButton = clientEntry(
  "/play_button.js#PlayButton",
  function PlayButton(handle: Handle<PlayButtonProps>) {
    /** The game URL carrying a launch token, once the hub has minted one. */
    let launchUrl: string | null = null;
    let minting = false;
    let error: string | null = null;
    /** Whose session the token was minted for, so a re-render does not re-ask. */
    let mintedFor: string | null = null;
    /**
     * False until the session has answered and the first mint has run.
     *
     * The server always renders this state, and so must the browser's first
     * paint — otherwise a frame navigation, which mounts this into a page
     * whose session settled long ago, renders 遊ぶ against a server that wrote
     * 準備中…. That is not only a hydration warning: the link would be live
     * for a moment with no token on it, and a play started in that moment is
     * recorded nowhere.
     */
    let settled = false;

    /** Mint once per signed-in identity, and drop the token on sign-out. */
    const mint = async () => {
      const { fetchDpop, userId } = sessionStore;
      if (!userId || !fetchDpop) {
        mintedFor = null;
        launchUrl = null;
        return handle.update();
      }
      if (mintedFor === userId) return;
      mintedFor = userId;

      minting = true;
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
        launchUrl = body.url;
      } catch (cause) {
        // The link stays, pointing at the game itself: the player asked to
        // play, and the game can still fall back to a claim URL.
        error = `起動トークンを取れませんでした(${
          (cause as Error).message
        })。トークンなしで開きます。`;
        mintedFor = null;
      } finally {
        minting = false;
        handle.update();
      }
    };

    // Settling waits for the token as well as the session, so this button
    // keeps its own flag rather than rendering from `session.ready`.
    mountSession(handle, async () => {
      await mint();
      settled = true;
      handle.update();
    });

    return () => {
      // Signed out only once this button has settled. Before that it is
      // unknown, and the label must not flip from one to the other under a
      // finger already on its way down.
      const signedOut = settled && !sessionStore.userId;
      // No href until the answer is in. A link that works too early is a game
      // played without a token, and nothing to show for it afterwards.
      const pending = !settled || minting;

      if (signedOut) {
        return (
          <>
            <button
              type="button"
              class="btn btn-primary"
              mix={[on(
                "click",
                () => sessionStore.signIn(globalThis.location.pathname),
              )]}
            >
              サインインしてプレイ
            </button>
            <p class="text-sm opacity-70">
              実績を記録するにはサインインが要ります。{" "}
              <a class="link" href={handle.props.gameUrl}>
                サインインせずに遊ぶ
              </a>
            </p>
          </>
        );
      }

      return (
        <>
          <a
            class={`btn btn-primary${pending ? " btn-disabled" : ""}`}
            href={pending ? undefined : (launchUrl ?? handle.props.gameUrl)}
            aria-disabled={pending ? "true" : undefined}
          >
            {pending ? "準備中…" : "遊ぶ"}
          </a>
          {error ? <p class="text-warning text-sm">{error}</p> : null}
        </>
      );
    };
  },
);
