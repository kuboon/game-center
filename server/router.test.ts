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

Deno.test("GET /dev serves the developer page", async () => {
  const response = await router.fetch(
    new Request("http://localhost/dev", { headers: { "rmx-frame": "1" } }),
  );
  assertEquals(response.status, 200);

  const html = await response.text();
  assertStringIncludes(html, "開発者向け");
  assertStringIncludes(html, "gamecenter.json");
});

Deno.test("GET /schema/gamecenter.json serves the manifest schema", async () => {
  const response = await router.fetch(
    new Request("http://localhost/schema/gamecenter.json"),
  );
  assertEquals(response.status, 200);
  assertStringIncludes(
    response.headers.get("content-type") ?? "",
    "application/schema+json",
  );
  // Fetched by editors and CI on any origin.
  assertEquals(response.headers.get("access-control-allow-origin"), "*");

  const schema = await response.json();
  assertEquals(schema.$id, "https://ga-cen.kbn.one/schema/gamecenter.json");
  assertEquals(schema.required, ["id", "author", "title", "achievements"]);
});

Deno.test("the internal API refuses a request with no DPoP proof", async () => {
  for (const path of ["/api/internal/games", "/api/internal/me/achievements"]) {
    const response = await router.fetch(new Request(`http://localhost${path}`));
    assertEquals(response.status, 401, path);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals((await response.json()).reason, "missing-dpop-header");
  }
});

Deno.test("the registry API asks for a url, not a credential", async () => {
  const response = await router.fetch(
    new Request("http://localhost/api/registry/v1/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  // 400 rather than 401: there is nothing to authenticate, only something to
  // read. What vouches for a registration is where the manifest was served
  // from.
  assertEquals(response.status, 400);
  assertStringIncludes((await response.json()).error, "url is required");
});

Deno.test("GET /@{handle} says so when the author is unknown", async () => {
  const response = await router.fetch(
    new Request("http://localhost/@nobody", {
      headers: { "rmx-frame": "1" },
    }),
  );
  assertEquals(response.status, 200);
  assertStringIncludes(await response.text(), "この作者は見つかりません");
});

Deno.test("approving a registration needs a session", async () => {
  for (const method of ["POST", "DELETE"]) {
    const response = await router.fetch(
      new Request("http://localhost/api/internal/registrations/1", { method }),
    );
    assertEquals(response.status, 401, method);
  }
});

Deno.test("the internal API still needs a session to register anything", async () => {
  const response = await router.fetch(
    new Request("http://localhost/api/internal/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.github.io/my-puzzle/" }),
    }),
  );
  assertEquals(response.status, 401);
});

Deno.test("GET / serves the catalog with nothing in it", async () => {
  const response = await router.fetch(
    new Request("http://localhost/", { headers: { "rmx-frame": "1" } }),
  );
  const html = await response.text();
  // No database in the unit tests, so the catalog is empty rather than broken.
  assertStringIncludes(html, "まだゲームがありません");
});

Deno.test("GET /@{author}/{slug} says so when the game is unknown", async () => {
  const response = await router.fetch(
    new Request("http://localhost/@kuboon/nope", {
      headers: { "rmx-frame": "1" },
    }),
  );
  assertEquals(response.status, 200);
  assertStringIncludes(await response.text(), "ゲームが見つかりません");
});

Deno.test("GET /claim/... says so when the achievement is unknown", async () => {
  const response = await router.fetch(
    new Request("http://localhost/claim/@kuboon/nope/first_clear", {
      headers: { "rmx-frame": "1" },
    }),
  );
  assertEquals(response.status, 200);
  assertStringIncludes(await response.text(), "この実績は見つかりません");
});

Deno.test("the game API refuses a request with no launch token", async () => {
  const response = await router.fetch(
    new Request("http://localhost/api/game/v1/me"),
  );
  assertEquals(response.status, 401);
  assertStringIncludes((await response.json()).error, "launch token");
});

Deno.test("the game API says it cannot check tokens with no signing key", async () => {
  const response = await router.fetch(
    new Request("http://localhost/api/game/v1/unlock", {
      method: "POST",
      headers: {
        authorization: "Bearer not.a.token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ achievement: "first_clear" }),
    }),
  );
  // No signing key configured in the unit tests, so the hub says it cannot
  // check rather than pretending the token is merely wrong.
  assertEquals(response.status, 503);
});

Deno.test("the game API answers a preflight from any origin", async () => {
  const response = await router.fetch(
    new Request("http://localhost/api/game/v1/unlock", {
      method: "OPTIONS",
      headers: {
        origin: "https://example.github.io",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization",
      },
    }),
  );
  assertEquals(response.status, 204);
  assertEquals(response.headers.get("access-control-allow-origin"), "*");
  assertStringIncludes(
    response.headers.get("access-control-allow-headers") ?? "",
    "authorization",
  );
});

Deno.test("the game API's errors are readable cross-origin too", async () => {
  const response = await router.fetch(
    new Request("http://localhost/api/game/v1/achievements"),
  );
  assertEquals(response.status, 401);
  // Without this a game cannot read its own 401 and know to fall back.
  assertEquals(response.headers.get("access-control-allow-origin"), "*");
});

Deno.test("the internal API keeps CORS off, even next to the game API", async () => {
  const response = await router.fetch(
    new Request("http://localhost/api/internal/me/achievements", {
      headers: { origin: "https://example.github.io" },
    }),
  );
  assertEquals(response.status, 401);
  assertEquals(response.headers.get("access-control-allow-origin"), null);
});

Deno.test("GET /play/... says so when the game is unknown", async () => {
  const response = await router.fetch(
    new Request("http://localhost/play/@kuboon/nope", {
      headers: { "rmx-frame": "1" },
    }),
  );
  assertEquals(response.status, 200);
  assertStringIncludes(await response.text(), "ゲームが見つかりません");
});
