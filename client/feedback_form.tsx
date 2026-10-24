/**
 * FeedbackForm — a bug report or request for a game's author, as a
 * `clientEntry`.
 *
 * Posts to `/api/internal/games/@{handle}/{slug}/feedback` with the player's
 * DPoP session, which is also what puts their name on it. The author reads it
 * on `/dev`.
 *
 * The link may carry a draft in its fragment (`#kind=bug&message=…`, see
 * `feedback_draft.ts`): the type comes chosen and the text box filled, and the
 * player still reads it and presses the button. The fragment is read before
 * the form first draws, which is after the session answers, so there is no
 * server markup for it to disagree with.
 *
 * The text box is uncontrolled and read on input, like the paste box on /dev:
 * binding `value` to state makes the runtime revert the keystroke.
 *
 * The draft goes in through `ref`, as the element's live value, and **not**
 * through `defaultValue`. On a `<textarea>`, `defaultValue` is the element's
 * text content, and `@remix-run/ui@0.8` reconciles that content against the
 * vtree's children — which for a textarea are always none. So the first
 * re-render after the form appears deletes the draft, and something always
 * re-renders: the session settling is enough. The draft showed for a moment
 * and vanished. A value set on the element is the "dirty" value, which no
 * change to the default touches.
 */

import {
  clientEntry,
  type Handle,
  on,
  ref,
  type SerializableValue,
} from "@remix-run/ui";

import {
  type FeedbackKind,
  parseFeedbackDraft,
  rememberFeedbackDraft,
  takeFeedbackDraft,
} from "./feedback_draft.ts";
import { mountSession, sessionStore } from "./session.ts";

export interface FeedbackFormProps {
  /** Author handle and slug, to address the endpoint. */
  handle: string;
  slug: string;
  gameTitle: string;
  /** The game's page on the hub, for the way back. */
  gameHref: string;
  [key: string]: SerializableValue;
}

type Kind = FeedbackKind;

const KINDS: ReadonlyArray<readonly [Kind, string]> = [
  ["bug", "不具合"],
  ["request", "要望"],
  ["other", "その他"],
];

/** What the hub accepts in one report. Mirrors `MAX_FEEDBACK_LENGTH`. */
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

    if (typeof document !== "undefined") {
      // The fragment first, then whatever was stashed before signing in. The
      // stash is taken either way so it cannot surface on a later visit.
      const gameId = `${handle.props.handle}/${handle.props.slug}`;
      const stashed = takeFeedbackDraft(gameId);
      const fromLink = parseFeedbackDraft(globalThis.location.hash);
      const draft = fromLink.kind || fromLink.message
        ? fromLink
        : parseFeedbackDraft(stashed ?? "");
      kind = draft.kind ?? kind;
      message = draft.message ?? message;
    }

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
        const { handle: author, slug } = handle.props;
        const response = await fetchDpop(
          `/api/internal/games/@${encodeURIComponent(author)}/${
            encodeURIComponent(slug)
          }/feedback`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind, message: text }),
          },
        );
        status = response.ok
          ? { kind: "sent" }
          : { kind: "failed", message: failure(response.status) };
      } catch {
        status = { kind: "failed", message: failure(0) };
      }
      handle.update();
    };

    const onSignInClick = () => {
      rememberFeedbackDraft(
        `${handle.props.handle}/${handle.props.slug}`,
        globalThis.location.hash,
      );
      sessionStore.signIn(globalThis.location.pathname);
    };

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
              作者に届けました。ありがとうございます。
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
                mix={[
                  // `message`, not the draft: if the element is ever built
                  // again, what the player has typed so far comes with it.
                  ref((node) => {
                    (node as HTMLTextAreaElement).value = message;
                  }),
                  on("input", (event) => {
                    message = (event.currentTarget as HTMLTextAreaElement)
                      .value;
                  }),
                ]}
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
                作者にはあなたの表示名が伝わります
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

/** What to tell the player, by the hub's answer. */
function failure(status: number): string {
  switch (status) {
    case 400:
      return "内容を送れませんでした。空でないか、長すぎないかを確かめてください。";
    case 401:
      return "サインインが切れています。ページを読み込み直してください。";
    case 404:
      return "このゲームは今は受け付けていません。";
    case 429:
      return "送れるのは 1 時間に 5 件までです。少し時間をおいてください。";
    default:
      return "送れませんでした。時間をおいてもう一度試してください。";
  }
}
