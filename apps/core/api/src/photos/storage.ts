import { createClient } from "@supabase/supabase-js"
import { PHOTO_BUCKET } from "./config"

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
  createdAt(path: string): Promise<Date | null>
  // bucket 内の全 object (`<group_id>/<photo_id>.jpg`)
  listObjects(): Promise<{ path: string; createdAt: Date }[]>
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

export function createSupabasePhotoStorage(url: string, secretKey: string): PhotoStorage {
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
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
      const { error } = await bucket().remove([path])
      if (error && !isNotFound(error)) throw new StorageFailure(`remove failed: ${error.message}`)
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

    async createdAt(path) {
      const { data, error } = await bucket().info(path)
      if (error) {
        if (isNotFound(error)) return null
        throw new StorageFailure(`info failed: ${error.message}`)
      }
      if (!data.createdAt) throw new StorageFailure("info returned no createdAt")
      return new Date(data.createdAt)
    },

    async listObjects() {
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
      for (const folder of folders) {
        for (let offset = 0; ; offset += LIST_PAGE) {
          // oxlint-disable-next-line no-await-in-loop
          const { data, error } = await bucket().list(folder, { limit: LIST_PAGE, offset })
          if (error) throw new StorageFailure(`list failed: ${error.message}`)
          for (const f of data) {
            if (f.id !== null && f.created_at) {
              out.push({ path: `${folder}/${f.name}`, createdAt: new Date(f.created_at) })
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
