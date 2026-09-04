/**
 * The gamecenter.json manifest: the vocabulary the hub, the GitHub Action, and
 * the SDK all share.
 *
 * A game declares itself and its achievements in one document, and every path
 * into the registry — the hub fetching a game's page, the developer dashboard —
 * validates it through {@link parseManifest} rather than trusting its own idea
 * of the shape. The errors are written for the person (or LLM) editing the
 * document: they name the field and say what was wrong with it.
 *
 * The document lives in one of three places, and the hub looks for them in
 * this order (see {@link MANIFEST_SCRIPT_TYPE} and {@link MANIFEST_FILENAME}):
 *
 * 1. Embedded in the game's own page, in a `<script>` tag the browser ignores.
 *    This is the shape a single-file game wants: the manifest ships with the
 *    code that implements the achievements, so neither can go stale alone.
 * 2. A `gamecenter.json` file beside the page, for games that would rather keep
 *    their HTML clean.
 * 3. Pasted into the hub's dashboard, for games with no public URL to fetch.
 *
 * Wherever it comes from, the manifest names its author by handle, and the
 * registration only completes once that account approves it.
 *
 * The JSON Schema next door (`schema.json`) describes the same document for
 * editors, and is served from the hub so `$schema` resolves.
 *
 * @module
 */

/** One achievement a game can unlock. */
export interface AchievementManifest {
  /** Unique within the game. What `unlock()` names. */
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  /** Points this achievement is worth. Non-negative. */
  readonly points: number;
  /** Hide the title and description until it is unlocked. */
  readonly hidden: boolean;
}

/** A game as its manifest declares it. */
export interface GameManifest {
  /**
   * The game's slug, unique among this author's games rather than globally.
   *
   * Its full name is `{author}/{id}` — see {@link gameRef} — so two authors can
   * both have a `tetris` and nobody has to check whether a name is free.
   */
  readonly id: string;
  /**
   * The author's game-center handle — the id their account signs in with.
   *
   * Half of what establishes a registration: the document says who wrote it,
   * and that account says which documents are theirs. Neither alone is worth
   * anything, which is why no secret has to travel between them.
   *
   * The hub's `/me` page hands this out ready to paste, since nobody should be
   * transcribing an identifier by hand.
   */
  readonly author: string;
  readonly title: string;
  readonly description?: string;
  /**
   * Where the game is played.
   *
   * Optional, because a manifest the hub fetched is already at the game's own
   * URL — declaring it again could only introduce a disagreement. Required
   * only when the manifest arrives with no location of its own, i.e. pasted
   * into the dashboard.
   */
  readonly url?: string;
  /** May be relative; the registry resolves it against the game's URL. */
  readonly iconUrl?: string;
  readonly achievements: readonly AchievementManifest[];
}

/** A problem with one field, phrased for whoever is editing the manifest. */
export interface ManifestIssue {
  /** Dotted path to the offending value, e.g. `achievements[0].key`. */
  readonly path: string;
  readonly message: string;
}

export type ParseResult =
  | { readonly ok: true; readonly manifest: GameManifest }
  | { readonly ok: false; readonly issues: readonly ManifestIssue[] };

/**
 * The `type` of the `<script>` tag an embedded manifest lives in.
 *
 * A type the browser does not recognise, so the tag is inert: the game's own
 * JavaScript never sees it and never has to skip it. The same trick JSON-LD
 * uses with `application/ld+json`.
 */
export const MANIFEST_SCRIPT_TYPE = "application/gamecenter+json";

/** The conventional filename, looked for beside the game's page. */
export const MANIFEST_FILENAME = "gamecenter.json";

/** Slugs are lowercase so a game's URL never depends on how it was typed. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
/**
 * What an author's handle may look like.
 *
 * Deliberately loose: a handle is the identifier the IdP issued, and its shape
 * is not ours to legislate — it may be a UUID, an opaque token, or a number.
 * All this insists on is that it survives a URL path segment unescaped, which
 * is what unreserved characters mean. Case is preserved for the same reason:
 * folding someone else's identifier is how two people become one.
 */
export const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,62}[A-Za-z0-9]$/;

