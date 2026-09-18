/**
 * ShareRow — the share buttons, as a `clientEntry`.
 *
 * The pages people are meant to post somewhere are the profile and the game
 * page, and until now posting one meant copying the address bar. This is the
 * row of buttons that does it: X, LINE, Threads, and either the platform's
 * own share sheet or a copy-to-clipboard button, from
 * `@kuboon/share-element`.
 *
 * **The row is built from script rather than written as a tag** so the
 * Japanese labels can be set on it. They are the tooltip and the accessible
 * name of each icon-only button, and they are a property on the element, not
 * an attribute — a page that only writes `<share-buttons>` in its markup
 * cannot reach them.
 *
 * `data-rmx-preserve-dom` keeps the reconciler out of the subtree. The buttons
 * are the element's own children, not this component's, and a frame reload
 * that diffed an empty vtree against them would sweep them away — the custom
 * element would not rebuild, because its element never left the document.
 *
 * Nothing here says which URL to share. The element reads `location.href` at
 * the moment of the click, so a row that survives a frame navigation still
 * shares the page the reader is actually looking at.
 */

import { clientEntry, ref } from "@remix-run/ui";

import { createShareButtons } from "@kuboon/share-element";

/**
 * What each button is called, in Japanese.
 *
 * Only the ones that are words: X, LINE and Threads are names, and a name is
 * the same in every language.
 */
const LABELS = {
  share: "共有",
  copy: "URL をコピー",
  copied: "コピーしました",
  copyFailed: "コピーできませんでした",
};

export const ShareRow = clientEntry(
  "/share_row.js#ShareRow",
  function ShareRow() {
    const mount = (node: Element) => {
      // Hydration and every later insert land here. A preserved subtree already
      // holds its row, and appending a second one would be two of everything.
      if (node.firstElementChild) return;
      const row = createShareButtons();
      row.labels = LABELS;
      node.append(row);
    };

    return () => (
      <div class="flex items-center" data-rmx-preserve-dom mix={[ref(mount)]} />
    );
  },
);
