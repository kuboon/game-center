/**
 * GET /schema/gamecenter.json — the manifest schema, where `$schema` says it is.
 *
 * Imported rather than read from disk so it travels with the module graph and
 * the server needs no read permission for it. Open CORS and a long cache: it
 * is a public document, fetched by editors and CI on any origin.
 */

import type { Action } from "@remix-run/fetch-router";
import schema from "@game-center/protocol/schema.json" with { type: "json" };

import type { routes } from "../routes.ts";

const body = JSON.stringify(schema, null, 2);

export const schemaAction = {
  handler() {
    return new Response(body, {
      headers: {
        "content-type": "application/schema+json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=3600",
      },
    });
  },
} satisfies Action<typeof routes.schema>;
