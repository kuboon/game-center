# game-center

ユーザが様々なミニゲームで獲得した実績を一元管理するサービス。
ゲーム本体は第三者(主に LLM によるバイブコーディング)が開発し、GitHub Pages や Claude Artifacts で公開される。
このリポジトリはハブサイト、通信プロトコル、開発者向けドキュメント(llms.txt / skill)、ゲーム自動登録用の GitHub Action を提供する。

設計の全体像は [docs/grand_design.md](docs/grand_design.md) を参照。

## Stack

- Deno + Remix v3 (`@remix-run/fetch-router`)
- Tailwind CSS v4 + daisyUI
- Turso (libsql)
- 認証: id.kbn.one
