/**
 * Render helpers for shell + frame content.
 *
 * `renderPage(context, fragment)` emits just the fragment when the request
 * carries the `rmx-frame: 1` header (set by both `resolveFrame` below and the
 * client-side `run()`), and the full {@link Document} shell otherwise, with the
 * current URL as the initial frame src. The shell's server-side `resolveFrame`
 * dispatches back into the same router to fetch that fragment.
 */

import type { RequestContext, Router } from "@remix-run/fetch-router";
import { createHtmlResponse } from "@remix-run/response/html";
import type { RemixNode } from "@remix-run/ui";
import { renderToStream } from "@remix-run/ui/server";

import { Document } from "../ui/document.tsx";
import { absoluteUrl, type PageMeta } from "../ui/page_meta.ts";

/**
 * Request headers the hub invented, not `@remix-run/ui`'s DOM attributes.
 *
 * `ui@0.8.0` renamed every `rmx-*` attribute to `data-rmx-*`; these two are
 * HTTP header names both ends of this app agree on, and renaming them would
 * only make this router stop recognizing its own requests.
 */
export const FRAME_HEADER = "rmx-frame";
export const TARGET_HEADER = "rmx-target";

export const isFrameRequest = (request: Request): boolean =>
  request.headers.get(FRAME_HEADER) === "1";

export function renderFragment(body: RemixNode, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "text/html; charset=utf-8");
  }
  return new Response(renderToStream(body), { ...init, headers });
}

/**
 * Render a page, as a fragment or as the whole document.
 *
 * `meta` reaches the shell's head, which is what a crawler sees when the URL
 * is posted somewhere. It is ignored on a frame request, where there is no
 * head to put it in — the browser is swapping the content of a document it
 * already has.
 *
 * The fragment is discarded on a full page load: the shell re-enters the
 * router to fetch it. So a controller runs twice for one document, which is
 * also why `meta` is passed here rather than derived by digging through the
 * rendered tree.
 */
export function renderPage(
  context: RequestContext,
  fragment: RemixNode,
  meta?: PageMeta,
): Response {
  if (isFrameRequest(context.request)) {
    return renderFragment(fragment);
  }
  return renderShell(context, meta);
}

export function renderShell(
  context: RequestContext,
  meta?: PageMeta,
): Response {
  const { request, router } = context;
  const url = new URL(request.url);
  const initialSrc = url.pathname + url.search;
  // Built from the hub's own origin rather than the request's: behind a proxy
  // the incoming host can be an internal name, and a canonical URL pointing at
  // one is worse than none.
  const canonical = absoluteUrl(initialSrc) ?? request.url;

  const stream = renderToStream(
    <Document initialSrc={initialSrc} canonical={canonical} meta={meta} />,
    {
      frameSrc: request.url,
      resolveFrame: (src, target, frameContext) =>
        resolveFrameViaRouter(router, request, src, target, frameContext),
    },
  );
  return createHtmlResponse(stream);
}

async function resolveFrameViaRouter(
  router: Router,
  request: Request,
  src: string,
  target?: string,
  frameContext?: { currentFrameSrc?: string },
) {
  const base = frameContext?.currentFrameSrc ?? request.url;
  const url = new URL(src, base);

  const headers = new Headers({
    accept: "text/html",
    [FRAME_HEADER]: "1",
  });
  if (target) headers.set(TARGET_HEADER, target);

  const response = await router.fetch(
    new Request(url, { method: "GET", headers, signal: request.signal }),
  );
  return response.body!;
}
