/**
 * Client runtime boot for the shell + frame navigation.
 *
 * Bundled into `bundled/mod.js` (via ./mod.ts) and loaded by every shell
 * response as `<script type="module" src="/mod.js">`.
 *
 * `run()` walks the document, hydrates every `clientEntry` marker emitted by
 * `renderToStream`, and wires the `<Frame name="content">` region so clicks on
 * `<a data-rmx-target="content">` swap the frame instead of navigating.
 */

import { run } from "@remix-run/ui";

import { resolveFrame } from "./frame.ts";

/**
 * Register the service worker.
 *
 * It caches nothing — see `server/controllers/pwa.ts`. It exists so browsers
 * treat the hub as installable, which on iOS is the precondition for Web Push.
 *
 * Failures are swallowed: an unsupported or blocked worker costs the install
 * prompt, not the page.
 */
if ("serviceWorker" in navigator) {
  globalThis.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

const app = run({
  async loadModule(moduleUrl: string, exportName: string) {
    const mod = await import(moduleUrl);
    return mod[exportName];
  },
  resolveFrame,
});

await app.ready();
