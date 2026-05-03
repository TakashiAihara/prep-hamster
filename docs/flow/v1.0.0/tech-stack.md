# 採用技術 v1.0.0

> 各 app / package で採用する技術スタックの記録。flow 扱い（バージョン・ライブラリ採用は更新されうる）。
> 詳細な依存（具体バージョン）は各ワークスペースの `package.json` を正とする。本書は **What を採用したか / なぜか** を残す。

## 1. ランタイム・基盤

| 項目             | 採用                                        | 理由                                                      |
| ---------------- | ------------------------------------------- | --------------------------------------------------------- |
| パッケージマネージャ | Bun（workspaces）                           | 単一バイナリで TS 直実行。CLAUDE.md の第一選択方針に整合 |
| ランタイム管理   | mise（`.mise.toml`）                        | Bun / Node のバージョン固定                               |
| 言語             | TypeScript                                  | 全ワークスペース共通                                      |
| TS 設定          | `tsconfig.base.json` を全 workspace で extend | strict + verbatimModuleSyntax + exactOptionalPropertyTypes |

## 2. apps/core/api（バックエンド）

| 項目                 | 採用                          | 理由                                                                |
| -------------------- | ----------------------------- | ------------------------------------------------------------------- |
| HTTP フレームワーク  | Hono on Bun                   | Bun 親和性が高い・型推論が強い・軽量                                |
| ORM                  | Drizzle (postgres-js)         | Bun ネイティブサポート・SQL ファースト・型推論                      |
| バリデーション       | Zod                           | エコシステム最大・`packages/schema` と共有                          |
| バックエンド基盤     | Supabase                      | Postgres + Auth + Storage + Realtime をマネージドで利用             |
| ローカル開発環境     | Supabase CLI（Docker）        | 本番と同じスタックをローカルでも起動。`supabase start` で立ち上がる |
| マイグレーション管理 | Drizzle (`drizzle-kit`)       | スキーマ → SQL 生成 → ローカル/本番に適用。`packages/db/drizzle/`   |
| 認証                 | Supabase Auth                 | パスワード + OAuth + magic link を提供                              |

## 3. apps/administrator/client/web（管理者向け Web）

| 項目                 | 採用                                        | 理由                                                                       |
| -------------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| メタフレームワーク   | TanStack Start（Vite ベース）               | 型安全な router + server functions。管理画面に必要十分でモダン             |
| UI コンポーネント    | shadcn/ui（Radix + Tailwind CSS）           | コピペ式で取り回しやすく、デザインを直接コントロールできる                |
| サーバ状態管理       | TanStack Query                              | キャッシュ・楽観更新・再フェッチが堅牢                                     |
| クライアント状態管理 | Zustand                                     | UI ステートの局所管理に軽量で十分                                          |
| ルーティング         | TanStack Router                             | TanStack Start に同梱。型安全な routing                                    |
| バンドラ             | Vite                                        | TanStack Start の基盤                                                      |

## 4. apps/user/client/mobile（ユーザー向けモバイル）

| 項目                 | 採用                          | 理由                                                                  |
| -------------------- | ----------------------------- | --------------------------------------------------------------------- |
| プラットフォーム     | Expo（Managed）               | iOS / Android 同時対応・OTA 更新・`expo-camera` 等のモジュール充実    |
| バーコード読取       | `expo-camera` / barcode 系    | Expo 標準の枯れた実装。JAN（EAN-13）対応                              |
| サーバ状態管理       | TanStack Query                | Web と同一ライブラリで知見・コードを共有                              |
| クライアント状態管理 | Zustand                       | Web と同一ライブラリ                                                  |
| ナビゲーション       | Expo Router                   | Expo 標準のファイルベース routing                                     |
| スタイリング         | NativeWind（要検討）          | Tailwind ライクな記法を RN で利用可。Web の shadcn と DSL を揃えやすい |

## 5. CLI（管理者向け / ユーザー向けの 2 系統）

配置:
- `apps/administrator/client/cli` — 管理者向け（グループ運用・一括操作・運用バッチ呼び出し等）
- `apps/user/client/cli` — エンドユーザー向け（自身が所属するグループの import / export / スクリプト連携）

両 CLI は共通基盤を可能な限り共有する想定（`packages/api-client` / `packages/schema` を流用）。

| 項目         | 採用                | 理由                                                |
| ------------ | ------------------- | --------------------------------------------------- |
| ランタイム   | Bun                 | TS 直実行・配布も Bun の `bun build --compile` 可  |
| CLI フレームワーク | 未確定（commander or citty）| `mfme-cli` での実績は要確認。citty の方がモダン |
| 出力規約     | 既定 stdout 人間可読 / `--json` で JSON / ログは stderr | mfme-cli 等の自作 CLI と揃える |

## 6. packages/

| パッケージ          | 採用ライブラリ・役割                                                                |
| ------------------- | ----------------------------------------------------------------------------------- |
| `packages/schema`   | Zod スキーマ。User / Group / Stock / StockEvent / ProductMaster 等の型を定義        |
| `packages/db`       | Drizzle スキーマ + マイグレーション。`schema` の型と紐付ける                        |
| `packages/api-client` | Hono の `hc<typeof app>` から型推論したクライアント。web / mobile / cli が共有     |
| `packages/jan-api`  | Yahoo!ショッピング商品検索 / 楽天商品検索のクライアント。`ProductMaster` を返す抽象 |
| `packages/sync`     | LWW・OutboxOperation・競合解決。クライアント側のオフライン対応で利用                |

## 7. 横断の開発体験

| 項目                 | 採用                                         | 理由                                              |
| -------------------- | -------------------------------------------- | ------------------------------------------------- |
| Lint / Format        | Biome（候補）                                | ESLint + Prettier 兼用で高速。モダン路線に合致    |
| テスト               | bun test（バックエンド・packages） + Vitest（Web）| Bun テストランナーが速い。Web は Vite と統合      |
| モノレポビルド       | 必要時に Turborepo / Nx を検討（v1.0.0 では未導入）| 起動コストが小さいうちは bun --filter で十分     |

## 8. 未確定事項

- Supabase Auth と `users` テーブルの統合方針（`auth.users` を直接参照するか、`public.users` でミラーするか）。
- RLS ポリシー設計（グループ単位の論理分離をどう Postgres レベルで強制するか）。
- CLI フレームワーク（commander vs citty）の最終決定。
- NativeWind 採用可否（モバイルの DX は良いが導入トラブルの実績次第）。
- Lint/Format に Biome を採用するか Prettier+ESLint のままか。

---

## ステータス・更新履歴
- 2026-05-03: 初版作成。Expo / TanStack Start + shadcn + TanStack Query + Zustand / Hono on Bun / Drizzle / Zod を確定。
- 2026-05-03: CLI を `apps/administrator/client/cli` と `apps/user/client/cli` の 2 系統に確定。
- 2026-05-03: バックエンド基盤を Supabase に確定。ローカル開発は Supabase CLI（Docker）。マイグレーションは Drizzle が管理。
