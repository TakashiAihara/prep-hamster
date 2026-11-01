import { defineCommand } from "citty"
import { createInterface } from "node:readline"
import { createAuthClient } from "../auth"
import { codeFromCallback, type CallbackResult } from "../session-store"

const CALLBACK_PATH = "/callback"
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
    const supabase = createAuthClient()
    if (!supabase) {
      console.error(
        "Error: PREP_HAMSTER_SUPABASE_URL / PREP_HAMSTER_SUPABASE_PUBLISHABLE_KEY を設定してください",
      )
      process.exit(2)
    }

    // 同じ code は 1 回しか交換できないので、ブラウザと貼り付けのどちらが先でも交換は 1 回にする
    let first: Promise<string> | undefined
    let begin!: (done: Promise<string>) => void
    const started = new Promise<string>((resolve) => {
      begin = resolve
    })
    const handle = (result: CallbackResult): Promise<string> => {
      if (!first) {
        first = (async () => {
          if ("error" in result) throw new Error(result.error)
          const { data, error } = await supabase.auth.exchangeCodeForSession(result.code)
          if (error) throw error
          return data.user?.email ?? ""
        })()
        begin(first)
      }
      return first
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
      console.log(`サインインしました: ${email}`)
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
