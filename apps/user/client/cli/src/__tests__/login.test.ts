import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  codeFromCallback,
  fileStorage,
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
})
