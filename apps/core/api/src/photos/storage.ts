import { createClient } from "@supabase/supabase-js"
import { PHOTO_BUCKET, STORAGE_TIMEOUT_MS } from "./config"

// 写真の object を置く private bucket の操作。API だけが secret key で触る (anon / authenticated に policy は無い)。
// どれも DB の transaction の外で呼ぶ。テストは同じ型の偽物 (e2e/fake-photo-storage.ts) を渡し、Storage の応答を差し替える。
export type PhotoStorage = {
  // 同じ path に object が既にあっても成功 (path は photoId の行が持つので、あるのは同じ写真の前の試行の object)。
  // それ以外の失敗は throw
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  // object が無くても成功。1 回の呼び出しで複数の path を消す。失敗は throw
  remove(paths: string[]): Promise<void>
  // 署名できなかった path は結果に含めない。全体の失敗は throw
  signUrls(paths: string[], expiresIn: number): Promise<Map<string, string>>
}

export class StorageFailure extends Error {}

const statusOf = (error: unknown): string | undefined => {
  const e = error as { status?: unknown; statusCode?: unknown }
  const s = e.statusCode ?? e.status
  return typeof s === "string" || typeof s === "number" ? String(s) : undefined
}

// 実 Storage は同じ path の upload を HTTP 400 + statusCode "409" + "The resource already exists" で返す
const isAlreadyExists = (error: unknown): boolean =>
  statusOf(error) === "409" || /already exists/i.test((error as { message?: string }).message ?? "")

// Storage の呼び出しが止まったとき、要求が待ち続けないための上限
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
      if (error && !isAlreadyExists(error))
        throw new StorageFailure(`upload failed: ${error.message}`)
    },

    async remove(paths) {
      // 無い path の remove は error にならず空の結果を返す (実 Storage で確認済み)
      const { error } = await bucket().remove(paths)
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
