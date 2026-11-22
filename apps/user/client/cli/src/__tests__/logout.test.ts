import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// logout は保存したセッションを消す。壊れた接続先が残っていても消せること、
// セッションファイルの場所が決められないとき CLI のエラーで終わることを
// 子プロセスで確かめる (makeClient 系はプロセスを終了させるので実プロセスで起動する)
let dir = ""
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const runLogout = async (sessionJson: string, extraEnv: Record<string, string> = {}) => {
  dir = mkdtempSync(join(tmpdir(), "ph-logout-"))
  mkdirSync(join(dir, "prep-hamster"), { recursive: true })
  writeFileSync(join(dir, "prep-hamster", "session.json"), sessionJson, { mode: 0o600 })
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    XDG_CONFIG_HOME: dir,
    HOME: dir,
    ...extraEnv,
  }
  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "index.ts"), "logout"], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, code }
}

test("deletes the session even when the stored connection URL is invalid", async () => {
  const sessionJson = JSON.stringify({
    "prep-hamster.connection": JSON.stringify({ url: "not a url", key: "pk" }),
    "sb-127-auth-token": JSON.stringify({ access_token: "tok" }),
  })
  const { stdout, code } = await runLogout(sessionJson)
  expect(code).toBe(0)
  expect(stdout).toContain("サインアウトしました")
  expect(existsSync(join(dir, "prep-hamster", "session.json"))).toBe(false)
}, 30000)

test("reports a missing config home as a CLI error", async () => {
  dir = mkdtempSync(join(tmpdir(), "ph-logout-"))
  const env: Record<string, string> = { PATH: process.env["PATH"] ?? "" }
  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "index.ts"), "logout"], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  expect(code).toBe(1)
  expect(stderr).toContain("XDG_CONFIG_HOME か HOME を設定してください")
  expect(stderr).not.toContain("session-store.ts")
}, 30000)
