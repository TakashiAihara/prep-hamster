import { afterEach, describe, expect, spyOn, test } from "bun:test"
import type { SupabaseClient } from "@supabase/supabase-js"
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { exchangeLoginCode } from "../commands/login"
import {
  codeFromCallback,
  fileStorage,
  keepingPkceVerifiers,
  purgePkceVerifiers,
  readConnection,
  sessionFilePath,
  writeConnection,
  writeSessionFile,
} from "../session-store"

describe("codeFromCallback", () => {
  test("takes the code from the callback URL", () => {
    expect(codeFromCallback("http://127.0.0.1:53682/callback?code=abc123", "/callback")).toEqual({
      code: "abc123",
    })
  })

  test("accepts a pasted URL with spaces around it", () => {
    expect(
      codeFromCallback("  http://127.0.0.1:53682/callback?code=xyz789\n", "/callback"),
    ).toEqual({ code: "xyz789" })
  })

  test("reports the error Supabase sent back", () => {
    expect(
      codeFromCallback(
        "http://127.0.0.1:53682/callback?error=access_denied&error_description=denied%20by%20user",
        "/callback",
      ),
    ).toEqual({ error: "denied by user" })
  })

  test("ignores other paths and URLs without a code", () => {
    expect(codeFromCallback("http://127.0.0.1:53682/favicon.ico", "/callback")).toBeNull()
    expect(codeFromCallback("http://127.0.0.1:53682/other?code=abc123", "/callback")).toBeNull()
    expect(codeFromCallback("http://127.0.0.1:53682/callback", "/callback")).toBeNull()
    expect(codeFromCallback("not a url", "/callback")).toBeNull()
  })
})

describe("sessionFilePath", () => {
  test("uses XDG_CONFIG_HOME when set", () => {
    expect(sessionFilePath({ XDG_CONFIG_HOME: "/x/cfg", HOME: "/home/u" })).toBe(
      "/x/cfg/prep-hamster/session.json",
    )
  })

  test("falls back to ~/.config", () => {
    expect(sessionFilePath({ HOME: "/home/u" })).toBe("/home/u/.config/prep-hamster/session.json")
  })

  test("ignores a relative XDG_CONFIG_HOME", () => {
    expect(sessionFilePath({ XDG_CONFIG_HOME: ".", HOME: "/home/u" })).toBe(
      "/home/u/.config/prep-hamster/session.json",
    )
  })

  test("refuses a relative path when neither XDG_CONFIG_HOME nor HOME is set", () => {
    expect(() => sessionFilePath({})).toThrow("XDG_CONFIG_HOME か HOME")
  })
})

describe("writeSessionFile", () => {
  let dir = ""
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test("creates the file readable only by the owner and leaves no temp file", async () => {
    dir = mkdtempSync(join(tmpdir(), "ph-session-"))
    const file = join(dir, "prep-hamster", "session.json")
    writeSessionFile(file, '{"k":"v"}')
    writeSessionFile(file, '{"k":"w"}')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    await expect(Bun.file(file).text()).resolves.toBe('{"k":"w"}')
    expect(readdirSync(join(dir, "prep-hamster"))).toEqual(["session.json"])
  })
})

describe("session file contents", () => {
  let dir = ""
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test("keeps the login connection next to the supabase-js keys", () => {
    dir = mkdtempSync(join(tmpdir(), "ph-session-"))
    const file = join(dir, "session.json")
    fileStorage(file).setItem("sb-x-auth-token", "token-json")
    writeConnection(file, { url: "https://p.example.test", key: "pk-1" })
    expect(readConnection(file)).toEqual({ url: "https://p.example.test", key: "pk-1" })
    expect(fileStorage(file).getItem("sb-x-auth-token")).toBe("token-json")
  })

  test("treats a file that is not a JSON object as empty", () => {
    dir = mkdtempSync(join(tmpdir(), "ph-session-"))
    const file = join(dir, "session.json")
    writeFileSync(file, "null")
    expect(fileStorage(file).getItem("anything")).toBeNull()
    expect(readConnection(file)).toBeNull()
    writeFileSync(file, '["prep-hamster.connection"]')
    expect(fileStorage(file).getItem("0")).toBeNull()
  })

  test("keeps the API URL and refuses a half connection", () => {
    dir = mkdtempSync(join(tmpdir(), "ph-session-"))
    const file = join(dir, "session.json")
    writeConnection(file, {
      url: "https://p.example.test",
      key: "pk-1",
      apiUrl: "https://api.example.test",
    })
    expect(readConnection(file)).toEqual({
      url: "https://p.example.test",
      key: "pk-1",
      apiUrl: "https://api.example.test",
    })
    fileStorage(file).setItem(
      "prep-hamster.connection",
      JSON.stringify({ url: "https://p.example.test" }),
    )
    expect(readConnection(file)).toBeNull()
  })

  test("treats a connection whose URL does not parse as absent", () => {
    dir = mkdtempSync(join(tmpdir(), "ph-session-"))
    const file = join(dir, "session.json")
    fileStorage(file).setItem(
      "prep-hamster.connection",
      JSON.stringify({ url: "not a url", key: "pk-1" }),
    )
    expect(readConnection(file)).toBeNull()
  })
})

