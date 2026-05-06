// Expo + Expo Router の最小 Babel 設定。
// preset 一発で transform / typed routes / metro 連携が揃う。

module.exports = function (api) {
  api.cache(true)
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "react" }]],
  }
}
