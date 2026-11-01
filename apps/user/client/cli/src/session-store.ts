import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export type CallbackResult = { code: string } | { error: string }

// 貼られた URL の前後の空白は URL のパースが落とす。code も error も無いものは「まだ届いていない」ので null
export function codeFromCallback(input: string, path: string): CallbackResult | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.pathname !== path) return null
  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
  if (error) return { error }
  const code = url.searchParams.get("code")
  return code ? { code } : null
}

export function sessionFilePath(env: Record<string, string | undefined>): string {
  // XDG Base Directory の仕様どおり、相対パスの XDG_CONFIG_HOME は無いものとして扱う
  const xdg = env["XDG_CONFIG_HOME"]?.startsWith("/") ? env["XDG_CONFIG_HOME"] : undefined
  const home = env["HOME"]
  // どちらも無いと相対パスになり、cwd に token を書いてしまうので止める
  if (!xdg && !home) throw new Error("XDG_CONFIG_HOME か HOME を設定してください")
  return join(xdg || join(home ?? "", ".config"), "prep-hamster", "session.json")
}

// 途中で切れたファイルを読ませないよう、同じディレクトリの一時ファイルから rename する。
// 一時ファイルは毎回新しい名前で作る (wx) ので、mode 0600 が必ず効く (umask は狭めるだけ)
export function writeSessionFile(file: string, content: string): void {
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = join(dir, `.session.${randomUUID()}.tmp`)
  writeFileSync(tmp, content, { mode: 0o600, flag: "wx" })
  renameSync(tmp, file)
}

function readAll(file: string): Record<string, string> {
  if (!existsSync(file)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    // 壊れたファイルは未サインインとして扱い、次の setItem で作り直す
    return {}
  }
}

// supabase-js のキーと混ざらない名前で、login に使った接続先を同じファイルに残す
const CONNECTION_KEY = "prep-hamster.connection"

// apiUrl は保存したセッションの token を送ってよい API の送り先 (login のときの PREP_HAMSTER_API_URL)
export type Connection = { url: string; key: string; apiUrl?: string }

export function readConnection(file: string): Connection | null {
  const raw = readAll(file)[CONNECTION_KEY]
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<Connection>
    if (!value.url || !value.key) return null
    return { url: value.url, key: value.key, ...(value.apiUrl ? { apiUrl: value.apiUrl } : {}) }
  } catch {
    return null
  }
}

export function writeConnection(file: string, connection: Connection): void {
  fileStorage(file).setItem(CONNECTION_KEY, JSON.stringify(connection))
}

// supabase-js の storage をセッションファイルに向ける (キー → 値の JSON オブジェクト)
export function fileStorage(file: string) {
  return {
    getItem: (key: string): string | null => readAll(file)[key] ?? null,
    setItem: (key: string, value: string): void => {
      writeSessionFile(file, JSON.stringify({ ...readAll(file), [key]: value }))
    },
    removeItem: (key: string): void => {
      const { [key]: _removed, ...rest } = readAll(file)
      writeSessionFile(file, JSON.stringify(rest))
    },
  }
}
