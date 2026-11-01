import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
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
  const base = env["XDG_CONFIG_HOME"] || join(env["HOME"] ?? "", ".config")
  return join(base, "prep-hamster", "session.json")
}

// 途中で切れたファイルを読ませないよう、同じディレクトリの一時ファイルから rename する。
// writeFileSync の mode は umask に削られるので、chmod で 0600 に揃える。
export function writeSessionFile(file: string, content: string): void {
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = join(dir, `.session.${process.pid}.tmp`)
  // 新しく作る一時ファイルは最初から 0600 で作り、前の中断で残った一時ファイルは chmod で締める
  writeFileSync(tmp, content, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
}

function readAll(file: string): Record<string, string> {
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, string>
  } catch {
    // 壊れたファイルは未サインインとして扱い、次の setItem で作り直す
    return {}
  }
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
