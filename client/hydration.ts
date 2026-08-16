/**
 * Client runtime boot for the shell + frame navigation.
 *
 * Bundled into `bundled/mod.js` (via ./mod.ts) and loaded by every shell
 * response as `<script type="module" src="/mod.js">`.
 *
 * `run()` walks the document, hydrates every `clientEntry` marker emitted by
 * `renderToStream`, and wires the `<Frame name="content">` region so clicks on
 * `<a rmx-target="content">` swap the frame instead of navigating.
 */

import { run } from "@remix-run/ui";

import { resolveFrame } from "./frame.ts";

const app = run({
  async loadModule(moduleUrl: string, exportName: string) {
    const mod = await import(moduleUrl);
    return mod[exportName];
  },
  resolveFrame,
});

await app.ready();
