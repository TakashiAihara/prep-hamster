import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { existsSync } from "node:fs"
import { fileStorage, sessionFilePath } from "./session-store"

export const sessionFile = (): string => sessionFilePath(process.env)

export function createAuthClient(): SupabaseClient | null {
  const url = process.env["PREP_HAMSTER_SUPABASE_URL"]
  const key = process.env["PREP_HAMSTER_SUPABASE_PUBLISHABLE_KEY"]
  if (!url || !key) return null
  return createClient(url, key, {
    auth: {
      storage: fileStorage(sessionFile()),
      flowType: "pkce",
      // 常駐しない CLI で更新タイマーを残すとプロセスが終わらない。期限切れは getSession が更新する
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
}

// login 済みでなければ null。セッションが無いときは supabase 側の env が無くても気にしない
export async function sessionAccessToken(): Promise<string | null> {
  if (!existsSync(sessionFile())) return null
  const supabase = createAuthClient()
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
