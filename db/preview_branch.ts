/**
 * Rebuild the preview database as a fresh branch of production.
 *
 * A preview deployment migrates a database, and the interesting question is
 * always "would this migration survive the real one?". A database that was
 * wiped and re-migrated cannot answer it — that is what CI already does, on
 * empty tables. A branch taken from production a moment ago can: it carries
 * production's rows, and a migration that cannot survive them fails here rather
 * than during the deploy that matters.
 *
 * This exists because that failure is not hypothetical. A migration in this
 * repository passed every test and then broke on the first table that had a row
 * in it, because a primary key cannot be renumbered while rows point at it.
 *
 * Inert unless told otherwise. Without the environment below it does nothing
 * and says so, and the caller falls back to migrating whatever is there.
 *
 * @module
 */

const API = "https://api.turso.tech/v1";

export interface BranchConfig {
  /** Platform API token. Strong enough to delete databases — scope it. */
  readonly token: string;
  /** Organization slug, as it appears in a database's hostname. */
  readonly org: string;
  /** The database to copy: production. */
  readonly source: string;
  /** The database to replace: the preview one. */
  readonly preview: string;
  /** Turso group both databases belong to. */
  readonly group: string;
}

/**
 * Read the branch configuration from the environment.
 *
 * The preview database's name is derived from `PREVIEW_DATABASE_URL`, the same
 * variable the migration is pointed at, rather than named a second time — two
 * names for one database is how the wrong one gets deleted. It is deliberately
 * not `TURSO_DATABASE_URL`: that one names production during a production
 * build, and nothing here may address production.
 *
 * @param env The environment to read
 * @returns The configuration, or null when this deployment should not rebrand
 */
export function readBranchConfig(
  env: { get(key: string): string | undefined },
): BranchConfig | null {
  const token = env.get("TURSO_PLATFORM_TOKEN");
  const org = env.get("TURSO_ORG");
  const source = env.get("TURSO_SOURCE_DATABASE");
  const url = env.get("PREVIEW_DATABASE_URL");
  if (!token || !org || !source || !url) return null;

  const preview = databaseName(url, org);
  if (!preview) return null;

  // The one mistake that would be unrecoverable. A preview database that
  // resolves to production's name is a misconfiguration, not an instruction.
  if (preview === source) {
    throw new Error(
      `Refusing to rebuild "${preview}": it is the source database`,
    );
  }

  return {
    token,
    org,
    source,
    preview,
    group: env.get("TURSO_GROUP") ?? "default",
  };
}

/**
 * The database's name, from the URL it is reached at.
 *
 * A hostname is `{database}-{org}.{region}.turso.io`. The organization has to
 * be known to split it, because a database name may contain hyphens too.
 */
export function databaseName(url: string, org: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const label = host.split(".")[0] ?? "";
  const suffix = `-${org}`;
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) : null;
}

/**
 * Delete the preview database and create it again from the source.
 *
 * @param config Where to copy from and what to replace
 * @param fetchImpl Injected for the tests
 */
export async function rebuildPreviewBranch(
  config: BranchConfig,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<void> {
  const { token, org, source, preview, group } = config;
  const headers = { authorization: `Bearer ${token}` };

  const dropped = await fetchImpl(
    `${API}/organizations/${org}/databases/${preview}`,
    { method: "DELETE", headers },
  );
  // 404 means it was already gone — a previous build that died between the two
  // calls, most likely. Either way there is nothing to delete.
  if (!dropped.ok && dropped.status !== 404) {
    throw new Error(
      `Could not delete ${preview}: ${dropped.status} ${await dropped.text()}`,
    );
  }

  const created = await fetchImpl(`${API}/organizations/${org}/databases`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      name: preview,
      group,
      seed: { type: "database", name: source },
    }),
  });
  if (!created.ok) {
    throw new Error(
      `Could not branch ${source} into ${preview}: ${created.status} ${await created
        .text()}`,
    );
  }
}
