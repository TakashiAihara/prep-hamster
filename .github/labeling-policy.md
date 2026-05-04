# GitHub Label Policy

## Overview

GitHub Issue / PR label naming conventions and usage rules for the prep-hamster repository. Mirrors `micoworks/delivery-foundation` のラベル体系を採用しつつ、本リポ固有のニーズに合わせて `needs/coderabbit-review` を追加。

## Principles

1. ラベルは `prefix/name` 形式を標準とする
2. 自動付与（`changed/`）と手動付与（`scope/`, `type/`, `priority/`, `effort/`, `needs/`, `status/`）を prefix で明確に分離
3. CI / CodeRabbit / GitHub default 等の例外ラベルは末尾セクションに明記する
4. 命名規約に合わない既存ラベルは `prefix/name` に rename する（rename は Issue/PR の関連を保つ）

## Label Prefixes

### `changed/` -- Automated (PR only)

`actions/labeler` が変更ファイルパスから自動付与する。**手動で付けない。**

ラベル名はディレクトリ構造をそのままミラーする（新パッケージ追加時の判断を機械化するため）。

| Label | Trigger path |
|---|---|
| `changed/apps/core/api` | `apps/core/api/**` |
| `changed/apps/user/client/cli` | `apps/user/client/cli/**` |
| `changed/apps/user/client/mobile` | `apps/user/client/mobile/**` |
| `changed/apps/administrator/client/cli` | `apps/administrator/client/cli/**` |
| `changed/apps/administrator/client/web` | `apps/administrator/client/web/**` |
| `changed/packages/schema` | `packages/schema/**` |
| `changed/packages/db` | `packages/db/**` |
| `changed/packages/api-client` | `packages/api-client/**` |
| `changed/packages/jan-api` | `packages/jan-api/**` |
| `changed/packages/sync` | `packages/sync/**` |
| `changed/docs` | `docs/**` |
| `changed/ci` | `.github/**` |
| `changed/docker` | `Dockerfile`, `compose.yaml`, `compose.*.yaml`, `.dockerignore`, `apps/**/Dockerfile`, `apps/**/.dockerignore` |
| `changed/supabase` | `supabase/**` |
| `changed/build` | `turbo.json`, `tsconfig.base.json`, root `package.json`, `bun.lock`, `.mise.toml` |

新パッケージ追加時はこの表に行を追加し、同時に `.github/labeler.yml` も更新する。命名は `changed/` + リポルートからの相対パス。

### `scope/` -- Manual (Issue)

影響範囲を示す。本リポは個人開発だが、将来チーム運用を考慮して prefix 体系は揃える。

| Label | Description |
|---|---|
| `scope/apps` | apps/ 配下のアプリケーション |
| `scope/infrastructure` | CI / Docker / Cloud Run / Supabase / 設定ファイル |
| `scope/packages` | packages/ 配下の共通パッケージ |

### `type/` -- Manual (Issue / PR)

変更や課題の種類を示す。**Conventional Commits の type と 1:1 対応**。

| Label | Conventional Commits | Description |
|---|---|---|
| `type/bug` | `fix:` | バグ修正 |
| `type/enhancement` | `feat:` | 新機能・機能改善 |
| `type/refactoring` | `refactor:` | 振る舞いを変えないリファクタ |
| `type/tech-debt` | `refactor:` / `chore:` | 設計・アーキ負債、より広範な書き換え |
| `type/documentation` | `docs:` | ドキュメント変更 |
| `type/chore` | `chore:` | ビルド / CI / tooling / 設定の変更 |
| `type/test` | `test:` | テストの追加・修正 |

### `priority/` -- Manual (Issue)

トリアージ用の緊急度。将来 GitHub Projects のカスタムフィールドに移行する可能性あり。

| Label | Description |
|---|---|
| `priority/critical` | 即時対応必須 |
| `priority/high` | 現在のスプリントで対応 |
| `priority/medium` | 近いうちに対応 |
| `priority/low` | バックログ、余裕があるとき |

### `needs/` -- Manual (Issue / PR)

着手・マージの前提が欠けていることを示す。`status/`（現在の状態）と異なり、`needs/` は **次に進むために必要なもの** を表す。

| Label | Description |
|---|---|
| `needs/reproduction` | 再現手順が報告者から必要 |
| `needs/information` | 追加のコンテキスト・詳細が必要 |
| `needs/investigation` | 計画前に技術調査が必要 |
| `needs/coderabbit-review` | **本リポ固有**: CodeRabbit のレビューを必ず一度は通してからマージする |

#### `needs/coderabbit-review` の運用

