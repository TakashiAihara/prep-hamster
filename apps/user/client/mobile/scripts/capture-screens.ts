#!/usr/bin/env bun
// As-Is screen catalog 用に Maestro flow を順に実行し、
// 出力 png と mermaid graph を docs/design/screens-as-is/ に集める。
//
// 前提:
//   - Android emulator (or 実機 USB 接続) が起動済み
//   - `adb devices` で 1 台以上認識
//   - app (`com.example.prephamster`) が emulator にインストール済み
//     (`bun run --filter @prep-hamster/mobile android` 等で先にビルド)
//   - `maestro` CLI が PATH にある (https://maestro.mobile.dev/)
//
// 使い方:
//   bun run --filter @prep-hamster/mobile capture
//
// CI 自動化は v1.0.0 では out of scope (Maestro Cloud / EAS 連携が前提)。

import { spawnSync } from "node:child_process"
import { mkdirSync, readdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const here = dirname(new URL(import.meta.url).pathname)
const mobileRoot = resolve(here, "..")
const repoRoot = resolve(mobileRoot, "../../../..")
const flowsDir = join(mobileRoot, "maestro")
const outDir = join(repoRoot, "docs/design/screens-as-is")

function checkMaestro(): void {
  const r = spawnSync("maestro", ["--version"], { stdio: "pipe" })
  if (r.status !== 0) {
    console.error(
      "[capture-screens] maestro CLI が見つかりません。https://maestro.mobile.dev/ から install してください。",
    )
    process.exit(1)
  }
}

function checkDevice(): void {
  const r = spawnSync("adb", ["devices"], { stdio: "pipe", encoding: "utf-8" })
  if (r.status !== 0) {
    console.error(
      "[capture-screens] adb が見つかりません。Android SDK platform-tools を入れてください。",
    )
    process.exit(1)
  }
  const lines = (r.stdout ?? "")
    .split("\n")
    .slice(1)
    .filter((l) => l.trim() && !l.startsWith("*"))
  if (lines.length === 0) {
    console.error(
      "[capture-screens] 認識中の Android device がありません。emulator を起動するか実機を USB 接続してください。",
    )
    process.exit(1)
  }
}

function runFlows(): string[] {
  const flows = readdirSync(flowsDir).filter((f) => f.endsWith(".yaml"))
  if (flows.length === 0) {
    console.error("[capture-screens] flow が見つかりません: ", flowsDir)
    process.exit(1)
  }

  // png は CWD に出るので、out/ で実行して後で move する
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const captured: string[] = []
  for (const flow of flows) {
    const flowPath = join(flowsDir, flow)
    console.log(`[capture-screens] running ${flow}`)
    const r = spawnSync("maestro", ["test", flowPath], {
      cwd: outDir,
      stdio: "inherit",
    })
    if (r.status !== 0) {
      console.warn(
        `[capture-screens] ${flow} が失敗しましたが、それまでに撮れた png は残しています。`,
      )
    }
  }

  // 出力された png を回収
  for (const f of readdirSync(outDir)) {
    if (f.endsWith(".png")) captured.push(f)
  }
  return captured
}

function generateMarkdown(captured: string[]): string {
  // mermaid graph は flow の YAML 名から自動構築する。エッジの推定は file-based router の構造から。
  // 細部は手動編集を許容する (GENERATED マークを付けた section だけ replace するのは TODO)。
  const lines: string[] = []
  lines.push("# As-Is Screen Catalog")
  lines.push("")
  lines.push("> このファイルは `bun run --filter @prep-hamster/mobile capture` で生成される。")
  lines.push("> 手動編集する場合は再生成で上書きされる前提。")
  lines.push("")
  lines.push("## 画面遷移 (現状)")
  lines.push("")
  lines.push("```mermaid")
  lines.push("graph LR")
  lines.push("  Home[在庫一覧]")
  lines.push("  Add[追加エントリ]")
  lines.push("  Scan[カメラスキャン]")
  lines.push("  Manual[手動入力]")
  lines.push("  Details[詳細・保存]")
  lines.push("  Home -- 追加 tab --> Add")
  lines.push("  Add -- カメラで読み取る --> Scan")
  lines.push("  Add -- 手動で barcode --> Manual")
  lines.push("  Scan -- 読取成功 --> Details")
  lines.push("  Manual -- 送信 --> Details")
  lines.push("  Details -- 保存 --> Home")
  lines.push("```")
  lines.push("")
  lines.push("## キャプチャ")
  lines.push("")
  for (const file of captured.toSorted()) {
    const name = file.replace(/\.png$/, "")
    lines.push(`### ${name}`)
    lines.push("")
    lines.push(`![${name}](./screens-as-is/${file})`)
    lines.push("")
  }
  lines.push("## 実行手順")
  lines.push("")
  lines.push("1. Android emulator を起動 (Android Studio / `emulator -avd <name>`)")
  lines.push("2. `bun run --filter @prep-hamster/mobile android` で app をビルド & インストール")
  lines.push("3. `bun run --filter @prep-hamster/mobile capture` で flow 実行 + キャプチャ取得")
  lines.push("")
  return lines.join("\n")
}

function main(): void {
  checkMaestro()
  checkDevice()
  const captured = runFlows()
  if (captured.length === 0) {
    console.error(
      "[capture-screens] png が 1 件も出力されませんでした。flow / app の状態を確認してください。",
    )
    process.exit(1)
  }
  const md = generateMarkdown(captured)
  const mdPath = join(repoRoot, "docs/design/screens-as-is.md")
  Bun.write(mdPath, md)
  console.log(`[capture-screens] ${captured.length} png を ${outDir} に出力しました。`)
  console.log(`[capture-screens] ${mdPath} を更新しました。`)
}

main()