describe("session file lock", () => {
  let dir = ""
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test("releases the lock after writing", () => {
    dir = mkdtempSync(join(tmpdir(), "ph-lock-"))
    const file = join(dir, "prep-hamster", "session.json")
    fileStorage(file).setItem("k", "v")
    fileStorage(file).removeItem("k")
    expect(fileStorage(file).getItem("k")).toBeNull()
    expect(readdirSync(join(dir, "prep-hamster"))).toEqual(["session.json"])
  })

  test("takes over a lock whose owner is gone", async () => {
    dir = mkdtempSync(join(tmpdir(), "ph-lock-"))
    const file = join(dir, "session.json")
    const dead = Bun.spawn([process.execPath, "--version"])
    await dead.exited
    writeFileSync(join(dir, ".session.json.lock"), String(dead.pid))
    fileStorage(file).setItem("k", "v")
    expect(fileStorage(file).getItem("k")).toBe("v")
    expect(existsSync(join(dir, ".session.json.lock"))).toBe(false)
  }, 30000)

  test("gives up when a live process holds the lock", () => {
    dir = mkdtempSync(join(tmpdir(), "ph-lock-"))
    const file = join(dir, "session.json")
    writeFileSync(join(dir, ".session.json.lock"), String(process.pid))
    expect(() => fileStorage(file).setItem("k", "v")).toThrow("ロックされています")
  }, 30000)
})

describe("PKCE verifier keys", () => {
  let dir = ""
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test("keepingPkceVerifiers skips verifier keys on removeItem only", () => {
    dir = mkdtempSync(join(tmpdir(), "ph-pkce-"))
    const file = join(dir, "session.json")
    const storage = keepingPkceVerifiers(fileStorage(file))
    storage.setItem("sb-x-auth-token", '"session"')
    storage.setItem("sb-x-auth-token-code-verifier", '"v"')
    storage.setItem("sb-x-auth-token-flow-f1-code-verifier", '"v2"')
    storage.setItem("sb-x-auth-token-flows-code-verifier", '["f1"]')
    storage.removeItem("sb-x-auth-token-code-verifier")
    storage.removeItem("sb-x-auth-token-flow-f1-code-verifier")
    storage.removeItem("sb-x-auth-token-flows-code-verifier")
    storage.removeItem("sb-x-auth-token")
    expect(storage.getItem("sb-x-auth-token-code-verifier")).not.toBeNull()
    expect(storage.getItem("sb-x-auth-token-flow-f1-code-verifier")).not.toBeNull()
    expect(storage.getItem("sb-x-auth-token-flows-code-verifier")).not.toBeNull()
    expect(storage.getItem("sb-x-auth-token")).toBeNull()
  })

  test("purgePkceVerifiers removes every verifier key and keeps the rest", () => {
    dir = mkdtempSync(join(tmpdir(), "ph-pkce-"))
    const file = join(dir, "session.json")
    const storage = fileStorage(file)
    storage.setItem("sb-x-auth-token", '"session"')
    storage.setItem("sb-x-auth-token-code-verifier", '"v"')
    storage.setItem("sb-x-auth-token-flow-f1-code-verifier", '"v2"')
    storage.setItem("sb-x-auth-token-flows-code-verifier", '["f1"]')
    storage.setItem("prep-hamster.connection", '"c"')
    purgePkceVerifiers(file)
    expect(storage.getItem("sb-x-auth-token")).toBe('"session"')
    expect(storage.getItem("prep-hamster.connection")).toBe('"c"')
    expect(storage.getItem("sb-x-auth-token-code-verifier")).toBeNull()
    expect(storage.getItem("sb-x-auth-token-flow-f1-code-verifier")).toBeNull()
    expect(storage.getItem("sb-x-auth-token-flows-code-verifier")).toBeNull()
  })
})

const supabaseWith = (result: { data: unknown; error: unknown }) =>
  ({
    auth: { exchangeCodeForSession: async () => result },
  }) as unknown as SupabaseClient

describe("exchangeLoginCode", () => {
  let dir = ""
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  const connection = { url: "https://p.example.test", key: "pk-1" }

  test("saves the connection after a successful exchange", async () => {
    dir = mkdtempSync(join(tmpdir(), "ph-exchange-"))
    const file = join(dir, "session.json")
    const supabase = supabaseWith({
      data: { user: { email: "a@example.test" }, session: {} },
      error: null,
    })
    await expect(exchangeLoginCode(supabase, "code-1", file, connection)).resolves.toBe(
      "a@example.test",
    )
    expect(readConnection(file)).toEqual(connection)
  })

  test("rejects when the exchange fails", async () => {
    dir = mkdtempSync(join(tmpdir(), "ph-exchange-"))
    const file = join(dir, "session.json")
    const supabase = supabaseWith({
      data: { user: null, session: null },
      error: new Error("invalid grant"),
    })
    await expect(exchangeLoginCode(supabase, "code-1", file, connection)).rejects.toThrow(
      "invalid grant",
    )
    expect(readConnection(file)).toBeNull()
  })

  test("warns instead of failing when the connection cannot be saved", async () => {
    dir = mkdtempSync(join(tmpdir(), "ph-exchange-"))
    // session.json の親がファイルなので書き込めない
    writeFileSync(join(dir, "blocker"), "x")
    const file = join(dir, "blocker", "session.json")
    const spy = spyOn(console, "error").mockImplementation(() => {})
    try {
      const supabase = supabaseWith({
        data: { user: { email: "a@example.test" }, session: {} },
        error: null,
      })
      await expect(exchangeLoginCode(supabase, "code-1", file, connection)).resolves.toBe(
        "a@example.test",
      )
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("接続先を保存できませんでした"))
    } finally {
      spy.mockRestore()
    }
  })
})
