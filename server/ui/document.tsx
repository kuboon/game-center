/**
 * Document — the persistent HTML shell (navbar + `<Frame name="content">`).
 *
 * Client-side, `run()` (bundled from client/mod.ts) hydrates every clientEntry
 * marker and turns clicks on `<a rmx-target="content">` into frame swaps
 * instead of full document navigations.
 */

import { Frame, type Handle } from "@remix-run/ui";

import { NavAuth } from "../../client/nav_auth.tsx";
import { routes } from "../routes.ts";

type DocumentProps = {
  initialSrc: string;
};

export function Document(handle: Handle<DocumentProps>) {
  return () => (
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>game-center</title>
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
          <div class="navbar-end">
            <NavAuth returnTo={routes.me.href()} />
          </div>
        </header>
        <Frame
          name="content"
          src={handle.props.initialSrc}
          fallback={
            <main class="mx-auto w-full max-w-3xl p-8">
              <p>Loading…</p>
            </main>
          }
        />
      </body>
    </html>
  );
}
