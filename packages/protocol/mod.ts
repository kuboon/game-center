/**
 * The gamecenter.json manifest: the vocabulary the hub, the GitHub Action, and
 * the SDK all share.
 *
 * A game declares itself and its achievements in one file, and every path into
 * the registry — the CI action, the developer dashboard — validates it through
 * {@link parseManifest} rather than trusting its own idea of the shape. The
 * errors are written for the person (or LLM) editing the file: they name the
 * field and say what was wrong with it.
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
  /** Globally unique slug, claimed by whoever registers it first. */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /** Where the game is played. Also the origin checked in postMessage mode. */
  readonly url: string;
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

/** Slugs are lowercase so a game's URL never depends on how it was typed. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
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

  const title = requireString(value.title, "title", add);
  if (title !== undefined && title.length > MAX_TITLE) {
    add("title", `must be at most ${MAX_TITLE} characters`);
  }

  const description = optionalString(value.description, "description", add);
  if (description !== undefined && description.length > MAX_DESCRIPTION) {
    add("description", `must be at most ${MAX_DESCRIPTION} characters`);
  }

  const url = requireString(value.url, "url", add);
  if (url !== undefined) requireHttpsUrl(url, "url", add);

  // `icon` in the file, `iconUrl` in code: the manifest reads better short,
  // and the field is a URL like any other.
  const iconUrl = optionalString(value.icon, "icon", add);
  if (iconUrl !== undefined) requireHttpsUrl(iconUrl, "icon", add);

  const achievements = parseAchievements(value.achievements, add);

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    manifest: {
      id: id!,
      title: title!,
      ...(description !== undefined ? { description } : {}),
      url: url!,
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
 * Games are loaded into a page over HTTPS, and the URL doubles as the origin
 * the hub checks in postMessage mode — so anything else is rejected outright.
 * `http://localhost` is allowed so a game can be developed before it ships.
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

/** Render issues as one message, for a CI log or an API error body. */
export function formatIssues(issues: readonly ManifestIssue[]): string {
  return issues
    .map(({ path, message }) => (path ? `${path}: ${message}` : message))
    .join("\n");
}
