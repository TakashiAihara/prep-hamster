import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// 保存したセッションの token は、API の URL を明示しない限り既定の localhost に送らない。
// makeClient はプロセスを終了させるので、CLI を子プロセスで起動して確かめる (Supabase には繋がない)
let dir = ""
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const runStockList = async (sessionJson: string, extraEnv: Record<string, string> = {}) => {
  dir = mkdtempSync(join(tmpdir(), "ph-gate-"))
  mkdirSync(join(dir, "prep-hamster"), { recursive: true })
  writeFileSync(join(dir, "prep-hamster", "session.json"), sessionJson, { mode: 0o600 })
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    XDG_CONFIG_HOME: dir,
    HOME: dir,
    ...extraEnv,
  }
  const proc = Bun.spawn(
    [
      "bun",
      "run",
      join(import.meta.dir, "..", "index.ts"),
      "stock",
      "list",
      "--groupId",
      "00000000-0000-4000-8000-000000000001",
    ],
    { env, stdout: "pipe", stderr: "pipe" },
  )
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
  return { stderr, code }
}

// access token の期限が十分先なので getSession は refresh せず、ネットワークに出ない
const session = (connection: object) =>
  JSON.stringify({
    "prep-hamster.connection": JSON.stringify(connection),
    "sb-127-auth-token": JSON.stringify({
      access_token: "tok-saved",
      refresh_token: "r",
      expires_at: 4102444800,
      expires_in: 3600,
      token_type: "bearer",
      user: { id: "u" },
    }),
  })

test("refuses to send a saved session's token when no API URL is named", async () => {
  const { stderr, code } = await runStockList(session({ url: "http://127.0.0.1:9", key: "pk" }))
  expect(code).toBe(1)
  expect(stderr).toContain("PREP_HAMSTER_API_URL を設定してください")
}, 30000)

test("asks for login when there is no session", async () => {
  dir = ""
  const { stderr, code } = await runStockList("{}")
  expect(code).toBe(1)
  expect(stderr).toContain("prep-hamster login を実行してください")
}, 30000)
