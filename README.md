# prep-hamster

備蓄管理アプリ。家庭・複数世帯で在庫（場所・数・消費期限・賞味期限）を共有管理する。

## ドキュメント

- 流動ドキュメント（要件・設計）: [`docs/flow/v1.0.0/`](docs/flow/v1.0.0/)
  - [requirements.md](docs/flow/v1.0.0/requirements.md) — 要件定義（Why / What）
  - [screen-flow.md](docs/flow/v1.0.0/screen-flow.md) — 画面・操作フロー
  - [data-model.md](docs/flow/v1.0.0/data-model.md) — データモデル
  - [jan-api-candidates.md](docs/flow/v1.0.0/jan-api-candidates.md) — JAN API 候補比較
  - [tech-stack.md](docs/flow/v1.0.0/tech-stack.md) — 採用技術
- アーキテクチャ図 (LikeC4): [`docs/architecture/`](docs/architecture/)
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

## 型チェック (typescript-go / tsgo)

`bun run typecheck` は [`@typescript/native-preview`](https://www.npmjs.com/package/@typescript/native-preview) (tsgo) を使用する。Go 製の TypeScript コンパイラで、型チェック (`--noEmit`) において本家 `tsc` の代替として機能する（LSP / emit など他のパスは未対応または進行中）。

役割分担:

- **CLI 型チェック**: `tsgo --noEmit`（速度優先、CI / `bun run typecheck` で使用）
- **IDE 言語サーバー**: 本家 `tsc`（`typescript@^5.7` を devDep に維持）。tsgo は LSP の機能パリティが未完成のため

切替対象は v1.0.0 では `--noEmit` のみ。`declaration` / `declarationMap` / `incremental` などの emit パスは tsgo 側でまだ「進行中」とされているため、必要になったら再評価する。

## ローカルで API を Docker で動かす

API を本番（Cloud Run）に近い環境で確認したい時 / Hot reload で開発したい時の 2 モードを用意している。
DB は引き続き Supabase CLI（host 上の `:54322`）に接続する前提。

### 前提

- `bunx supabase start` で Postgres が起動済み
- Linux の素の Docker daemon を使う場合、`host.docker.internal` 解決のため `compose.yaml` の `extra_hosts` を入れている。Docker Desktop / WSL では自動で解決される。

### dev プロファイル（hot reload）

ソースを bind mount し、コンテナ内で `bun install` → `bun --watch` で起動する。

```sh
docker compose --profile dev up
```

- `localhost:3000` で API、`/health` が 200 を返せば疎通
- `node_modules` は named volume (`api_node_modules`) に隔離して host の OS 差分を回避
- 認証は既定で手元の `bunx supabase start` を見る。Supabase の project に向けるときは `SUPABASE_URL` と `SUPABASE_JWT_ISSUER` (`<project の URL>/auth/v1`) の両方を env で渡す。片方だけだと token の `iss` が合わず全リクエストが 401 になる

### prod プロファイル（本番再現）

`apps/core/api/Dockerfile` をビルドして、非 root ユーザーで起動する。

```sh
docker compose --profile prod up --build
```

- 同じ Dockerfile が将来 Cloud Run へのデプロイにも使われる
- `HEALTHCHECK` で `/health` を 30s ごとに監視

### 動作確認

```sh
# 別ターミナルから
curl -s http://localhost:3000/health
# → {"ok":true}

# CLI で叩く（PREP_HAMSTER_ACCESS_TOKEN は Supabase の access token。API は SUPABASE_URL で起動する）
PREP_HAMSTER_ACCESS_TOKEN=<access token> \
  bun run --filter @prep-hamster/cli-user start stock list
```

## 商品の写真 (Supabase Storage)

設計は `docs/design/item-photos.md`。写真は private bucket `item-photos` に置き、API だけが secret key で触る。

- API の runtime env に `SUPABASE_URL` と `SUPABASE_SECRET_KEY` を渡す (本番は Infisical の prep-hamster/prod の `PREP_HAMSTER_SUPABASE_SECRET_KEY`、手元は `bunx supabase status` の secret key)。値は repo に書かない。`SUPABASE_URL` は secret key を送る先なので https にする (手元の `localhost` / `127.0.0.1` / `host.docker.internal` だけ http でよく、それ以外の http は起動時にエラーで止まる)。無いと写真の一覧・アップロード・単体削除・カバー取得 (`/v1/items/**/photos` と `/v1/items/photos`) だけが 503 `PHOTO_STORAGE_NOT_CONFIGURED` になり、起動時に警告。item 自体の削除は Storage が無くても通る
- API が container の中にいて Storage に `host.docker.internal` で繋ぐ (compose) ときは、署名 URL の origin もそのホスト名になり、端末から開けない。`SUPABASE_PUBLIC_URL` に端末から届く origin (例: `http://<LAN の IP>:54321`) を渡すと、署名 URL の origin だけをそれに差し替える。API が Storage に繋ぐ先は変わらず、Auth の issuer にも触れないが出る
- 手元の bucket は `supabase/config.toml` の `[storage.buckets.item-photos]` が `bunx supabase start` で作る。名前・2 MiB・`image/jpeg` の定義は `apps/core/api/src/photos/config.ts` が出所で、`bun test src/photos` が `config.toml` との一致を見る
- 本番の bucket は migration では作らず、deploy の手順として 1 回流す (冪等。定義が変われば同じ手順で更新される):

```sh
inf-run --only SUPABASE_SECRET_KEY -- env SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co" bun run --filter @prep-hamster/api provision:photo-bucket
```

- `YOUR_PROJECT_REF` は本番の Supabase project の ref に置き換える (手元の URL ではない)
- 本物の Storage に対する確認は opt-in の e2e (`apps/core/api/e2e/photo-storage-real.test.ts`)。偽物の Storage が応答の形で分岐を押さえているので、その形が本物と同じことを見る。Storage を持つ Supabase (`bunx supabase start`。auth などは `-x` で外してよい) を立て、`PHOTO_STORAGE_TEST_URL` / `PHOTO_STORAGE_TEST_SECRET_KEY` (公開鍵での拒否も見るなら `PHOTO_STORAGE_TEST_ANON_KEY`) を渡して `bun run --filter @prep-hamster/api test:e2e` を流す。env が無ければ skip する
- 止まった upload の行 (pending のまま 20 分動きが無いもの) と、削除待ちの写真の object は定期ジョブが片付ける (冪等)。`DATABASE_URL` / `SUPABASE_URL` / `SUPABASE_SECRET_KEY` を渡して `bun run --filter @prep-hamster/api job:photo-sweep`。10 分ごとに回す (止まった pending の行は sweep が取るまで item の枚数の上限の枠を塞ぐので、1 日 1 回だと、失敗から 20 分の待機を過ぎた後の次の実行まで枠が残り、1 回の上限を超える件数があればさらに遅れる)
