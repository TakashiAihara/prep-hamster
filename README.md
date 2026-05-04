# prep-hamster

備蓄管理アプリ。家庭・複数世帯で在庫（場所・数・消費期限・賞味期限）を共有管理する。

## ドキュメント

- 流動ドキュメント（要件・設計）: [`docs/flow/v1.0.0/`](docs/flow/v1.0.0/)
    - [requirements.md](docs/flow/v1.0.0/requirements.md) — 要件定義（Why / What）
    - [screen-flow.md](docs/flow/v1.0.0/screen-flow.md) — 画面・操作フロー
    - [data-model.md](docs/flow/v1.0.0/data-model.md) — データモデル
    - [jan-api-candidates.md](docs/flow/v1.0.0/jan-api-candidates.md) — JAN API 候補比較
    - [tech-stack.md](docs/flow/v1.0.0/tech-stack.md) — 採用技術
- 恒久ドキュメント: [`docs/stock/`](docs/stock/)
    - [glossary.md](docs/stock/glossary.md) — 用語集
    - [roles.md](docs/stock/roles.md) — ロール定義
    - [operational-policy.md](docs/stock/operational-policy.md) — 運用ポリシー

## ワークスペース構成

```
apps/
├── administrator/
│   └── client/
│       ├── web/                # 管理者向け Web
│       └── cli/                # 管理者向け CLI
├── user/
│   └── client/
│       ├── mobile/             # ユーザー向けモバイル
│       └── cli/                # ユーザー向け CLI
└── core/
    └── api/                    # バックエンド API
packages/
├── schema/        # Zod スキーマ + 型定義（単一の真実の源）
├── db/            # DB スキーマ・マイグレーション
├── api-client/    # 型付き API クライアント
├── jan-api/       # 外部 JAN API クライアント
└── sync/          # 同期・競合解決ロジック
```

## セットアップ

[mise](https://mise.jdx.dev/) で Bun / Node のバージョンを揃える前提。

```sh
mise install
bun install
```

`bun install` で [lefthook](https://lefthook.dev/) の git hook が自動セットアップされる（`commit-msg` でコミットメッセージを Conventional Commits 形式かチェック）。

- 個別 commit で hook をスキップ: `LEFTHOOK=0 git commit -m "..."`
- CI 中（`CI=true`）は lefthook が自動で skip するため何もしなくてよい

## ローカル DB（Supabase + Drizzle）

ローカル環境では Supabase CLI で Postgres / Auth / Storage を Docker で立て、Drizzle がスキーママイグレーションを管理する。

```sh
# Supabase ローカルスタックを起動（postgres は :54322）
bunx supabase start

# Drizzle スキーマからマイグレーション SQL を生成
bun run --filter @prep-hamster/db db:generate

# 生成済みマイグレーションをローカル Postgres に適用
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  bun run --filter @prep-hamster/db db:migrate
```

Supabase ローカルスタックの停止: `bunx supabase stop`
