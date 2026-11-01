import { defineCommand } from "citty"
import { createInterface } from "node:readline"
import { createAuthClient, currentConnection, sessionFile } from "../auth"
import { codeFromCallback, writeConnection, type CallbackResult } from "../session-store"

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

export const loginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Google でサインインしてセッションを保存する",
  },
  async run() {
    const connection = currentConnection()
    const supabase = createAuthClient()
    if (!supabase || !connection) {
      console.error(
        "Error: PREP_HAMSTER_SUPABASE_URL / PREP_HAMSTER_SUPABASE_PUBLISHABLE_KEY を設定してください",
      )
      process.exit(2)
    }

    // 同じ code は 1 回しか交換できないので、ブラウザと貼り付けのどちらが先でも交換は同時に 1 本にする。
    // 確定するのは交換に成功したときだけ。127.0.0.1 の口は同じホストの誰でも叩けるので、
    // 失敗 (error 付きの戻り・交換の失敗) では終わらず、本物の戻りを待ち続ける
    let inFlight: Promise<string> | undefined
    let signedIn!: (email: string) => void
    const started = new Promise<string>((resolve) => {
      signedIn = resolve
    })
    const handle = (result: CallbackResult): Promise<string> => {
      if (inFlight) return inFlight
      if ("error" in result) {
        const message = printable(result.error)
        console.error(
          `サインインに失敗した戻りを受けました: ${message} (待ち続けます。やめるなら Ctrl-C)`,
        )
        return Promise.reject(new Error(message))
      }
      const attempt = (async () => {
        const { data, error } = await supabase.auth.exchangeCodeForSession(result.code)
        if (error) throw error
        // 以降のコマンドが env 無しでも同じ project に繋がるよう、接続先も残す
        writeConnection(sessionFile(), connection)
        return data.user?.email ?? ""
      })()
      inFlight = attempt
      attempt.then(signedIn, (e: unknown) => {
        inFlight = undefined
        const message = printable(e instanceof Error ? e.message : String(e))
        console.error(`code を交換できませんでした: ${message} (待ち続けます。やめるなら Ctrl-C)`)
      })
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
    }
  },
})
