import { randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join } from "node:path"

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
    // URL として解釈できない接続先は createAuthClient が throw するので、未設定と同じに扱う
    if (!URL.canParse(value.url)) return null
    return { url: value.url, key: value.key, ...(value.apiUrl ? { apiUrl: value.apiUrl } : {}) }
  } catch {
    return null
  }
}

export function writeConnection(file: string, connection: Connection): void {
  fileStorage(file).setItem(CONNECTION_KEY, JSON.stringify(connection))
}

// session.json の read-modify-write をプロセス間で直列化する。
// 別の CLI が refresh 等で同時に書くと、読み取りと書き込みの間に相手の更新が消える。
// ロックは隣に <名前>.lock を pid 入りで作って取る (wx で一意)。持ち主の pid が
// 死んでいれば即座に奪い、内容が読めないものは古いときだけ奪う。
// 生きている持ち主のロックは奪わず、timeout で諦める
const LOCK_TIMEOUT_MS = 10_000
const LOCK_STALE_MS = 5_000
const LOCK_RETRY_MS = 50

function lockIsStale(lock: string): boolean {
  let pid: number
  try {
    pid = Number.parseInt(readFileSync(lock, "utf8"), 10)
  } catch {
    return false
  }
  if (Number.isInteger(pid) && pid > 0) {
    if (pid === process.pid) return false
    try {
      process.kill(pid, 0)
      return false
    } catch (e) {
      // ESRCH は持ち主が死んだということ。EPERM は別ユーザの生きているプロセス
      return (e as NodeJS.ErrnoException).code === "ESRCH"
    }
  }
  // pid が書かれる前に死んだ等で中身が読めないロックは、古いものだけ奪う
  try {
    return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS
  } catch {
    return false
  }
}

function withSessionLock<T>(file: string, fn: () => T): T {
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const lock = join(dir, `.${basename(file)}.lock`)
  const self = String(process.pid)
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      writeFileSync(lock, self, { flag: "wx" })
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
      if (lockIsStale(lock)) {
        rmSync(lock, { force: true })
        continue
      }
      if (Date.now() >= deadline) {
        throw new Error("セッションファイルが別の prep-hamster プロセスにロックされています", {
          cause: e,
        })
      }
      Bun.sleepSync(LOCK_RETRY_MS)
    }
  }
  try {
    return fn()
  } finally {
    // 待っている間にロックを奪われて別プロセスが取り直していることがあるので、自分のものだけ消す
    try {
      if (readFileSync(lock, "utf8") === self) rmSync(lock, { force: true })
    } catch {
      // 既に消えている
    }
  }
}

// supabase-js の storage をセッションファイルに向ける (キー → 値の JSON オブジェクト)
export function fileStorage(file: string) {
  return {
    getItem: (key: string): string | null => readAll(file)[key] ?? null,
    setItem: (key: string, value: string): void => {
      withSessionLock(file, () => {
        writeSessionFile(file, JSON.stringify({ ...readAll(file), [key]: value }))
      })
    },
    removeItem: (key: string): void => {
      withSessionLock(file, () => {
        const { [key]: _removed, ...rest } = readAll(file)
        writeSessionFile(file, JSON.stringify(rest))
      })
    },
  }
}

// auth-js が使う PKCE verifier のキーはすべて -code-verifier で終わる
// (固定キー・フローごとのスロット・スロット一覧)
const PKCE_VERIFIER_SUFFIX = "-code-verifier"

// login の交換用の storage。auth-js は code の交換 (成功・失敗とも) のあと verifier を
// 消すので、そのままだと失敗した (偽の) 試行で本物の code の verifier まで消えてしまう。
// login の間は verifier 系キーの removeItem を通さず、終わったら purgePkceVerifiers で消す
export function keepingPkceVerifiers(storage: ReturnType<typeof fileStorage>) {
  return {
    ...storage,
    removeItem: (key: string): void => {
      if (!key.endsWith(PKCE_VERIFIER_SUFFIX)) storage.removeItem(key)
    },
  }
}

// セッションファイルに残った PKCE verifier を全部消す。
// login が時間切れ等で終わった分も残らないようにする
export function purgePkceVerifiers(file: string): void {
  withSessionLock(file, () => {
    const data = readAll(file)
    const kept = Object.fromEntries(
      Object.entries(data).filter(([key]) => !key.endsWith(PKCE_VERIFIER_SUFFIX)),
    )
    if (Object.keys(kept).length !== Object.keys(data).length) {
      writeSessionFile(file, JSON.stringify(kept))
    }
  })
}
