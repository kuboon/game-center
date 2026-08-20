/**
 * Route definitions for the hub.
 *
 * API surfaces are split by caller (see docs/grand_design.md):
 *   - `/api/game/v1`     — games on any origin, launch-token auth, CORS open
 *   - `/api/internal`    — this hub's own frontend, DPoP auth, no CORS
 *   - `/api/registry/v1` — CI / servers, API-token auth
 * Only the routes implemented so far are declared here; the rest arrive with
 * the milestone that implements them.
 */

import { del, get, post, route } from "@remix-run/fetch-router/routes";

export const routes = route({
  home: get("/"),
  game: get("/games/:id"),
  claim: get("/claim/:gameId/:key"),
  me: get("/me"),
  dev: get("/dev"),
  schema: get("/schema/gamecenter.json"),

  internalSession: post("/api/internal/session"),
  internalGames: get("/api/internal/games"),
  internalGamesRegister: post("/api/internal/games"),
  internalTokens: get("/api/internal/tokens"),
  internalTokensCreate: post("/api/internal/tokens"),
  internalTokensDelete: del("/api/internal/tokens/:id"),
  internalLaunch: post("/api/internal/launch"),
  internalClaim: post("/api/internal/claim"),
  internalMeAchievements: get("/api/internal/me/achievements"),

  gameUnlock: post("/api/game/v1/unlock"),
  gameMe: get("/api/game/v1/me"),
  gameAchievements: get("/api/game/v1/achievements"),

  registryGames: post("/api/registry/v1/games"),
});
