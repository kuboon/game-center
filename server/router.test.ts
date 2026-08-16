import { assertEquals, assertStringIncludes } from "@std/assert";

import router from "./router.ts";

Deno.test("GET / serves the shell", async () => {
  const response = await router.fetch(new Request("http://localhost/"));
  assertEquals(response.status, 200);
  assertStringIncludes(response.headers.get("content-type") ?? "", "text/html");

  const html = await response.text();
  assertStringIncludes(html, "game-center");
});

Deno.test("GET / with the frame header serves the fragment only", async () => {
  const response = await router.fetch(
    new Request("http://localhost/", { headers: { "rmx-frame": "1" } }),
  );
  assertEquals(response.status, 200);

  const html = await response.text();
  assertStringIncludes(html, "<main");
  assertEquals(html.includes("<html"), false);
});
