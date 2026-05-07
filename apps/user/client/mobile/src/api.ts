import { createApiClient, type ApiClient } from "@prep-hamster/api-client"
import { getCurrentUserId } from "./auth"

// EXPO_PUBLIC_API_BASE_URL を解決して @prep-hamster/api-client の hc<AppType> を生成する。
//
// 端末からデバッグする場合は LAN IP を指定する必要がある:
//   EXPO_PUBLIC_API_BASE_URL=http://192.168.x.y:3000
// iOS Simulator なら localhost、Android Emulator なら 10.0.2.2 が定番。

const FALLBACK_BASE_URL = "http://localhost:3000"

// env 解決を切り出して unit test 可能にする。getApiClient 自体は createApiClient を
// 呼び出すため副作用 (network ベース) を含む。
export function resolveApiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return env["EXPO_PUBLIC_API_BASE_URL"] ?? FALLBACK_BASE_URL
}

export function getApiClient(): ApiClient {
  return createApiClient({
    baseUrl: resolveApiBaseUrl(),
    userId: getCurrentUserId(),
  })
}
