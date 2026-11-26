import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { Readable } from "node:stream"
import { readConnection } from "../session-store"

// login の成功経路 (code 受領 → 交換 → 接続先の保存 → 表示) を、
// 偽の Supabase Auth に向けて子プロセスで確かめる。
// token エンドポイントは PKCE の code_verifier を本物と同じく検証する

type TokenRequest = { code: string | undefined; challengeOk: boolean }

const startFakeAuth = () => {
  const requests: TokenRequest[] = []
  let expectedChallenge = ""
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (req.method !== "POST" || url.pathname !== "/auth/v1/token") {
        return new Response("not found", { status: 404 })
      }
      const body = (await req.json()) as { auth_code?: string; code_verifier?: string }
      let challengeOk = false
      if (body.code_verifier && expectedChallenge) {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(body.code_verifier),
        )
        const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, "")
        challengeOk = challenge === expectedChallenge
      }
      requests.push({ code: body.auth_code, challengeOk })
      if (body.auth_code === "slow-code") {
        await Bun.sleep(400)
        return Response.json(
          { error: "invalid_grant", error_description: "slow fake" },
          { status: 400 },
        )
      }
      if (body.auth_code === "good-code" && challengeOk) {
        return Response.json({
          access_token: "tok-e2e",
          refresh_token: "ref-e2e",
          expires_in: 3600,
          token_type: "bearer",
          user: { id: "u-e2e", email: "e2e@example.com" },
        })
      }
      return Response.json(
        { error: "invalid_grant", error_description: "bad code" },
        { status: 400 },
      )
    },
  })
  return {
    server,
    requests,
    url: `http://127.0.0.1:${server.port}`,
    setChallenge: (challenge: string) => {
      expectedChallenge = challenge
    },
  }
}

let dir = ""
const procs: { kill: () => void }[] = []
afterEach(() => {
  for (const proc of procs.splice(0)) proc.kill()
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ""
})

// login を起こし、stdout に出る authorize URL から callback の URL と
// code_challenge を拾う。onCallback で戻り先へのリクエストを打ってから
// プロセスの終了を待つ
const runLogin = async (
  fakeUrl: string,
  onCallback: (callbackUrl: string, challenge: string) => Promise<void>,
) => {
  dir = mkdtempSync(join(tmpdir(), "ph-login-"))
  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "index.ts"), "login"], {
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: dir,
      XDG_CONFIG_HOME: dir,
      PREP_HAMSTER_SUPABASE_URL: fakeUrl,
      PREP_HAMSTER_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  procs.push(proc)

  let stdout = ""
  let callbackUrl = ""
  let challenge = ""
  let found!: () => void
  const foundPromise = new Promise<void>((resolve) => {
    found = resolve
  })
  let closed!: () => void
  const closedPromise = new Promise<void>((resolve) => {
    closed = resolve
  })

  const rl = createInterface({ input: Readable.fromWeb(proc.stdout) })
  rl.on("line", (line) => {
    stdout += `${line}\n`
    if (callbackUrl) return
    const match = line.match(/https?:\/\/\S+/)
    if (!match) return
    try {
      const authorize = new URL(match[0])
      if (authorize.pathname !== "/auth/v1/authorize") return
      callbackUrl = authorize.searchParams.get("redirect_to") ?? ""
      challenge = authorize.searchParams.get("code_challenge") ?? ""
      found()
    } catch {
      // URL でない行は読み飛ばす
    }
  })
  rl.on("close", closed)

  await Promise.race([foundPromise, closedPromise])
  if (!callbackUrl) {
    const code = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`login が authorize URL を出さずに終わりました (exit ${code}): ${stderr}`)
  }
  await onCallback(callbackUrl, challenge)
  const code = await proc.exited
  await closedPromise
  const stderr = await new Response(proc.stderr).text()
  return { code, stdout, stderr }
}

test("logs in through the callback and saves the session", async () => {
  const fake = startFakeAuth()
  try {
    const { code, stdout, stderr } = await runLogin(fake.url, async (callbackUrl, challenge) => {
      fake.setChallenge(challenge)
      const res = await fetch(`${callbackUrl}?code=good-code`)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain("ログインしました")
    })
    expect(code).toBe(0)
    expect(stdout).toContain("サインインしました: e2e@example.com")
    expect(stderr).not.toContain("交換できませんでした")
    const file = join(dir, "prep-hamster", "session.json")
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const stored = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>
    expect(Object.keys(stored).filter((k) => k.endsWith("-code-verifier"))).toEqual([])
    expect(readConnection(file)).toEqual({ url: fake.url, key: "sb_publishable_e2e" })
    expect(stored["sb-127-auth-token"]).toContain("tok-e2e")
    expect(fake.requests).toEqual([{ code: "good-code", challengeOk: true }])
  } finally {
    fake.server.stop()
  }
}, 30000)

test("reports a missing config home as a CLI error", async () => {
  dir = mkdtempSync(join(tmpdir(), "ph-login-"))
  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "index.ts"), "login"], {
    env: { PATH: process.env["PATH"] ?? "" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  procs.push(proc)
  const [, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  expect(code).toBe(2)
  expect(stderr).toContain("XDG_CONFIG_HOME か HOME を設定してください")
  expect(stderr).not.toContain("session-store.ts")
}, 30000)

test("exchanges the real callback that arrives during a fake attempt", async () => {
  const fake = startFakeAuth()
  try {
    const { code, stdout } = await runLogin(fake.url, async (callbackUrl, challenge) => {
      fake.setChallenge(challenge)
      // 偽の code の交換が token endpoint で待たされている間に本物を送る
      const slow = fetch(`${callbackUrl}?code=slow-code`)
      await Bun.sleep(50)
      const res = await fetch(`${callbackUrl}?code=good-code`)
      expect(res.status).toBe(200)
      expect((await slow).status).toBe(400)
    })
    expect(code).toBe(0)
    expect(stdout).toContain("サインインしました: e2e@example.com")
    expect(fake.requests).toEqual([
      { code: "slow-code", challengeOk: true },
      { code: "good-code", challengeOk: true },
    ])
    const file = join(dir, "prep-hamster", "session.json")
    expect(readConnection(file)).toEqual({ url: fake.url, key: "sb_publishable_e2e" })
  } finally {
    fake.server.stop()
  }
}, 30000)
