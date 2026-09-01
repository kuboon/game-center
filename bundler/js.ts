/**
 * Client-side JS/TSX bundling via `Deno.bundle` (unstable).
 *
 * Each entrypoint under `client/` is compiled to a same-named `.js` (with a
 * linked sourcemap) under `bundled/`.
 *
 * **`codeSplitting` is not an optimization here — it is required for
 * correctness.** `run()` in `mod.js` owns the reconciler; every other entry is
 * a `clientEntry` module it imports at hydration time. Without splitting, each
 * entry gets its own inlined copy of the `@remix-run/ui` runtime, and the two
 * copies do not recognize each other's values: `on("click", …)` builds a mixin
 * descriptor tagged with its own module-scoped `onMixinType`, the reconciler in
 * `mod.js` compares it against *its* `onMixinType`, the identity check fails,
 * and no DOM listener is ever attached. The component still hydrates and
 * renders, so nothing looks broken — the button is just inert (that was the
 * 遊ぶ button doing nothing).
 *
 * With splitting on, the runtime lands in a chunk that every entry imports, so
 * identity holds. `client/session.ts` was duplicated the same way but survived
 * it, because it parks its instance on a global holder rather than trusting
 * module scope; the ui runtime has no such defence.
 */

const CLIENT_ENTRIES = [
  "mod.ts",
  "nav_auth.tsx",
  "account_card.tsx",
  "dev_console.tsx",
  "play_button.tsx",
  "claim_panel.tsx",
  "achievement_list.tsx",
  "prompt_card.tsx",
  "play_frame.tsx",
  "follow_button.tsx",
  "catalog_sections.tsx",
  "peer_scores.tsx",
  "timeline.tsx",
] as const;

const OUTPUT_DIR = new URL("../bundled", import.meta.url);

/**
 * Drop every generated `.js` before a build.
 *
 * Two ways a file outlives what produced it. A chunk name carries a content
 * hash, so a stale one is never overwritten; and an entry removed from
 * `CLIENT_ENTRIES` leaves its `.js` behind, still importing chunks that no
 * longer exist. Both then sit in `bundled/` and get deployed, and the second
 * one also breaks `deno check` locally — CI never sees it, because CI builds
 * into an empty directory.
 *
 * Only `.js` and its sourcemaps: `style.css` and `llms.txt` live here too and
 * belong to other builders.
 */
async function clearJsOutput() {
  try {
    for await (const entry of Deno.readDir(OUTPUT_DIR)) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".js") && !entry.name.endsWith(".js.map")) {
        continue;
      }
      await Deno.remove(new URL(entry.name, `${OUTPUT_DIR}/`));
    }
  } catch (cause) {
    if (!(cause instanceof Deno.errors.NotFound)) throw cause;
  }
}

export async function buildJs(
  { minify = false, write = true }: { minify?: boolean; write?: boolean } = {},
) {
  if (write) await clearJsOutput();
  const entrypoints = CLIENT_ENTRIES.map((p) =>
    import.meta.resolve(`../client/${p}`)
  );
  return await Deno.bundle({
    entrypoints,
    outputDir: OUTPUT_DIR.pathname,
    platform: "browser",
    // Correctness, not size — see the module comment.
    codeSplitting: true,
    sourcemap: "linked",
    minify,
    write,
  });
}
