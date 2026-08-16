/**
 * Build entrypoint — bundles client JS and Tailwind CSS into `bundled/`,
 * which the server then serves through `staticFiles`.
 */

import { buildCss } from "./css.ts";
import { buildJs } from "./js.ts";

export { buildCss, buildJs };

if (import.meta.main) {
  const [js, css] = await Promise.all([buildJs(), buildCss()]);
  console.log("[bundler] js complete", js);
  console.log("[bundler] css complete", css);
}
