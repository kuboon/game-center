/**
 * Build entrypoint — bundles client JS and Tailwind CSS into `bundled/`,
 * which the server then serves through `staticFiles`.
 */

import { buildCss } from "./css.ts";
import { buildJs } from "./js.ts";
import { buildLlmsTxt } from "./llms.ts";

export { buildCss, buildJs, buildLlmsTxt };

if (import.meta.main) {
  const [js, css, llms] = await Promise.all([
    buildJs(),
    buildCss(),
    buildLlmsTxt(),
  ]);
  console.log("[bundler] js complete", js);
  console.log("[bundler] css complete", css);
  // Not the whole `llms`: it carries the assembled text, for the tests to read
  // without a build. Logging it buries every other line of the build log.
  console.log("[bundler] llms.txt complete", {
    output: llms.output,
    bytes: llms.bytes,
  });
}
