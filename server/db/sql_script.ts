/**
 * Splitting a `.sql` migration file into individual statements.
 *
 * The migration runner needs one statement per `execute()` call so it can run a
 * whole migration inside a transaction — `executeMultiple()` takes a script but
 * is not transactional. Splitting on `;` alone would break as soon as a
 * semicolon appears inside a string literal or a comment, so the scanner below
 * tracks those states.
 *
 * Compound statements (`create trigger ... begin ... end;`) are NOT supported:
 * their inner semicolons would split the statement apart. Migrations that need
 * one have to run through `executeMultiple()` instead.
 */

/**
 * Split a SQL script into trimmed statements, dropping comments and empty
 * fragments.
 *
 * @param script Contents of a `.sql` file
 * @returns The statements, in source order, without their trailing `;`
 */
export function splitStatements(script: string): string[] {
  const statements: string[] = [];
  let current = "";

  for (let i = 0; i < script.length; i++) {
    const char = script[i];
    const next = script[i + 1];

    if (char === "-" && next === "-") {
      const end = script.indexOf("\n", i);
      i = end === -1 ? script.length : end;
      current += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      const end = script.indexOf("*/", i + 2);
      i = end === -1 ? script.length : end + 1;
      current += " ";
      continue;
    }

    if (char === "'" || char === '"') {
      const literal = readQuoted(script, i, char);
      current += literal;
      i += literal.length - 1;
      continue;
    }

    if (char === ";") {
      pushStatement(statements, current);
      current = "";
      continue;
    }

    current += char;
  }

  pushStatement(statements, current);
  return statements;
}

/**
 * Read a quoted literal starting at `start`, including both quotes. A doubled
 * quote (`''`) escapes one inside the literal, as in standard SQL. An unclosed
 * literal runs to the end of the script — the database rejects it, which is a
 * better error than silently splitting mid-literal.
 */
function readQuoted(script: string, start: number, quote: string): string {
  let i = start + 1;
  while (i < script.length) {
    if (script[i] !== quote) {
      i++;
      continue;
    }
    if (script[i + 1] === quote) {
      i += 2;
      continue;
    }
    return script.slice(start, i + 1);
  }
  return script.slice(start);
}

function pushStatement(statements: string[], statement: string): void {
  const trimmed = statement.trim();
  if (trimmed) statements.push(trimmed);
}
