import { defineCommand } from "citty"
import { createInterface } from "node:readline"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAuthClient, pickConnection, sessionFileOrExit } from "../auth"
import {
  codeFromCallback,
  fileStorage,
  keepingPkceVerifiers,
  purgePkceVerifiers,
  readConnection,
  writeConnection,
  type CallbackResult,
  type Connection,
} from "../session-store"

const CALLBACK_PATH = "/callback"

// 戻りの文言は外から入るので、端末の表示を書き換える制御文字を落としてから出す
const printable = (text: string): string => text.replace(/\p{Cc}/gu, "")
const TIMEOUT_MS = 5 * 60 * 1000

function openBrowser(url: string): void {
  try {
    Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", url], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    }).unref()
  } catch {
    // ssh 先などブラウザが無い環境では、出した URL を手で開いてもらう
  }
}

type LoginContext = { file: string; connection: Connection; supabase: SupabaseClient }

// 接続先と auth client を用意する。セッションファイルの場所が決められない・
// env も保存した接続先も無い・接続先が壊れているときは CLI エラーとして終わる
function loginContext(): LoginContext {
  const file = sessionFileOrExit(2)
  let connection: Connection | null
  let supabase: SupabaseClient | null
  try {
    connection = pickConnection(process.env, readConnection(file))
    supabase = connection ? createAuthClient(keepingPkceVerifiers(fileStorage(file))) : null
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(2)
  }
  if (!supabase || !connection) {
    console.error(
      "Error: PREP_HAMSTER_SUPABASE_URL / PREP_HAMSTER_SUPABASE_PUBLISHABLE_KEY を設定してください",
    )
    process.exit(2)
  }
  return { file, connection, supabase }
}

// code をセッションに交換し、接続先を残す。
// 交換できた時点でサインインは成立なので、接続先を保存できなくても失敗にはせず警告にする
export async function exchangeLoginCode(
  supabase: SupabaseClient,
  code: string,
  file: string,
  connection: Connection,
): Promise<string> {
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) throw error
  try {
    writeConnection(file, connection)
  } catch (e) {
    console.error(
      `警告: 接続先を保存できませんでした: ${printable(e instanceof Error ? e.message : String(e))}`,
    )
  }
  return data.user?.email ?? ""
}

export const loginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Google でサインインしてセッションを保存する",
  },
  async run() {
    const { file, connection, supabase } = loginContext()

    // 同じ code は 1 回しか交換できないので、交換は同時に 1 本にする。
    // in-flight の試行が終わるまで次の code は順番待ちにして、
    // 偽の試行の最中に届いた本物の戻りを呑み込まない。
    // 確定するのは交換に成功したときだけ。127.0.0.1 の口は同じホストの誰でも叩けるので、
    // 失敗 (error 付きの戻り・交換の失敗) では終わらず、本物の戻りを待ち続ける
    let settled = false
    let chain: Promise<unknown> = Promise.resolve()
    let signedIn!: (email: string) => void
    const started = new Promise<string>((resolve) => {
      signedIn = resolve
    })
    const handle = (result: CallbackResult): Promise<string> => {
      if ("error" in result) {
        const message = printable(result.error)
        console.error(
          `サインインに失敗した戻りを受けました: ${message} (待ち続けます。やめるなら Ctrl-C)`,
        )
        return Promise.reject(new Error(message))
      }
      const attempt = chain.then(() =>
        settled ? "" : exchangeLoginCode(supabase, result.code, file, connection),
      )
      chain = attempt.catch(() => {})
      void (async () => {
        try {
          const email = await attempt
          settled = true
          signedIn(email)
        } catch (e) {
          const message = printable(e instanceof Error ? e.message : String(e))
          console.error(`code を交換できませんでした: ${message} (待ち続けます。やめるなら Ctrl-C)`)
        }
      })()
      return attempt
    }

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const result = codeFromCallback(req.url, CALLBACK_PATH)
        if (!result) return new Response("not found", { status: 404 })
        try {
          await handle(result)
          return new Response("ログインしました。このタブは閉じてかまいません。")
        } catch {
          return new Response("ログインに失敗しました。ターミナルを確認してください。", {
            status: 400,
          })
        }
      },
    })
    const rl = createInterface({ input: process.stdin })
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      const redirectTo = `http://127.0.0.1:${server.port}${CALLBACK_PATH}`
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      })
      if (error) throw error

      console.log("次の URL をブラウザで開いてサインインしてください:")
      console.log(data.url)
      console.log(
        "ブラウザがこのマシンと別の場合は、戻り先 (127.0.0.1) の URL をここに貼り付けてください。",
      )
      openBrowser(data.url)

      rl.on("line", (line) => {
        const result = codeFromCallback(line, CALLBACK_PATH)
        if (result) void handle(result).catch(() => {})
      })
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("5 分以内にサインインが終わりませんでした")),
          TIMEOUT_MS,
        )
      })

      const email = await Promise.race([started, timeout])
      console.log(email ? `サインインしました: ${email}` : "サインインしました")
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`)
      process.exitCode = 1
    } finally {
      clearTimeout(timer)
      rl.close()
      await server.stop()
      try {
        purgePkceVerifiers(file)
      } catch {
        // verifier は対応する code が無いと使えないので、消せなくても実害は無い
      }
    }
  },
})
