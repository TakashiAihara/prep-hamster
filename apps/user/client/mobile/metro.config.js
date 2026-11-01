// Expo SDK 54 の既定が bun workspace (bunfig.toml の hoisted linker) の monorepo を扱う:
// watchFolders に workspace root、nodeModulesPaths に root の node_modules、package exports (hono/client 等) が既定で入る。
// SDK 52 で要った上書き (#98 / #99) は不要になったので持たない。
const { getDefaultConfig } = require("expo/metro-config")

module.exports = getDefaultConfig(__dirname)
