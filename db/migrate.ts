/**
 * `deno task migrate` — apply migrations, and rebuild a preview database when
 * they no longer line up with it.
 *
 * This is what the deployment's pre-deploy step runs, so it runs for previews
 * as well as for production, against whatever database that context is wired
 * to.
 *
 * Editing a migration that has not been merged yet is ordinary work. But a
 * preview database has already applied the old version of it, and the runner
 * checksums what it applied — so the next preview build fails, and keeps
 * failing until someone rebuilds the database by hand. A preview database is
 * not worth that. It is worth rebuilding.
 *
 * Two independent signals have to agree before anything is destroyed: the
 * deployment must not be the production one, and the database must be marked
 * disposable by the context it belongs to. Without `PREVIEW_DATABASE=1` this
 * is exactly `deno task db migrate` and nothing else.
 */

import { runTursoDbCli } from "@kuboon/remix-data-table-sqlite-turso";

/** `production`, `git-branch/<name>`, `preview/<id>`, or absent off-platform. */
const timeline = Deno.env.get("DENO_TIMELINE") ?? "local";

/**
 * Set on the contexts pointed at a throwaway database, next to the URL it
 * describes. A misconfigured URL is the one thing that would make rebuilding
 * catastrophic, so the permission to rebuild lives beside the URL rather than
 * being inferred from it.
 */
const disposable = Deno.env.get("PREVIEW_DATABASE") === "1" &&
  timeline !== "production";

async function run(...args: string[]): Promise<number> {
  console.log(`[db] ${args.join(" ")} (${timeline})`);
  try {
    return await runTursoDbCli([...args, ...Deno.args]);
  } catch (error) {
    console.error(`[db] ${(error as Error).message}`);
    return 1;
  }
}

const code = await run("migrate");
if (code === 0 || !disposable) Deno.exit(code);

// Migrating failed against a database nobody needs to keep. Rebuilding it costs
// its data and settles every way the two could have diverged — drift from an
// edited migration, a migration that only ever existed on a branch, a schema
// left behind by a pull request that closed. A real mistake in the SQL survives
// this and fails again, which is what should happen.
console.log(`[db] migrate failed on a disposable database; rebuilding it`);
Deno.exit(await run("reset", "--force"));
