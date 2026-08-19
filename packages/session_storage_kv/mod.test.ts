import { assertEquals } from "@std/assert";
import { createSession } from "@remix-run/session";
import { MemoryKvRepo } from "@kuboon/kv/memory.ts";
import type { Session } from "@remix-run/session";

import { createKvSessionStorage } from "./mod.ts";

const storage = () =>
  createKvSessionStorage(new MemoryKvRepo<Session["data"]>(["session"]));

Deno.test("reads back what it saved", async () => {
  const kv = storage();
  const session = createSession("abc");
  session.set("userId", "u1");
  await kv.save(session);

  const restored = await kv.read("abc");
  assertEquals(restored.get("userId"), "u1");
});

Deno.test("returns an empty session for an unknown id", async () => {
  const restored = await storage().read("nobody");
  assertEquals(restored.get("userId"), undefined);
});

Deno.test("returns an empty session when the id is null", async () => {
  const restored = await storage().read(null);
  assertEquals(restored.get("userId"), undefined);
});

Deno.test("skips the write when nothing changed", async () => {
  const kv = storage();
  assertEquals(await kv.save(createSession("clean")), null);
});

Deno.test("destroying a session clears the stored data", async () => {
  const kv = storage();
  const session = createSession("gone");
  session.set("userId", "u1");
  await kv.save(session);

  const loaded = await kv.read("gone");
  loaded.destroy();
  assertEquals(await kv.save(loaded), "");

  assertEquals((await kv.read("gone")).get("userId"), undefined);
});