/** Achievement keys allow underscores, matching how they read in code. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/;

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 500;
const MAX_ACHIEVEMENTS = 200;

/**
 * Validate a parsed JSON value as a manifest.
 *
 * Collects every problem rather than stopping at the first, so one CI run tells
 * the author everything to fix.
 *
 * @param value Whatever `JSON.parse` produced
 * @returns The manifest, or the list of problems with it
 */
export function parseManifest(value: unknown): ParseResult {
  const issues: ManifestIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ path: "", message: "must be a JSON object" }],
    };
  }

  const id = requireString(value.id, "id", add);
  if (id !== undefined && !ID_PATTERN.test(id)) {
    add(
      "id",
      "must be 3-64 characters of lowercase letters, digits, and hyphens, starting and ending with a letter or digit",
    );
  }

  const author = requireString(value.author, "author", add);
  if (author !== undefined && !HANDLE_PATTERN.test(author)) {
    add(
      "author",
      "must be a game-center handle, as shown on the hub's /me page",
    );
  }

  const title = requireString(value.title, "title", add);
  if (title !== undefined && title.length > MAX_TITLE) {
    add("title", `must be at most ${MAX_TITLE} characters`);
  }

  const description = optionalString(value.description, "description", add);
  if (description !== undefined && description.length > MAX_DESCRIPTION) {
    add("description", `must be at most ${MAX_DESCRIPTION} characters`);
  }

  const url = optionalString(value.url, "url", add);
  if (url !== undefined) requireHttpsUrl(url, "url", add);

  // `icon` in the document, `iconUrl` in code: the manifest reads better
  // short, and the field is a URL like any other. Left as written — it may be
  // relative to wherever the manifest was found, which only the registry
  // knows.
  const iconUrl = optionalString(value.icon, "icon", add);

  const achievements = parseAchievements(value.achievements, add);

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    manifest: {
      id: id!,
      author: author!,
      title: title!,
      ...(description !== undefined ? { description } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(iconUrl !== undefined ? { iconUrl } : {}),
      achievements: achievements!,
    },
  };
}

function parseAchievements(
  value: unknown,
  add: (path: string, message: string) => void,
): AchievementManifest[] | undefined {
  if (!Array.isArray(value)) {
    add("achievements", "must be an array");
    return undefined;
  }
  if (value.length > MAX_ACHIEVEMENTS) {
    add("achievements", `must hold at most ${MAX_ACHIEVEMENTS} achievements`);
    return undefined;
  }

  const parsed: AchievementManifest[] = [];
  const seen = new Set<string>();

  value.forEach((entry, index) => {
    const at = `achievements[${index}]`;
    if (!isRecord(entry)) {
      add(at, "must be an object");
      return;
    }

    const key = requireString(entry.key, `${at}.key`, add);
    if (key !== undefined) {
      if (!KEY_PATTERN.test(key)) {
        add(
          `${at}.key`,
          "must be 2-64 characters of lowercase letters, digits, underscores, and hyphens, starting and ending with a letter or digit",
        );
      } else if (seen.has(key)) {
        add(`${at}.key`, `duplicates an earlier achievement key: ${key}`);
      } else {
        seen.add(key);
      }
    }

    const title = requireString(entry.title, `${at}.title`, add);
    if (title !== undefined && title.length > MAX_TITLE) {
      add(`${at}.title`, `must be at most ${MAX_TITLE} characters`);
    }

    const description = optionalString(
      entry.description,
      `${at}.description`,
      add,
    );
    if (description !== undefined && description.length > MAX_DESCRIPTION) {
      add(`${at}.description`, `must be at most ${MAX_DESCRIPTION} characters`);
    }

    const points = optionalInteger(entry.points, `${at}.points`, add) ?? 0;
    if (points < 0) add(`${at}.points`, "must not be negative");

    let hidden = false;
    if (entry.hidden !== undefined) {
      if (typeof entry.hidden !== "boolean") {
        add(`${at}.hidden`, "must be a boolean");
      } else {
        hidden = entry.hidden;
      }
    }

    if (key === undefined || title === undefined) return;
    parsed.push({
      key,
      title,
      ...(description !== undefined ? { description } : {}),
      points,
      hidden,
    });
  });

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  value: unknown,
  path: string,
  add: (path: string, message: string) => void,
): string | undefined {
  if (value === undefined || value === null) {
    add(path, "is required");
    return undefined;
  }
  if (typeof value !== "string") {
    add(path, "must be a string");
    return undefined;
  }
  if (!value.trim()) {
    add(path, "must not be empty");
    return undefined;
  }
  return value;
}