本リポは OSS free tier で CodeRabbit を使用しており、レビューに 1/h の rate limit がある。通常はベストエフォートで運用するが、**重要な PR では必ずレビューを通したい**。それを明示するためのラベル。

**付与基準（目安）**:
- 機能実装系（`type/enhancement`）の PR / Issue
- インフラ / セキュリティ影響あり（Dockerfile, compose, DB schema, RLS 関連）
- ライブラリの major bump（Bun, Hono, Drizzle, Zod 等の major version 上げ）
- 本番デプロイ周り（Cloud Run workflow, secret 管理）
- 設計判断が大きい PR（OpenAPI ライブラリ採用、typescript-go への切替 等）

**付与しない目安**:
- 単純な docs 更新
- 1 ヶ所の typo 修正
- 自動生成ファイル（drizzle migration, lockfile）の更新のみ

**運用ルール**:
1. 該当 PR で CodeRabbit が `Review skipped` / rate limit hit になった場合、**マージしない**
2. 45 分以上待ってから `@coderabbitai review` をコメント投稿して再レビュー
3. レビュー結果を反映 / resolve してからマージ

### `status/` -- Manual (PR)

GitHub の draft / ready 機構を超えた PR の状態を示す。

| Label | Description |
|---|---|
| `status/blocked` | 外部依存でブロック |
| `status/in-progress` | 作業中（draft ではないが完了でもない） |
| `status/needs-testing` | 手動 / 環境テスト待ち |

### `effort/` -- Manual (Issue)

実装コストの見積もり。スプリント計画 / トリアージで使う。

| Label | Description |
|---|---|
| `effort/small` | 数時間。1 ファイル or 軽微な設定変更 |
| `effort/medium` | 1-2 日。複数ファイル、ある程度のテストが必要 |
| `effort/large` | 3 日以上。設計判断、横断的変更、まとまった検証が必要 |

## Exceptions

`prefix/name` 規約に従わないラベル。外部ツール管理、または GitHub 標準のトリアージ用途。

### Dependency management

- `dependencies` -- Dependabot が PR に自動付与

### CodeRabbit (将来追加される可能性)

- `can-close` / `needs-action` / `needs-review` 等 -- delivery-foundation で使用例あり、本リポでは未導入

### GitHub default (triage)

GitHub の組み込みラベル。標準トリアージワークフロー用に維持。

- `duplicate`
- `invalid`
- `wontfix`
- `good first issue`
- `help wanted`
- `question`

## Operations

### 新ラベルの追加

1. 本ドキュメントの該当 prefix セクションの表に追加
2. `gh label create "prefix/name" --color "<hex>" --description "..."` で実体を作成
3. `changed/` 系の場合は `.github/labeler.yml` にも対応する glob ルールを追加

### `changed/` ラベルの色

`#bfdadc`（明るいティール）で統一。ディレクトリミラーなので個別に色を変えない。

### `scope/` / `priority/` / `needs/` 等の色

| Prefix | Color | 意図 |
|---|---|---|
| `scope/*` | `#c5def5` | 中立的な情報ラベル |
| `type/bug` | `#d73a4a` | GitHub default 維持 |
| `type/enhancement` | `#a2eeef` | GitHub default 維持 |
| `type/documentation` | `#0075ca` | GitHub default 維持 |
| `type/refactoring` | `#fbca04` | 注意喚起 |
| `type/tech-debt` | `#f9a825` | 注意喚起（より濃い） |
| `type/chore`, `type/test` | `#ededed` | グレー（軽微変更） |
| `priority/critical` | `#b60205` | 強い赤 |
| `priority/high` | `#d93f0b` | オレンジ |
| `priority/medium` | `#fbca04` | 黄色 |
| `priority/low` | `#0e8a16` | 緑 |
| `needs/*`（投資情報系） | `#f9d0c4` | 桃色 |
| `needs/coderabbit-review` | `#ff9966` | 桃色より濃いオレンジ（区別用） |
| `effort/small/medium/large` | `#bfd4f2` / `#d4c5f9` / `#7057ff` | 紫グラデ |
| `status/blocked` | `#b60205` | 強い赤 |
| `status/in-progress`, `status/needs-testing` | `#fbca04` | 黄色 |

## Related Files

- `.github/labeler.yml` -- `actions/labeler` のルール定義（`changed/` ラベルと同期させる）
- `.github/workflows/labeler.yml` -- `pull_request_target` で labeler を起動する workflow
- `.github/PULL_REQUEST_TEMPLATE.md` -- PR 作成時に `needs/coderabbit-review` 付与判定のチェック欄を含める（後続改善）
