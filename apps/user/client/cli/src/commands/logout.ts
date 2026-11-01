import { defineCommand } from "citty"
import { rmSync } from "node:fs"
import { createAuthClient, sessionFile } from "../auth"

export const logoutCommand = defineCommand({
  meta: {
    name: "logout",
    description: "保存したセッションを消す",
  },
  async run() {
    // サーバ側の失効に失敗しても手元のセッションは消す (ネットワークが無くても logout できるように)
    await createAuthClient()
      ?.auth.signOut({ scope: "local" })
      .catch(() => {})
    rmSync(sessionFile(), { force: true })
    console.log("サインアウトしました")
  },
})
