import { hc } from "hono/client"
import type { AppType } from "@prep-hamster/api"

export type ClientFetch = (
  input: Request | string | URL,
  init?: RequestInit,
) => Response | Promise<Response>

export type ApiClientOptions = {
  baseUrl: string
  userId: string
  fetch?: ClientFetch
}

export type ApiClient = ReturnType<typeof createApiClient>

export function createApiClient(opts: ApiClientOptions) {
  return hc<AppType>(opts.baseUrl, {
    headers: {
      "x-user-id": opts.userId,
    },
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  })
}
