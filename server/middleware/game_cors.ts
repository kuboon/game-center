/**
 * CORS for the game-facing API.
 *
 * Games live on origins the hub has never heard of — GitHub Pages, a personal
 * domain, a preview deploy — so `/api/game/v1` is open to all of them. That is
 * safe because the surface is authenticated by a launch token in the
 * Authorization header and uses no cookies: an arbitrary page can send a
 * request, but not one that carries a player's credentials.
 *
 * The headers go on error responses too. A game whose token expired needs to
 * read the 401 to know it should fall back to the claim URL.
 */

import type { Middleware } from "@remix-run/fetch-router";

const GAME_API_PREFIX = "/api/game/";

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "86400",
};

export const gameCors: Middleware = async (context, next) => {
  if (!context.url.pathname.startsWith(GAME_API_PREFIX)) return await next();

  // Answer the preflight here rather than declaring an OPTIONS route per
  // endpoint: the answer is the same for all of them, and a missing one shows
  // up as an unexplained network error in the game.
  if (context.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const response = await next();
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
};
