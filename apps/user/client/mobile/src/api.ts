import { createApiClient, type ApiClient } from "@prep-hamster/api-client"
import { getCurrentUserId } from "./auth"

// EXPO_PUBLIC_API_BASE_URL を解決して @prep-hamster/api-client の hc<AppType> を生成する。
//
// 端末からデバッグする場合は LAN IP を指定する必要がある:
//   EXPO_PUBLIC_API_BASE_URL=http://192.168.x.y:3000
// iOS Simulator なら localhost、Android Emulator なら 10.0.2.2 が定番。

const FALLBACK_BASE_URL = "http://localhost:3000"

export function getApiClient(): ApiClient {
  return createApiClient({
    baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? FALLBACK_BASE_URL,
    userId: getCurrentUserId(),
  })
}
