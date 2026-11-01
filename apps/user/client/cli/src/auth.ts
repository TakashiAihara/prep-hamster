import { createClient, isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js"
import { existsSync } from "node:fs"
import { fileStorage, readConnection, sessionFilePath, type Connection } from "./session-store"

export const sessionFile = (): string => sessionFilePath(process.env)

type Env = Record<string, string | undefined>

// 接続先は env が優先で、無ければ前回 login したときのもの。
// Supabase の URL と key は組でしか意味を持たないので、片方だけの env は使わない
export function pickConnection(env: Env, stored: Connection | null): Connection | null {
  const url = env["PREP_HAMSTER_SUPABASE_URL"]
  const key = env["PREP_HAMSTER_SUPABASE_PUBLISHABLE_KEY"]
  const base = url && key ? { url, key } : stored
  if (!base) return null
  // API の URL は env が優先。保存した URL は同じ Supabase project のときだけ引き継ぐ
  // (別の project に login し直したとき、前の project の API へ token を送らない)
  const sameProject = stored?.url === base.url
  const apiUrl = env["PREP_HAMSTER_API_URL"] || (sameProject ? stored?.apiUrl : undefined)
  return { url: base.url, key: base.key, ...(apiUrl ? { apiUrl } : {}) }
}

export const currentConnection = (): Connection | null =>
  pickConnection(process.env, readConnection(sessionFile()))

export function createAuthClient(): SupabaseClient | null {
  const connection = currentConnection()
  if (!connection) return null
  return createClient(connection.url, connection.key, {
    auth: {
      storage: fileStorage(sessionFile()),
      flowType: "pkce",
      // 1 回のコマンドで終わるので、裏での定期更新は要らない。期限切れは getSession が更新して保存する
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
}

// getSession の結果を「token / login し直し / 一時的な失敗」に分ける。
// refresh token が拒否された (失効・再利用) なら auth-js はセッションを消して error を返すので、login を促す側 (null)。
// 認証サーバに届かないときだけ、login を促さずに理由を投げる
export function tokenFromSession(
  accessToken: string | null,
  error: unknown,
  retryable: (e: unknown) => boolean,
): string | null {
  if (error && retryable(error)) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`認証サーバに届かず、セッションを更新できませんでした: ${message}`)
  }
  return error ? null : accessToken
}

// login 済みでなければ null
export async function sessionAccessToken(): Promise<string | null> {
  if (!existsSync(sessionFile())) return null
  const supabase = createAuthClient()
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  return tokenFromSession(data.session?.access_token ?? null, error, isAuthRetryableFetchError)
}
