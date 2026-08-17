import { assertEquals } from "@std/assert";

import { splitStatements } from "./sql_script.ts";

Deno.test("splits on semicolons and trims", () => {
  assertEquals(
    splitStatements(
      "create table a (id integer);\n\ninsert into a values (1);\n",
    ),
    ["create table a (id integer)", "insert into a values (1)"],
  );
});

Deno.test("keeps a trailing statement without a semicolon", () => {
  assertEquals(splitStatements("select 1"), ["select 1"]);
});

Deno.test("ignores semicolons inside string literals", () => {
  assertEquals(
    splitStatements("insert into a values ('x; y'); select 1;"),
    ["insert into a values ('x; y')", "select 1"],
  );
});

Deno.test("keeps doubled quotes inside a literal", () => {
  assertEquals(
    splitStatements("insert into a values ('it''s; fine');"),
    ["insert into a values ('it''s; fine')"],
  );
});

Deno.test("ignores semicolons inside quoted identifiers", () => {
  assertEquals(
    splitStatements(`create table "od;d" (id integer);`),
    [`create table "od;d" (id integer)`],
  );
});

Deno.test("drops line comments, including ones holding a semicolon", () => {
  assertEquals(
    splitStatements(
      "-- a; comment\ncreate table a (id integer); -- trailing;\n",
    ),
    ["create table a (id integer)"],
  );
});

Deno.test("drops block comments", () => {
  assertEquals(
    splitStatements("/* a;\n b */ select 1; /* tail */"),
    ["select 1"],
  );
});

Deno.test("returns nothing for a comment-only script", () => {
  assertEquals(splitStatements("-- nothing here\n\n"), []);
});
