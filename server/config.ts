/**
 * Environment-derived configuration, read once per process.
 *
 * {@link readConfig} is the pure core so tests can pass an environment without
 * touching `Deno.env`; {@link getConfig} is the cached app-wide accessor.
 */

/** Environment variables this server reads. */
export interface Env {
  readonly TURSO_DATABASE_URL?: string;
  readonly PREVIEW_DATABASE_URL?: string;
  readonly DENO_TIMELINE?: string;
  readonly TURSO_AUTH_TOKEN?: string;
  readonly IDP_ORIGIN?: string;
  readonly RP_ORIGIN?: string;
  readonly RP_SIGNING_KEY_JWK?: string;
}

export interface Config {
  /**
   * libSQL URL of the database this deployment reads. Production's on the
   * production timeline, the preview one otherwise. Empty when unset, which
   * turns the database off rather than borrowing another timeline's.
   */
  readonly tursoDatabaseUrl: string;
  /** Turso auth token. Empty for local databases that need none. */
  readonly tursoAuthToken: string;
  /** Origin of the IdP that authenticates players. */
  readonly idpOrigin: string;
  /** This hub's own origin, used as the OAuth-style `clientId` at the IdP. */
  readonly rpOrigin: string;
  /**
   * Private JWK (JSON) this hub signs launch tokens with. Empty when unset,
   * which turns launching off rather than falling back to a per-isolate key:
   * Deno Deploy runs an isolate per request, so an ephemeral key would sign
   * tokens no other isolate could verify.
   */
  readonly rpSigningKeyJwk: string;
}

/**
 * Build a {@link Config} from the given environment.
 *
 * The database is chosen by timeline, the same way `db/migrate.ts` chooses it.
 * Deno Deploy holds one value per variable name — a context narrows where a
 * variable applies, it does not give the name a second value — so production
 * and previews cannot be pointed at different databases by wiring alone.
 * `DENO_TIMELINE` says which deployment this is, and a preview that has no
 * `PREVIEW_DATABASE_URL` gets no database rather than production's.
 */
export function readConfig(env: Env): Config {
  const preview = (env.DENO_TIMELINE ?? "production") !== "production";
  return {
    tursoDatabaseUrl: preview
      ? env.PREVIEW_DATABASE_URL ?? ""
      : env.TURSO_DATABASE_URL ?? "",
    tursoAuthToken: env.TURSO_AUTH_TOKEN ?? "",
    idpOrigin: env.IDP_ORIGIN ?? "https://id.kbn.one",
    rpOrigin: env.RP_ORIGIN ?? "https://ga-cen.kbn.one",
    rpSigningKeyJwk: env.RP_SIGNING_KEY_JWK ?? "",
  };
}

/** Variables passed to {@link readConfig} by {@link getConfig}. */
const ENV_KEYS = [
  "TURSO_DATABASE_URL",
  "PREVIEW_DATABASE_URL",
  "DENO_TIMELINE",
  "TURSO_AUTH_TOKEN",
  "IDP_ORIGIN",
  "RP_ORIGIN",
  "RP_SIGNING_KEY_JWK",
] as const;

let cached: Config | undefined;

/** The process-wide configuration, read from `Deno.env` on first use. */
export function getConfig(): Config {
  if (cached) return cached;
  const env: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) env[key] = Deno.env.get(key);
  return cached = readConfig(env);
}
