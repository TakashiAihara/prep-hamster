import { createClient } from "@supabase/supabase-js"
import { PHOTO_BUCKET, STORAGE_TIMEOUT_MS } from "./config"

// 写真の object を置く private bucket の操作。API だけが secret key で触る (anon / authenticated に policy は無い)。
// テストは同じ型の偽物 (e2e/fake-photo-storage.ts) を渡し、Storage の応答を差し替える。
export type PhotoStorage = {
  // 同じ path に object が既にあれば "exists" (上書きしない)。それ以外の失敗は throw
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<"ok" | "exists">
  // object が無くても成功。失敗は throw
  remove(path: string): Promise<void>
  // 署名できなかった path は結果に含めない。全体の失敗は throw
  signUrls(paths: string[], expiresIn: number): Promise<Map<string, string>>
  // object が無ければ null
  stat(path: string): Promise<{ createdAt: Date; size: number } | null>
  // bucket 内の object (`<group_id>/<photo_id>.jpg`) のうち olderThan より前に作られたものを、limit 件まで
  listObjects(olderThan: Date, limit: number): Promise<{ path: string; createdAt: Date }[]>
}

export class StorageFailure extends Error {}

const LIST_PAGE = 100

const statusOf = (error: unknown): string | undefined => {
  const e = error as { status?: unknown; statusCode?: unknown }
  const s = e.statusCode ?? e.status
  return typeof s === "string" || typeof s === "number" ? String(s) : undefined
}

export const isNotFound = (error: unknown): boolean =>
  statusOf(error) === "404" || /not.?found/i.test((error as { message?: string }).message ?? "")

const isAlreadyExists = (error: unknown): boolean =>
  statusOf(error) === "409" || /already exists/i.test((error as { message?: string }).message ?? "")

// Storage の呼び出しが止まったとき、接続と photoId の lock を握ったまま待ち続けないための上限
const fetchWithTimeout = (timeoutMs: number) =>
  ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    return fetch(input, { ...init, signal })
  }) as typeof fetch

export function createSupabasePhotoStorage(
  url: string,
  secretKey: string,
  timeoutMs = STORAGE_TIMEOUT_MS,
): PhotoStorage {
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTimeout(timeoutMs) },
  })
  const bucket = () => client.storage.from(PHOTO_BUCKET.name)

  return {
    async upload(path, bytes, contentType) {
      const { error } = await bucket().upload(path, bytes, { contentType, upsert: false })
      if (!error) return "ok"
      if (isAlreadyExists(error)) return "exists"
      throw new StorageFailure(`upload failed: ${error.message}`)
    },

    async remove(path) {
      // 無い path の remove は error にならず空の結果を返す (実 Storage で確認済み)
      const { error } = await bucket().remove([path])
      if (error) throw new StorageFailure(`remove failed: ${error.message}`)
    },

    async signUrls(paths, expiresIn) {
      const urls = new Map<string, string>()
      const { data, error } = await bucket().createSignedUrls(paths, expiresIn)
      if (error) throw new StorageFailure(`sign failed: ${error.message}`)
      for (const row of data) {
        if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl)
      }
      return urls
    },

    // info() は snake_case の応答を camelCase に直して返す (list() は created_at のまま)。実 Storage で確認済み
    async stat(path) {
      const { data, error } = await bucket().info(path)
      if (error) {
        if (isNotFound(error)) return null
        throw new StorageFailure(`info failed: ${error.message}`)
      }
      if (!data.createdAt || typeof data.size !== "number") {
        throw new StorageFailure("info returned no createdAt or size")
      }
      return { createdAt: new Date(data.createdAt), size: data.size }
    },

    async listObjects(olderThan, limit) {
      const out: { path: string; createdAt: Date }[] = []
      const folders: string[] = []
      for (let offset = 0; ; offset += LIST_PAGE) {
        // oxlint-disable-next-line no-await-in-loop
        const { data, error } = await bucket().list("", { limit: LIST_PAGE, offset })
        if (error) throw new StorageFailure(`list failed: ${error.message}`)
        // フォルダは id が null
        for (const f of data) if (f.id === null) folders.push(f.name)
        if (data.length < LIST_PAGE) break
      }
      // 条件に合う object が limit 件に届いたら、残りの folder は次の回に回す (メモリと往復の上限)
      for (const folder of folders) {
        for (let offset = 0; out.length < limit; offset += LIST_PAGE) {
          // oxlint-disable-next-line no-await-in-loop
          const { data, error } = await bucket().list(folder, { limit: LIST_PAGE, offset })
          if (error) throw new StorageFailure(`list failed: ${error.message}`)
          for (const f of data) {
            if (f.id === null || !f.created_at) continue
            const createdAt = new Date(f.created_at)
            if (createdAt < olderThan && out.length < limit) {
              out.push({ path: `${folder}/${f.name}`, createdAt })
            }
          }
          if (data.length < LIST_PAGE) break
        }
      }
      return out
    },
  }
}

// 鍵が無ければ null。API は写真の route だけを 503 にして、他の route は動かし続ける。
export function createPhotoStorageFromEnv(
  env: Record<string, string | undefined> = process.env,
): PhotoStorage | null {
  const url = env["SUPABASE_URL"]?.replace(/\/+$/, "")
  const key = env["SUPABASE_SECRET_KEY"]?.trim()
  if (!url || !key) return null
  return createSupabasePhotoStorage(url, key)
}
