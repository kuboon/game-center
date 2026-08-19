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

import { get, post, route } from "@remix-run/fetch-router/routes";

export const routes = route({
  home: get("/"),
  me: get("/me"),
  internalSession: post("/api/internal/session"),
});
