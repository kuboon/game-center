/**
 * Build `bundled/llms.txt` — the protocol and the SDK in one file.
 *
 * Most people writing a game against this are language models, and a model
 * that has to fetch four pages to get one answer will get some of them wrong.
 * So everything it needs arrives at once: the spec, the SDK it would otherwise
 * import, and a worked example.
 *
 * Generated rather than written, from `docs/protocol.md` and the SDK's own
 * source. A file that restates the specification is a file that will disagree
 * with it.
 */

const ROOT = new URL("../", import.meta.url);

/** Where the assembled file lands. `staticFiles` serves it at `/llms.txt`. */
const OUTPUT = new URL("bundled/llms.txt", ROOT);

const HEADER = `# game-center

ミニゲームの実績を集約するハブ。
このファイルは、ゲームを game-center に対応させるために必要なものを一つにまとめたものです。
プロトコルの仕様、SDK の全文、そして最小の実例が入っています。

- ハブ: https://ga-cen.kbn.one
- マニフェストの JSON Schema: https://ga-cen.kbn.one/schema/gamecenter.json
- この文書の生成元: docs/protocol.md と packages/sdk/mod.ts

作者 ID は、ハブにサインインして /me を開くと分かります。
そこから、この手順一式を ID 入りでコピーすることもできます。

---

`;

const EXAMPLE = `
---

# 最小の実例

外部スクリプトを読み込めない環境でも動く、HTML 一枚の形。

\`\`\`html
<!doctype html>
<meta charset="utf-8">
<title>My Puzzle</title>

<script type="application/gamecenter+json">
{
  "$schema": "https://ga-cen.kbn.one/schema/gamecenter.json",
  "id": "my-puzzle",
  "author": "<あなたの作者 ID>",
  "title": "My Puzzle",
  "achievements": [
    { "key": "first_clear", "title": "はじめてのクリア", "points": 10 }
  ]
}
</script>

<button id="clear">クリアした</button>
<div id="reward"></div>

<script type="module">
  const AUTHOR = "<あなたの作者 ID>";
  document.getElementById("clear").onclick = () => {
    // 勝手に開かず、押せるリンクとして出す
    const a = document.createElement("a");
    a.href = \\\`https://ga-cen.kbn.one/claim/@\\\${AUTHOR}/my-puzzle/first_clear\\\`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "実績を記録する";
    document.getElementById("reward").replaceChildren(a);
  };
</script>
\`\`\`

公開したら、その URL を登録します。

\`\`\`bash
curl -X POST https://ga-cen.kbn.one/api/registry/v1/games \\\\
  -H 'content-type: application/json' \\\\
  -d '{"url":"https://example.github.io/my-puzzle/"}'
\`\`\`

初回は 202 が返ります。作者がハブの /dev で承認すると登録が完了し、以後は同じ
コマンドで更新できます。
`;

/**
 * Assemble the file.
 *
 * @param write Set false to assemble without touching the filesystem
 * @returns The assembled text, and where it was written
 */
export async function buildLlmsTxt(
  { write = true }: { write?: boolean } = {},
): Promise<{ output: string; bytes: number; text: string }> {
  const protocol = await Deno.readTextFile(new URL("docs/protocol.md", ROOT));
  const sdk = await Deno.readTextFile(
    new URL("packages/sdk/mod.ts", ROOT),
  );

  const text = [
    HEADER,
    protocol,
    EXAMPLE,
    "\n---\n\n# SDK 全文\n\n" +
    "コピーして同梱してもかまいません。依存はありません。\n\n" +
    "```ts\n" + sdk + "```\n",
  ].join("");

  if (write) {
    await Deno.mkdir(new URL("bundled/", ROOT), { recursive: true });
    await Deno.writeTextFile(OUTPUT, text);
  }
  return { output: OUTPUT.pathname, bytes: text.length, text };
}
