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
import { schemaAction } from "./controllers/schema.ts";
import { dpop } from "./middleware/dpop.ts";
import { gameCors } from "./middleware/game_cors.ts";
import { routes } from "./routes.ts";

const serveBundled = staticFiles(
  new URL("../bundled", import.meta.url).pathname,
);

const router = createRouter({ middleware: [serveBundled, gameCors, dpop] });

router.get(routes.home, homeAction);
router.get(routes.game, gamePageAction);
router.get(routes.play, playPageAction);
router.get(routes.claim, claimPageAction);
router.get(routes.author, authorPageAction);
router.get(routes.me, meAction);
router.get(routes.dev, devAction);
router.get(routes.schema, schemaAction);

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
