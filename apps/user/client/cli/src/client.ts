import { createApiClient, type ApiClient } from "@prep-hamster/api-client"

const DEFAULT_API_URL = "http://localhost:3000"

export function makeClient(): ApiClient {
  const baseUrl = process.env.PREP_HAMSTER_API_URL ?? DEFAULT_API_URL
  const userId = process.env.PREP_HAMSTER_USER_ID
  if (!userId) {
    console.error("Error: PREP_HAMSTER_USER_ID env var is required (stub auth header)")
    process.exit(1)
  }
  return createApiClient({ baseUrl, userId })
}
