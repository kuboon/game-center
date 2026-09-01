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

/** Fetch options a frame load turns into, split out so tests can assert them. */
export function frameRequestInit(options?: ResolveFrameOptions): RequestInit {
  const headers = new Headers({
    accept: "text/html",
    [FRAME_HEADER]: "1",
  });
  if (options?.target) headers.set(TARGET_HEADER, options.target);
  return { headers, signal: options?.signal };
}

/**
 * Loads frame content from this origin, tagging the request so the router
 * returns the bare fragment instead of the full shell.
 */
export async function resolveFrame(
  src: string,
  options?: ResolveFrameOptions,
): Promise<ReadableStream<Uint8Array> | string> {
  const response = await fetch(src, frameRequestInit(options));
  return response.body ?? (await response.text());
}
