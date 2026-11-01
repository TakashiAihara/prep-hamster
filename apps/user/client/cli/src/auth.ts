import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { existsSync } from "node:fs"
import { fileStorage, readConnection, sessionFilePath, type Connection } from "./session-store"

export const sessionFile = (): string => sessionFilePath(process.env)

// login が残す接続先。env が優先で、無ければ前回 login したときのもの
export function currentConnection(): Connection | null {
  const env = process.env
  const url = env["PREP_HAMSTER_SUPABASE_URL"]
  const key = env["PREP_HAMSTER_SUPABASE_PUBLISHABLE_KEY"]
  if (url && key) return { url, key }
  return readConnection(sessionFile())
}

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

// login 済みでなければ null。更新に失敗したら (認証サーバに届かない等)、login を促さずに理由を投げる
export async function sessionAccessToken(): Promise<string | null> {
  if (!existsSync(sessionFile())) return null
  const supabase = createAuthClient()
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(`セッションを更新できませんでした: ${error.message}`)
  return data.session?.access_token ?? null
}
