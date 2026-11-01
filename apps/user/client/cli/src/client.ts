import { createApiClient, type ApiClient } from "@prep-hamster/api-client"
import { sessionAccessToken } from "./auth"

const DEFAULT_API_URL = "http://localhost:3000"

export async function makeClient(): Promise<ApiClient> {
  const baseUrl = process.env["PREP_HAMSTER_API_URL"] ?? DEFAULT_API_URL
  const accessToken = process.env["PREP_HAMSTER_ACCESS_TOKEN"] || (await sessionAccessToken())
  if (!accessToken) {
    console.error("Error: prep-hamster login を実行してください")
    process.exit(1)
  }
  return createApiClient({ baseUrl, accessToken })
}
