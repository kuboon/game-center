# game-center 登録アクション

push のたびに、公開したゲームのマニフェストをハブに読み直させる。

```yaml
# ゲームのリポジトリ .github/workflows/register.yaml
on:
  push: { branches: [main] }

jobs:
  register:
    runs-on: ubuntu-latest
    steps:
      - uses: kuboon/game-center/action@v1
        with:
          url: https://example.github.io/my-puzzle/
```

**secret は無い。checkout も要らない。** このアクションがすることは「この URL
を読み直せ」と伝えることだけで、検証も帰属の判定もハブ側で行われる。

初回の push では `202` が返り、`status` 出力が `pending` になる。
これは失敗ではない。
新しいゲームは作者がハブで一度だけ承認する必要があり、そこで CI
を赤くすると、何も間違っていないのに最初の一回が必ず落ちることになる。

マニフェストが不正なときは全件がアノテーションとして出て、ジョブが落ちる。

詳細は [プロトコル](../docs/protocol.md)。
