import { createClient } from "@supabase/supabase-js"
import { PHOTO_BUCKET } from "../src/photos/config"

// 本番 (hosted) の写真 bucket を作る / 定義に合わせる deploy 手順。冪等。
// 定義は src/photos/config.ts の PHOTO_BUCKET が唯一の出所で、手元は supabase/config.toml が同じ値を持つ。
//   inf-run --only SUPABASE_SECRET_KEY -- env SUPABASE_URL=<project の URL> bun run scripts/provision-photo-bucket.ts

type BucketAdmin = {
  getBucket(name: string): Promise<{ data: unknown; error: { message: string } | null }>
  createBucket(
    name: string,
    options: { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] },
  ): Promise<{ error: { message: string } | null }>
  updateBucket(
    name: string,
    options: { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] },
  ): Promise<{ error: { message: string } | null }>
}

const options = {
  public: PHOTO_BUCKET.public,
  fileSizeLimit: PHOTO_BUCKET.fileSizeLimit,
  allowedMimeTypes: [...PHOTO_BUCKET.allowedMimeTypes],
}

export async function provisionPhotoBucket(admin: BucketAdmin): Promise<"created" | "updated"> {
  const existing = await admin.getBucket(PHOTO_BUCKET.name)
  // getBucket の失敗は「無い」とは限らない (権限・接続)。404 だけを無いと読み、それ以外は止める
  if (existing.error && !/not.?found/i.test(existing.error.message)) {
    throw new Error(`getBucket failed: ${existing.error.message}`)
  }
  const found = existing.error === null && existing.data !== null
  const { error } = found
    ? await admin.updateBucket(PHOTO_BUCKET.name, options)
    : await admin.createBucket(PHOTO_BUCKET.name, options)
  if (error) throw new Error(`${found ? "updateBucket" : "createBucket"} failed: ${error.message}`)
  return found ? "updated" : "created"
}

if (import.meta.main) {
  const url = process.env["SUPABASE_URL"]
  const key = process.env["SUPABASE_SECRET_KEY"]
  if (!url || !key) {
    console.error("[provision-photo-bucket] SUPABASE_URL and SUPABASE_SECRET_KEY are required")
    process.exit(1)
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const result = await provisionPhotoBucket(client.storage)
    console.log(`[provision-photo-bucket] ${PHOTO_BUCKET.name}: ${result}`)
  } catch (err) {
    console.error("[provision-photo-bucket] failed:", err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
