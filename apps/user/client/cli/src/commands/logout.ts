import { defineCommand } from "citty"
import { rmSync } from "node:fs"
import { createAuthClient, sessionFileOrExit } from "../auth"

export const logoutCommand = defineCommand({
  meta: {
    name: "logout",
    description: "保存したセッションを消す",
  },
  async run() {
    const file = sessionFileOrExit(1)
    // サーバ側の失効は best-effort。接続先が読めなくても・失効に失敗しても手元のセッションは消す
    // (ネットワークが無くても logout できるように)
    try {
      await createAuthClient()
        ?.auth.signOut({ scope: "local" })
        .catch(() => {})
    } catch {
      // createAuthClient が接続先の解釈で失敗しても、削除は必ず通す
    }
    try {
      rmSync(file, { force: true })
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`)
      process.exit(1)
    }
    console.log("サインアウトしました")
  },
})
