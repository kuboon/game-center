/**
 * `deno task migrate` — what the deployment's pre-deploy step runs.
 *
 * It runs once per timeline, production and previews alike, and each one has to
 * reach a different database. It cannot learn which from the environment the
 * way the server does: Deno Deploy gives the pre-deploy step the Build context
 * only, and a context holds one value per name. Whichever database the Build
 * context named, one of the two timelines would be migrating the wrong one.
 *
 * So the timeline chooses, not the wiring. `DENO_TIMELINE` says which
 * deployment is being prepared — production takes `TURSO_DATABASE_URL`,
 * anything else takes `PREVIEW_DATABASE_URL`. Both sit in the Build context
 * together, and neither can stand in for the other.
 *
 * That also settles what may be destroyed. The destructive paths below address
 * only the database named by `PREVIEW_DATABASE_URL`, and only off the
 * production timeline. A mistake in `TURSO_DATABASE_URL` cannot reach them,
 * because they never read it.
 *
 * Production: apply pending migrations. Nothing else, ever.
 *
 * A preview: take a fresh branch of production first, then migrate that. The
 * point is not tidiness — it is that the interesting question about a migration
 * is whether it survives production's actual rows, and no test asks it. CI
 * migrates empty tables. A branch taken a moment ago does not.
 *
 * A preview with no branching configured: migrate, and rebuild from nothing if
 * that fails. Editing a migration that has not been merged is ordinary work,
 * and the database has already applied the old version — without this, every
 * preview build after such an edit fails until someone intervenes.
 */

import { readBranchConfig, rebuildPreviewBranch } from "./preview_branch.ts";
import { runTursoDbCli } from "@kuboon/remix-data-table-sqlite-turso";

/** `production`, `git-branch/<name>`, `preview/<id>`, or absent off-platform. */
const timeline = Deno.env.get("DENO_TIMELINE") ?? "local";

const productionUrl = Deno.env.get("TURSO_DATABASE_URL");
const previewUrl = Deno.env.get("PREVIEW_DATABASE_URL");

/**
 * A database nobody needs to keep: the preview one, on a preview's timeline.
 *
 * Both halves are required. On a laptop there is no timeline and no preview
 * URL, so nothing is disposable and this behaves like plain `db migrate`.
 */
const disposable = timeline !== "production" && !!previewUrl;

// Two names for one database is how the wrong one gets destroyed. Converged,
// they are wrong in the single way that would be unrecoverable.
if (disposable && previewUrl === productionUrl) {
  console.error(
    "[db] PREVIEW_DATABASE_URL and TURSO_DATABASE_URL name one database",
  );
  Deno.exit(1);
}

const url = disposable ? previewUrl : productionUrl;

async function run(...args: string[]): Promise<number> {
  console.log(`[db] ${args.join(" ")} (${timeline})`);
  // Passed rather than left to the environment: the runner would read
  // TURSO_DATABASE_URL, which is the one database a preview must not touch.
  const target = url ? ["--url", url] : [];
  try {
    return await runTursoDbCli([...args, ...target, ...Deno.args]);
  } catch (error) {
    console.error(`[db] ${(error as Error).message}`);
    return 1;
  }
}

if (disposable) {
  // Not caught: readBranchConfig only throws when the preview database resolves
  // to production's name, and there is no safe way to continue from that — the
  // next two steps would migrate production and then reset it.
  const branch = readBranchConfig(Deno.env);
  if (branch) {
    console.log(
      `[db] rebranching ${branch.preview} from ${branch.source} (${timeline})`,
    );
    try {
      await rebuildPreviewBranch(branch);
    } catch (error) {
      // Turso was unreachable, or the token cannot do this. The preview loses
      // production's rows and so proves less than it should, which is worth
      // saying out loud — but it is not worth blocking every preview on, and
      // the two steps below still reach a migrated database either way.
      console.error(`[db] could not rebranch: ${(error as Error).message}`);
    }
  } else {
    console.log(`[db] no branch configuration; migrating in place`);
  }
}

const code = await run("migrate");
if (code === 0 || !disposable) Deno.exit(code);

// Migrating failed against a database nobody needs to keep. Rebuilding settles
// every way the two could have diverged, and a real mistake in the SQL survives
// it and fails again — which is what should happen.
console.log(`[db] migrate failed on a disposable database; rebuilding it`);
Deno.exit(await run("reset", "--force"));
