/**
 * `deno task migrate` — what the deployment's pre-deploy step runs.
 *
 * It runs for every deployment, previews included, against whatever database
 * that context is wired to. So it does three different things depending on
 * which database that is.
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

/**
 * Set on the contexts pointed at a throwaway database, next to the URL it
 * describes. Every destructive path below is behind it, because a misconfigured
 * URL is the only thing that would make them catastrophic — so the permission
 * to destroy lives beside the URL rather than being inferred from it.
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
