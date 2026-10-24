/**
 * FeedbackForm — a bug report or request about one game, sent to id.kbn.one,
 * as a `clientEntry`.
 *
 * `POST {IdP}/feedback` with the player's own DPoP session, the same way the
 * hub registers push subscriptions. The body is only what the player chose and
 * wrote, plus the game's page on the hub: the IdP records who sent it and from
 * which RP by itself, and refuses to take either from the body.
 *
 * The text box is uncontrolled and read on input, like the paste box on /dev:
 * binding `value` to state makes the runtime revert the keystroke.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { IDP_ORIGIN } from "./idp.ts";
import { mountSession, sessionStore } from "./session.ts";

export interface FeedbackFormProps {
  gameTitle: string;
  /** The game's page on the hub, for the way back. */
  gameHref: string;
  /** The same page, absolute: what the owner reads the report by. */
  pageUrl: string;
  [key: string]: SerializableValue;
}

type Kind = "bug" | "request" | "other";

const KINDS: ReadonlyArray<readonly [Kind, string]> = [
  ["bug", "不具合"],
  ["request", "要望"],
  ["other", "その他"],
];

/** What the IdP accepts in one report. */
const MAX_LENGTH = 4000;

type Status =
  | { kind: "editing" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "failed"; message: string };

export const FeedbackForm = clientEntry(
  "/feedback_form.js#FeedbackForm",
  function FeedbackForm(handle: Handle<FeedbackFormProps>) {
    let kind: Kind = "bug";
    let message = "";
    let status: Status = { kind: "editing" };

    // Nothing to load: the form only needs to know whether anyone is signed
    // in, and mountSession re-renders when that is known.
    const session = mountSession(handle, () => handle.update());

    const send = async () => {
      const text = message.trim();
      const fetchDpop = sessionStore.fetchDpop;
      if (!text || !fetchDpop || status.kind === "sending") return;
      status = { kind: "sending" };
      handle.update();
      try {
        const response = await fetchDpop(`${IDP_ORIGIN}/feedback`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind,
            message: text,
            pageUrl: handle.props.pageUrl,
          }),
        });
        status = response.ok
          ? { kind: "sent" }
          : { kind: "failed", message: failure(response.status) };
      } catch {
        status = { kind: "failed", message: failure(0) };
      }
      handle.update();
    };

    const onSignInClick = () =>
      sessionStore.signIn(globalThis.location.pathname);

    return () => {
      if (!session.ready) return <p class="opacity-70">確認中…</p>;
      if (!sessionStore.userId) {
        return (
          <div class="space-y-3">
            <p>送るにはサインインが要ります。誰からの報告かを残すためです。</p>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              mix={[on("click", onSignInClick)]}
            >
              id.kbn.one でサインイン
            </button>
          </div>
        );
      }
      if (status.kind === "sent") {
        return (
          <div class="space-y-3">
            <div role="status" class="alert alert-success">
              送りました。ありがとうございます。
            </div>
            <a
              class="link"
              href={handle.props.gameHref}
              data-rmx-target="content"
            >
              {handle.props.gameTitle} に戻る
            </a>
          </div>
        );
      }

      const sending = status.kind === "sending";
      return (
        <div class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <div role="group" aria-label="種類" class="join">
              {KINDS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  class={kind === value
                    ? "btn btn-sm join-item btn-active"
                    : "btn btn-sm join-item"}
                  aria-pressed={kind === value ? "true" : "false"}
                  mix={[on("click", () => {
                    kind = value;
                    handle.update();
                  })]}
                >
                  {label}
                </button>
              ))}
            </div>
            <label class="space-y-2">
              <span class="block text-sm font-bold">内容</span>
              <textarea
                class="textarea textarea-bordered h-40 w-full"
                maxlength={MAX_LENGTH}
                placeholder="どの画面で、何をしたら、どうなったか"
                mix={[on("input", (event) => {
                  message = (event.currentTarget as HTMLTextAreaElement).value;
                })]}
              >
              </textarea>
            </label>
            {status.kind === "failed"
              ? (
                <div role="alert" class="alert alert-error">
                  {status.message}
                </div>
              )
              : null}
            <div class="card-actions items-center justify-between">
              <span class="text-sm opacity-70">
                送信者はあなたのアカウントとして記録されます
              </span>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                disabled={sending}
                mix={[on("click", () => void send())]}
              >
                {sending
                  ? <span class="loading loading-spinner loading-xs"></span>
                  : "送る"}
              </button>
            </div>
          </div>
        </div>
      );
    };
  },
);

/** What to tell the player, by the IdP's answer. */
function failure(status: number): string {
  switch (status) {
    case 400:
      return "内容を送れませんでした。空でないか、長すぎないかを確かめてください。";
    case 401:
      return "サインインが切れています。ページを読み込み直してください。";
    case 429:
      return "送れるのは 1 時間に 5 件までです。少し時間をおいてください。";
    default:
      return "送れませんでした。時間をおいてもう一度試してください。";
  }
}
