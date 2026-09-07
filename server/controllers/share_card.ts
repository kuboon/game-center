/**
 * GET /og.png — the picture a shared link to this hub carries.
 *
 * A route rather than a file, for the reasons `pwa.ts` gives: it travels with
 * the module graph, so no read permission and no build step stand between a
 * deploy and this URL. Here there is a second reason — the image is drawn
 * (`server/ui/share_card_image.ts`) rather than stored, so there is nothing to
 * serve from disk in the first place.
 *
 * Cached hard. The drawing cannot change without a deploy, and the crawlers
 * that fetch it keep their own copy for far longer than any header asks.
 */

import type { Action } from "@remix-run/fetch-router";

import { getConfig } from "../config.ts";
import type { routes } from "../routes.ts";
import { shareCardPng } from "../ui/share_card_image.ts";

/** The hostname the card prints, so a copy of this hub names itself. */
function ownHost(): string {
  try {
    return new URL(getConfig().rpOrigin).hostname;
  } catch {
    return "game-center";
  }
}

export const shareCardAction = {
  async handler() {
    return new Response(await shareCardPng(ownHost()), {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400",
      },
    });
  },
} satisfies Action<typeof routes.shareCard>;
