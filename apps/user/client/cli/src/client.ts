import { createApiClient, type ApiClient } from "@prep-hamster/api-client"

const DEFAULT_API_URL = "http://localhost:3000"

export function makeClient(): ApiClient {
  const baseUrl = process.env["PREP_HAMSTER_API_URL"] ?? DEFAULT_API_URL
  const accessToken = process.env["PREP_HAMSTER_ACCESS_TOKEN"]
  if (!accessToken) {
    console.error("Error: PREP_HAMSTER_ACCESS_TOKEN env var is required (Supabase access token)")
    process.exit(1)
  }
  return createApiClient({ baseUrl, accessToken })
}
