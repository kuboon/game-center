/**
 * What a page says about itself when someone shares its URL.
 *
 * The hub's main way of reaching people is that an author posts a profile or
 * game URL somewhere and a reader follows the link. Before anyone follows it,
 * they see whatever the social network made of the page — so what a card says
 * is the first thing about game-center most people will ever read.
 *
 * Every page that is worth sharing supplies one of these. Pages that are not
 * (`/me`, `/dev`) simply do not, and fall back to the site's own name.
 */

import { getConfig } from "../config.ts";

/** How a page describes itself to a crawler. */
export interface PageMeta {
  /** Shown in the browser tab and as the card's headline. */
  readonly title: string;
  /** One or two sentences under the headline. */
  readonly description?: string;
  /**
   * Absolute URL of the card's image.
   *
   * Never generated. A game supplies its own icon through its manifest and a
   * player may have an avatar at the IdP; when neither exists the card goes
   * out without a picture, which is a better card than one with a placeholder.
   */
  readonly image?: string;
  /** Open Graph's own vocabulary. Profiles are people, everything else is not. */
  readonly type?: "website" | "profile";
}

/** The site's own name, and what the tab says when a page adds nothing. */
export const SITE_NAME = "game-center";

/**
 * Build the `<title>` for a page.
 *
 * The site name comes last so that a truncated tab still shows what the page
 * is, and so a card headline is not three-quarters branding.
 */
export function pageTitle(meta: PageMeta | undefined): string {
  return meta && meta.title !== SITE_NAME
    ? `${meta.title} — ${SITE_NAME}`
    : SITE_NAME;
}

/**
 * Resolve a URL against the hub's own origin.
 *
 * Crawlers are handed absolute URLs only; a relative `og:url` is either
 * ignored or resolved against something unhelpful.
 *
 * @param path A path on this hub, or an already-absolute URL
 * @returns The absolute form, or undefined when it cannot be made into one
 */
export function absoluteUrl(
  path: string | null | undefined,
): string | undefined {
  if (!path) return undefined;
  try {
    return new URL(path, getConfig().rpOrigin).href;
  } catch {
    return undefined;
  }
}

/** Trim a description to something a card will show rather than cut mid-word. */
export function summarize(
  text: string | null | undefined,
  limit = 160,
): string | undefined {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1)}…`;
}
