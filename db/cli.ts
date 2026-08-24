/**
 * `deno task db` — the Turso CLI, announcing what it is about to touch.
 *
 * The package's own executable would do, and this calls the exact function it
 * calls. The one thing added is a line naming the database and the deployment
 * context, printed before anything runs.
 *
 * That line exists because of an incident it would have made obvious. The
 * pre-deploy step runs `deno task migrate`, so every deployment migrates —
 * including previews, which were pointed at production. Nothing in the output
 * said so, and the first symptom was a checksum conflict days later. Whatever
 * the environment is wired to, the log should say it out loud.
 */

import { runTursoDbCli } from "@kuboon/remix-data-table-sqlite-turso";

/** Where the CLI will connect, by the same precedence it uses. */
function target(args: string[]): string {
  const flag = args.indexOf("--url");
  const url = flag !== -1 && args[flag + 1]
    ? args[flag + 1]
    : Deno.env.get("TURSO_DATABASE_URL") || "file:data/app.db";
  try {
    // The host alone: enough to tell production from anything else, and it
    // cannot carry a credential the way a full URL might.
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

if (!Deno.args.includes("--help") && Deno.args.length > 0) {
  // `production`, `git-branch/<name>`, or `preview/<id>` on Deno Deploy;
  // absent on a laptop.
  const timeline = Deno.env.get("DENO_TIMELINE") ?? "local";
  console.log(`[db] ${Deno.args[0]} on ${target(Deno.args)} (${timeline})`);
}

Deno.exit(await runTursoDbCli(Deno.args));
