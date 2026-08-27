/**
 * Document — the persistent HTML shell (navbar + `<Frame name="content">`).
 *
 * Client-side, `run()` (bundled from client/mod.ts) hydrates every clientEntry
 * marker and turns clicks on `<a rmx-target="content">` into frame swaps
 * instead of full document navigations.
 *
 * The head is where a shared link becomes a card. The hub's main way of
 * reaching anyone is an author posting a profile or game URL somewhere, so
 * what a crawler finds here is the first thing most people read about
 * game-center. Pages supply their own {@link PageMeta}; the ones nobody shares
 * supply none and get the site's name.
 */

import { Frame, type Handle } from "@remix-run/ui";

import { NavAuth } from "../../client/nav_auth.tsx";
import { routes } from "../routes.ts";
import { type PageMeta, pageTitle, SITE_NAME } from "./page_meta.ts";

type DocumentProps = {
  initialSrc: string;
  /** Absolute URL of this page, for `og:url` and `rel=canonical`. */
  canonical: string;
  /** What this page says about itself when shared. */
  meta?: PageMeta;
};

export function Document(handle: Handle<DocumentProps>) {
  return () => {
    const { initialSrc, canonical, meta } = handle.props;
    const title = pageTitle(meta);
    const description = meta?.description;
    const image = meta?.image;

    return (
      <html lang="ja">
        <head>
          <meta charset="UTF-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />
          <title>{title}</title>
          {description
            ? <meta name="description" content={description} />
            : null}
          <link rel="canonical" href={canonical} />

          <meta property="og:site_name" content={SITE_NAME} />
          <meta property="og:type" content={meta?.type ?? "website"} />
          <meta property="og:title" content={title} />
          <meta property="og:url" content={canonical} />
          {description
            ? <meta property="og:description" content={description} />
            : null}
          {image ? <meta property="og:image" content={image} /> : null}
          {
            /* A large card is worth asking for only when there is a picture to
              put in it; without one it is an empty frame above the text. */
          }
          <meta
            name="twitter:card"
            content={image ? "summary_large_image" : "summary"}
          />

          <script async type="module" src="/mod.js"></script>
          <link rel="stylesheet" href="/style.css" />
        </head>
        <body class="min-h-screen bg-base-100 text-base-content">
          <header class="navbar bg-base-200 shadow-sm">
            <div class="navbar-start">
              <a
                class="btn btn-ghost text-xl"
                href={routes.home.href()}
                rmx-target="content"
              >
                game-center
              </a>
            </div>
            <div class="navbar-center">
              <a
                class="btn btn-ghost btn-sm"
                href={routes.dev.href()}
                rmx-target="content"
              >
                開発者向け
              </a>
            </div>
            <div class="navbar-end">
              <NavAuth returnTo={routes.me.href()} />
            </div>
          </header>
          <Frame
            name="content"
            src={initialSrc}
            fallback={
              <main class="mx-auto w-full max-w-3xl p-8">
                <p>Loading…</p>
              </main>
            }
          />
        </body>
      </html>
    );
  };
}