function optionalString(
  value: unknown,
  path: string,
  add: (path: string, message: string) => void,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    add(path, "must be a string");
    return undefined;
  }
  return value;
}

function optionalInteger(
  value: unknown,
  path: string,
  add: (path: string, message: string) => void,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    add(path, "must be an integer");
    return undefined;
  }
  return value;
}

/**
 * Games are loaded over HTTPS, so anything else is rejected outright: the hub
 * sends a player here carrying a launch token, and plain http would put it on
 * the wire. `http://localhost` is allowed so a game can be developed before it
 * ships.
 */
function requireHttpsUrl(
  value: string,
  path: string,
  add: (path: string, message: string) => void,
): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    add(path, "must be an absolute URL");
    return;
  }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    add(path, "must be https (http is allowed only for localhost)");
  }
}

/**
 * A game's full name: the author's handle and the slug they gave it.
 *
 * This is what the hub stores as the game's id, what a launch token names in
 * `aud`, and what appears in URLs as `/@{author}/{slug}`. Building it in one
 * place keeps the two spellings from drifting.
 */
export function gameRef(author: string, slug: string): string {
  return `${author}/${slug}`;
}

/**
 * Split a full name back into its parts.
 *
 * @param ref A game reference, with or without a leading `@`
 * @returns The author and slug, or null when it is not one
 */
export function parseGameRef(
  ref: string,
): { author: string; slug: string } | null {
  const [author, slug, ...rest] = ref.replace(/^@/, "").split("/");
  if (!author || !slug || rest.length > 0) return null;
  if (!HANDLE_PATTERN.test(author) || !ID_PATTERN.test(slug)) return null;
  return { author, slug };
}

/** Render issues as one message, for a CI log or an API error body. */
export function formatIssues(issues: readonly ManifestIssue[]): string {
  return issues
    .map(({ path, message }) => (path ? `${path}: ${message}` : message))
    .join("\n");
}

/**
 * Pull an embedded manifest out of a game's HTML.
 *
 * Deliberately not a full HTML parse: the hub fetches pages written by
 * strangers, and the only thing it needs from them is the contents of one
 * script tag. The scan matches what a browser does — a script element ends at
 * the first `</script`, because HTML forbids that sequence anywhere inside it
 * and authors have to write `<\/script` instead. So truncating there is
 * correct rather than a shortcut.
 *
 * @param html The page source
 * @returns The script's text, or null when the page carries no manifest
 */
export function extractManifestScript(html: string): string | null {
  let from = 0;
  while (true) {
    const start = html.toLowerCase().indexOf("<script", from);
    if (start === -1) return null;

    const tagEnd = html.indexOf(">", start);
    if (tagEnd === -1) return null;

    // The tag's attributes, lowercased for matching. Quotes may be single,
    // double, or absent, and `type` may sit anywhere among them.
    const tag = html.slice(start + "<script".length, tagEnd).toLowerCase();
    const type = /type\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/.exec(tag);
    const declared = (type?.[2] ?? type?.[3] ?? type?.[4] ?? "").trim();

    if (declared === MANIFEST_SCRIPT_TYPE) {
      const close = html.toLowerCase().indexOf("</script", tagEnd + 1);
      return html.slice(tagEnd + 1, close === -1 ? undefined : close);
    }

    from = tagEnd + 1;
  }
}

/**
 * Parse a manifest that arrived as text, from a file or a script tag.
 *
 * Bad JSON is reported the same way a bad field is, because to whoever is
 * editing the document it is the same kind of mistake.
 *
 * @param text The raw document
 * @returns The manifest, or the list of problems with it
 */
export function parseManifestText(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    return {
      ok: false,
      issues: [{
        path: "",
        message: `is not valid JSON: ${(cause as Error).message}`,
      }],
    };
  }
  return parseManifest(value);
}
