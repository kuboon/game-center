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

## 初回は承認待ちで止まる

初回の push では `202` が返り、`status` 出力が `pending` になる。
**ジョブは緑になるが、ゲームはまだ登録されていない。**

新しいゲームは、名指しされた作者が `https://ga-cen.kbn.one/dev`
で一度だけ承認するまで登録されない。
マニフェストに名前を書くのは誰にでもできるので、
名指しされた本人の同意が揃って初めて登録が成立する。

ここで CI
を赤くすると、何も間違っていないのに新しいゲームの最初の一回が必ず落ちる。
そこで失敗にはせず、代わりにジョブのサマリに承認ページへのリンクを出す。
緑のまま何も起きていない、という状態が黙って通り過ぎないようにするため。

承認は最初の一度きりで、以後その URL からの push はそのまま通る(`200` /
`status=updated`)。

マニフェストが不正なときは全件がアノテーションとして出て、ジョブが落ちる。

詳細は [プロトコル](../docs/protocol.md)。
