import { createApiClient, type ApiClient } from "@prep-hamster/api-client"
import { currentConnection, sessionAccessToken } from "./auth"

const DEFAULT_API_URL = "http://localhost:3000"

// セッションはあるのに更新できないとき (認証サーバに届かない等) は、login を促さずに理由を出す
function exitWith(e: unknown): never {
  console.error(`Error: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}

export async function makeClient(): Promise<ApiClient> {
  const env = process.env
  const envToken = env["PREP_HAMSTER_ACCESS_TOKEN"]
  if (envToken) {
    return createApiClient({
      baseUrl: env["PREP_HAMSTER_API_URL"] ?? DEFAULT_API_URL,
      accessToken: envToken,
    })
  }

  const accessToken = await sessionAccessToken().catch(exitWith)
  if (!accessToken) {
    console.error("Error: prep-hamster login を実行してください")
    process.exit(1)
  }
  // 保存したセッションの token は、送り先を明示したときだけ送る (既定の localhost で待つ別のプロセスに渡さない)
  const baseUrl = currentConnection()?.apiUrl
  if (!baseUrl) {
    console.error(
      "Error: PREP_HAMSTER_API_URL を設定してください (設定したまま login すると次からは不要です)",
    )
    process.exit(1)
  }
  return createApiClient({ baseUrl, accessToken })
}
