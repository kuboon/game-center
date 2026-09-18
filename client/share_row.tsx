/**
 * ShareRow — the share buttons, as a `clientEntry`.
 *
 * The pages people are meant to post somewhere are the profile and the game
 * page, and posting one used to mean copying the address bar. This is the row
 * of buttons that does it: X, LINE, Threads, and either the platform's own
 * share sheet or a copy-to-clipboard button, from `@kuboon/share-element`.
 *
 * It is one tag. The names on the buttons come from the page's language — the
 * shell says `<html lang="ja">` — and their colour from `currentColor`, so
 * there is nothing here to set and nothing to keep in step with the theme.
 * (`@kuboon/share-element@0.6`: before it, both had to be written out, which
 * is what this file used to be.)
 *
 * It stays a `clientEntry` because that is how a page here asks for browser
 * code: the marker is what fetches the module that defines the element.
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

import { clientEntry } from "@remix-run/ui";

// Registers `<share-buttons>` where there is a DOM, and does nothing on the
// server, so this import is safe in a module the SSR render also evaluates.
import "@kuboon/share-element";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      /** Only what this file writes. The element's own API is `url` / `show` / `labels`. */
      "share-buttons": {
        "data-rmx-preserve-dom"?: boolean;
      };
    }
  }
}

export const ShareRow = clientEntry("/share_row.js#ShareRow", function () {
  return () => <share-buttons data-rmx-preserve-dom />;
});
