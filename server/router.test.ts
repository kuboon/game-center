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

Deno.test("GET /me serves the account page", async () => {
  const response = await router.fetch(
    new Request("http://localhost/me", { headers: { "rmx-frame": "1" } }),
  );
  assertEquals(response.status, 200);

  const html = await response.text();
  assertStringIncludes(html, "マイページ");
  assertStringIncludes(html, "アカウント");
});

Deno.test("POST /api/internal/session says why the proof was refused", async () => {
  const response = await router.fetch(
    new Request("http://localhost/api/internal/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jws: "whatever" }),
    }),
  );
  assertEquals(response.status, 401);
  assertEquals(response.headers.get("cache-control"), "no-store");

  const body = await response.json();
  assertEquals(body.reason, "missing-dpop-header");
});

Deno.test("POST /api/internal/session names the real fault in a bad proof", async () => {
  const response = await router.fetch(
    new Request("http://localhost/api/internal/session", {
      method: "POST",
      headers: { "content-type": "application/json", DPoP: "not-a-proof" },
      body: JSON.stringify({ jws: "whatever" }),
    }),
  );
  assertEquals(response.status, 401);

  const body = await response.json();
  assertEquals(body.reason, "invalid-format");
});
