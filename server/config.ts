/**
 * Environment-derived configuration, read once per process.
 *
 * {@link readConfig} is the pure core so tests can pass an environment without
 * touching `Deno.env`; {@link getConfig} is the cached app-wide accessor.
 */

/** Environment variables this server reads. */
export interface Env {
  readonly TURSO_DATABASE_URL?: string;
  readonly TURSO_AUTH_TOKEN?: string;
  readonly IDP_ORIGIN?: string;
  readonly RP_ORIGIN?: string;
}

export interface Config {
  /** libSQL URL of the Turso database. Empty when the database is unset. */
  readonly tursoDatabaseUrl: string;
  /** Turso auth token. Empty for local databases that need none. */
  readonly tursoAuthToken: string;
  /** Origin of the IdP that authenticates players. */
  readonly idpOrigin: string;
  /** This hub's own origin, used as the OAuth-style `clientId` at the IdP. */
  readonly rpOrigin: string;
}

/** Build a {@link Config} from the given environment. */
export function readConfig(env: Env): Config {
  return {
    tursoDatabaseUrl: env.TURSO_DATABASE_URL ?? "",
    tursoAuthToken: env.TURSO_AUTH_TOKEN ?? "",
    idpOrigin: env.IDP_ORIGIN ?? "https://id.kbn.one",
    rpOrigin: env.RP_ORIGIN ?? "https://ga-cen.kbn.one",
  };
}

/** Variables passed to {@link readConfig} by {@link getConfig}. */
const ENV_KEYS = [
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "IDP_ORIGIN",
  "RP_ORIGIN",
] as const;

let cached: Config | undefined;

/** The process-wide configuration, read from `Deno.env` on first use. */
export function getConfig(): Config {
  if (cached) return cached;
  const env: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) env[key] = Deno.env.get(key);
  return cached = readConfig(env);
}
