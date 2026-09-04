/**
 * game-center hub server — Remix v3 fetch-router on Deno.
 *
 * Route definitions live in `./routes.ts`, each page has a controller under
 * `./controllers/`, and this module only wires middleware to routes and
 * exports the router for `deno serve`.
 */

import { createRouter } from "@remix-run/fetch-router";
import { staticFiles } from "@remix-run/static-middleware";

import {
  internalApproveAction,
  internalDismissAction,
  internalGamesAction,
  internalGamesRegisterAction,
} from "./controllers/api/internal_games.ts";
import { registryGamesAction } from "./controllers/api/registry_games.ts";
import {
  gameAchievementsAction,
  gameMeAction,
  gameUnlockAction,
} from "./controllers/api/game.ts";
import { internalCatalogAction } from "./controllers/api/internal_catalog.ts";
import {
  internalFollowersAction,
  internalFollowersSeenAction,
} from "./controllers/api/internal_followers.ts";
import { internalTimelineAction } from "./controllers/api/internal_timeline.ts";
import {
  internalFollowAction,
  internalFollowStateAction,
  internalUnfollowAction,
} from "./controllers/api/internal_follows.ts";
import { internalGamePeersAction } from "./controllers/api/internal_game_peers.ts";
import { internalMeAchievementsAction } from "./controllers/api/internal_me.ts";
import {
  internalClaimAction,
  internalLaunchAction,
} from "./controllers/api/internal_play.ts";
import { internalSessionAction } from "./controllers/api/session.ts";
import { claimPageAction } from "./controllers/claim.tsx";
import { devAction } from "./controllers/dev.tsx";
import { authorPageAction } from "./controllers/author.tsx";
import { gamePageAction } from "./controllers/game.tsx";
import { playPageAction } from "./controllers/play.tsx";
import { homeAction } from "./controllers/home.tsx";
import { meAction } from "./controllers/me.tsx";
import {
  iconAction,
  manifestAction,
  serviceWorkerAction,
} from "./controllers/pwa.ts";
import { jwksAction } from "./controllers/jwks.ts";
import { schemaAction } from "./controllers/schema.ts";
import { dpop } from "./middleware/dpop.ts";
import { gameCors } from "./middleware/game_cors.ts";
import { routes } from "./routes.ts";

/**
 * `bundled/` is served twice, because its two halves want opposite things.
 *
 * `chunk-*.js` carries a content hash in its name, so what it holds can never
 * change — cache it forever. The entry points cannot: `/play_button.js` is the
 * name the server-rendered markup asks for, so every deploy replaces the file
 * behind a URL the browser already has. With no directive the browser is free
 * to reuse its copy for a heuristic freshness window, and then the page runs
 * the *last* deploy's component against *this* deploy's HTML. That is not a
 * stale pixel: the marker hydrates, the old component renders a different
 * element than the server did, and both stay on screen at once.
 *
 * `no-cache` keeps the copy and revalidates it, which the ETag answers with a
 * 304 — the same cost as a cache hit, minus the wrong answer.
 */
const BUNDLED = new URL("../bundled", import.meta.url).pathname;
const isHashed = (path: string) => path.startsWith("chunk-");

const serveHashed = staticFiles(BUNDLED, {
  filter: isHashed,
  cacheControl: "public, max-age=31536000, immutable",
});
const serveBundled = staticFiles(BUNDLED, {
  filter: (path) => !isHashed(path),
  cacheControl: "no-cache",
});

const router = createRouter({
  middleware: [serveHashed, serveBundled, gameCors, dpop],
});

router.get(routes.home, homeAction);
router.get(routes.game, gamePageAction);
router.get(routes.play, playPageAction);
router.get(routes.claim, claimPageAction);
router.get(routes.author, authorPageAction);
router.get(routes.me, meAction);
router.get(routes.dev, devAction);
router.get(routes.schema, schemaAction);
router.get(routes.webManifest, manifestAction);
router.get(routes.appIcon, iconAction);
router.get(routes.serviceWorker, serviceWorkerAction);
router.get(routes.jwks, jwksAction);

router.post(routes.internalSession, internalSessionAction);
router.get(routes.internalGames, internalGamesAction);
router.post(routes.internalGamesRegister, internalGamesRegisterAction);
router.post(routes.internalApprove, internalApproveAction);
router.delete(routes.internalDismiss, internalDismissAction);
router.post(routes.internalLaunch, internalLaunchAction);
router.post(routes.internalClaim, internalClaimAction);
router.get(routes.internalMeAchievements, internalMeAchievementsAction);
router.post(routes.internalFollow, internalFollowAction);
router.delete(routes.internalUnfollow, internalUnfollowAction);
router.get(routes.internalFollowState, internalFollowStateAction);
router.get(routes.internalCatalog, internalCatalogAction);
router.get(routes.internalFollowers, internalFollowersAction);
router.post(routes.internalFollowersSeen, internalFollowersSeenAction);
router.get(routes.internalTimeline, internalTimelineAction);
router.get(routes.internalGamePeers, internalGamePeersAction);

router.post(routes.gameUnlock, gameUnlockAction);
router.get(routes.gameMe, gameMeAction);
router.get(routes.gameAchievements, gameAchievementsAction);

router.post(routes.registryGames, registryGamesAction);

export default router;
