/**
 * No `<textarea>` takes its text from `defaultValue`.
 *
 * On a textarea, `defaultValue` is the element's text content, and
 * `@remix-run/ui@0.8` reconciles that content against the vtree's children —
 * which a textarea's props type forbids, so they are always none. The text is
 * there on the first paint and gone on the next render. Nothing reports it:
 * the type checker accepts the prop, and a page that renders once looks fine.
 * The feedback form's draft showed for a moment and vanished this way.
 *
 * Put an initial value in through `ref` instead (see `client/feedback_form.tsx`):
 * a value set on the element is the "dirty" value, which no later change to
 * the default touches.
 *
 * Here rather than beside the client because reading the sources needs read
 * permission, and the `-P` suite has none.
 */

import { assertEquals } from "@std/assert";

const CLIENT = new URL("../client/", import.meta.url);

/** Each `<textarea …>` opening tag in a source, attributes included. */
const TEXTAREA = /<textarea\b[^>]*>/gs;

Deno.test("no textarea is filled through defaultValue", async () => {
  const offenders: string[] = [];
  for await (const entry of Deno.readDir(CLIENT)) {
    if (!entry.isFile || !entry.name.endsWith(".tsx")) continue;
    const source = await Deno.readTextFile(new URL(entry.name, CLIENT));
    for (const tag of source.match(TEXTAREA) ?? []) {
      if (tag.includes("defaultValue")) offenders.push(entry.name);
    }
  }
  assertEquals(offenders, [], "set the initial value with ref() instead");
});

Deno.test("the guard would notice", () => {
  const tag = `<textarea\n  class="x"\n  defaultValue={draft}\n>`;
  assertEquals(tag.match(TEXTAREA)?.[0].includes("defaultValue"), true);
});
