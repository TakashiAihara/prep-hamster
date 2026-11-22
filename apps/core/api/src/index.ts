import { createDb } from "@prep-hamster/db"
import { installJaErrorMap } from "@prep-hamster/schema"
import { createApp } from "./app"
import { createJwksKeys } from "./auth/jwks"
import { createPhotoStorageFromEnv } from "./photos/storage"

installJaErrorMap()

const DEFAULT_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

const db = createDb(process.env["DATABASE_URL"] ?? DEFAULT_DB_URL)
// 末尾の / があると iss が `//auth/v1` になって全 token が 401 になるので落とす。
const supabaseUrl = process.env["SUPABASE_URL"]?.replace(/\/+$/, "")
if (!supabaseUrl) {
  console.error("[api] SUPABASE_URL is required")
  process.exit(1)
}

const photoStorage = createPhotoStorageFromEnv() ?? undefined
if (!photoStorage) {
  console.warn(
    "[api] SUPABASE_SECRET_KEY is not set: photo routes answer 503 PHOTO_STORAGE_NOT_CONFIGURED",
  )
}

const app = createApp({
  db,
  photoStorage,
  auth: {
    getKeys: createJwksKeys(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
    // 手元の supabase start は iss を外向きの URL (127.0.0.1) で発行する。API がコンテナから
    // 別の名前で Supabase に届く構成では、iss だけを上書きする。
    issuer: process.env["SUPABASE_JWT_ISSUER"]?.replace(/\/+$/, "") ?? `${supabaseUrl}/auth/v1`,
    audience: "authenticated",
  },
})

const port = Number(process.env["PORT"] ?? 3000)

console.log(`[api] listening on http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch,
}
