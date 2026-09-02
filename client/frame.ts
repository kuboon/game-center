/**
 * Browser frame resolver for the shell's `<Frame name="content">` region.
 *
 * Kept out of ./hydration.ts — which calls `run()` at module scope — so the
 * resolver can be imported and asserted on without booting the runtime.
 */

import type { ResolveFrameOptions } from "@remix-run/ui";

/**
 * Request headers the hub invented, not `@remix-run/ui`'s DOM attributes.
 *
 * `ui@0.8.0` renamed every `rmx-*` attribute to `data-rmx-*`; these two are
 * HTTP header names both ends of this app agree on, and renaming them would
 * only make the server stop recognizing its own requests.
 */
export const FRAME_HEADER = "rmx-frame";
export const TARGET_HEADER = "rmx-target";

/**
 * Fetch options a frame load turns into, split out so tests can assert them.
 *
 * **Only a named frame asks for a fragment.** `target` is the reloading
 * frame's own name, and the top frame is the document itself, which has none
 * — so an absent `target` means "reload the whole page", and the answer to
 * that is the shell, not a fragment.
 *
 * Asking for a fragment there is what broke the browser's Back button. The
 * runtime seeds the first history entry with no target, so traversing back to
 * it reloads the top frame; the hub answered with a bare `<main>`, the runtime
 * had nothing it could diff a document against, and the URL changed while the
 * page did not.
 */
export function frameRequestInit(options?: ResolveFrameOptions): RequestInit {
  const headers = new Headers({ accept: "text/html" });
  if (options?.target) {
    headers.set(FRAME_HEADER, "1");
    headers.set(TARGET_HEADER, options.target);
  }
  return { headers, signal: options?.signal };
}

/** Loads frame content from this origin. */
export async function resolveFrame(
  src: string,
  options?: ResolveFrameOptions,
): Promise<ReadableStream<Uint8Array> | string> {
  const response = await fetch(src, frameRequestInit(options));
  return response.body ?? (await response.text());
}
