import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { codeFromCallback, sessionFilePath, writeSessionFile } from "../session-store"

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
})

describe("writeSessionFile", () => {
  let dir = ""
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test("creates the file readable only by the owner", () => {
    dir = mkdtempSync(join(tmpdir(), "ph-session-"))
    const file = join(dir, "prep-hamster", "session.json")
    writeSessionFile(file, '{"k":"v"}')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(Bun.file(file).text()).resolves.toBe('{"k":"v"}')
  })

  test("tightens a temp file left behind by an interrupted write", () => {
    dir = mkdtempSync(join(tmpdir(), "ph-session-"))
    const parent = join(dir, "prep-hamster")
    mkdirSync(parent, { recursive: true })
    writeFileSync(join(parent, `.session.${process.pid}.tmp`), "stale", { mode: 0o644 })
    const file = join(parent, "session.json")
    writeSessionFile(file, '{"k":"v"}')
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })
})
