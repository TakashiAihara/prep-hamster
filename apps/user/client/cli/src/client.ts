import { createApiClient, type ApiClient } from "@prep-hamster/api-client"
import { sessionAccessToken } from "./auth"

const DEFAULT_API_URL = "http://localhost:3000"

// セッションはあるのに更新できないとき (認証サーバに届かない等) は、login を促さずに理由を出す
function exitWith(e: unknown): never {
  console.error(`Error: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}

export async function makeClient(): Promise<ApiClient> {
  const baseUrl = process.env["PREP_HAMSTER_API_URL"] ?? DEFAULT_API_URL
  const accessToken =
    process.env["PREP_HAMSTER_ACCESS_TOKEN"] || (await sessionAccessToken().catch(exitWith))
  if (!accessToken) {
    console.error("Error: prep-hamster login を実行してください")
    process.exit(1)
  }
  return createApiClient({ baseUrl, accessToken })
}
