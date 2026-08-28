/**
 * The client bundles must share one copy of the `@remix-run/ui` runtime.
 *
 * `run()` lives in `mod.js` and owns the reconciler; every `clientEntry` is a
 * separate module it imports at hydration time. Parts of the runtime identify
 * values by module-scoped identity — `on("click", …)` tags its mixin
 * descriptor with `onMixinType`, and the reconciler recognizes the descriptor
 * only by comparing against that same function object. Give each entry its own
 * copy of the runtime and the comparison fails silently: the component
 * hydrates, renders, and never receives a single DOM event listener.
 *
 * Nothing about that failure is visible in a build log or a type check, and it
 * cost a day of looking at the wrong layer. So it gets a test.
 */

import { assert, assertEquals } from "@std/assert";

import { buildJs } from "./js.ts";

const result = await buildJs({ write: false });

const outputs = (result.outputFiles ?? [])
  .filter((file) => file.path.endsWith(".js"))
  .map((file) => ({
    name: file.path.split("/").pop()!,
    text: file.text(),
  }));

Deno.test("the bundle build succeeds", () => {
  assertEquals(result.errors, []);
  assert(result.success);
  assert(outputs.length > 0, "expected JS output files");
});

Deno.test("the ui runtime is not duplicated across entries", () => {
  // A marker that appears exactly once per copy of the runtime. `mix` props
  // are normalized on every element the runtime creates, so any bundle that
  // inlined its own runtime carries its own definition.
  const carriers = outputs.filter((file) =>
    file.text.includes("function normalizeMixValue(")
  );
  assertEquals(
    carriers.map((file) => file.name).sort(),
    carriers.slice(0, 1).map((file) => file.name),
    "more than one bundle carries the @remix-run/ui runtime; " +
      "code splitting is off, so mixin identity checks will fail at runtime",
  );
});

Deno.test("the session store is not duplicated across entries", () => {
  // `client/session.ts` survives duplication on its own — it parks the
  // instance on a global holder — but one copy of the module is still the
  // shape we want, and this catches splitting silently regressing.
  const carriers = outputs.filter((file) =>
    /DpopSessionStore\s*=\s*class/.test(file.text)
  );
  assertEquals(carriers.length, 1, "expected one copy of client/session.ts");
});

Deno.test("entries import the shared chunk rather than inlining it", () => {
  const entry = outputs.find((file) => file.name === "play_button.js");
  assert(entry, "expected play_button.js in the output");
  assert(
    /from "\.\/chunk-[^"]+\.js"/.test(entry.text),
    "play_button.js should import the shared runtime chunk",
  );
});
