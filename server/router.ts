/**
 * game-center hub server — Remix v3 fetch-router on Deno.
 *
 * Route definitions live in `./routes.ts`, each page has a controller under
 * `./controllers/`, and this module only wires middleware to routes and
 * exports the router for `deno serve`.
 */

import { createRouter, type Middleware } from "@remix-run/fetch-router";
import { staticFiles } from "@remix-run/static-middleware";

import { internalSessionAction } from "./controllers/api/session.ts";
import { homeAction } from "./controllers/home.tsx";
import { meAction } from "./controllers/me.tsx";
import { dpop } from "./middleware/dpop.ts";
import { routes } from "./routes.ts";

/**
 * `@remix-run/static-middleware@0.4.13` pins `@remix-run/fetch-router@^0.20.1`,
 * which excludes the 0.21.0 this app uses, so Deno resolves a second copy and
 * the two `Middleware` types stop matching. The middleware imports fetch-router
 * with `import type` only and never calls into it, so the duplicate is purely
 * nominal. Drop the cast once static-middleware widens its range.
 */
const serveBundled = staticFiles(
  new URL("../bundled", import.meta.url).pathname,
) as unknown as Middleware;

const router = createRouter({ middleware: [serveBundled, dpop] });

router.get(routes.home, homeAction);
router.get(routes.me, meAction);
router.post(routes.internalSession, internalSessionAction);

export default router;
