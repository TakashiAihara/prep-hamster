// Monorepo (bun workspace) 用 Metro 設定。
//
// ## なぜ必要か
//
// bun workspace では package の実体が下記のいずれかに置かれる:
//   - `<workspaceRoot>/node_modules/<pkg>` (hoisted layout: bunfig.toml で指定)
//   - `<package>/node_modules/<pkg>` (workspace package 直下)
//
// Metro の resolver は標準で **packageRoot/node_modules** しか辿らないため、
// workspace root の hoisted package が見えない。watch も packageRoot 配下に
// 限定されるので workspace 内の `packages/*` 変更が反映されない。
//
// 本ファイルで:
//   - `watchFolders` に workspace root を追加 (workspace package の更新を拾う)
//   - `nodeModulesPaths` に workspace root の `node_modules` を追加 (transitive 解決)
//   - `disableHierarchicalLookup` を有効化 (`<package>/node_modules` の暴走を防ぐ)
//
// 関連 Issue: #98
const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

const projectRoot = __dirname
// apps/user/client/mobile -> repo root は 4 階層上
const workspaceRoot = path.resolve(projectRoot, "../../../..")

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
]
config.resolver.disableHierarchicalLookup = true

// hono など `exports` field のみ持つパッケージ (`hono/client` 等のサブパス export)
// を Metro 標準では解決できないため enable する。
// React Native 0.79+ ではこれが default になる予定だが、SDK 52 (RN 0.76) では opt-in。
config.resolver.unstable_enablePackageExports = true

module.exports = config
