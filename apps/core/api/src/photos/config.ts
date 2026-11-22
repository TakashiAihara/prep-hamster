import { PHOTO_CONTENT_TYPE, PHOTO_FILE_MAX_BYTES } from "@prep-hamster/schema"

// bucket の定義はここだけが持つ。supabase/config.toml と deploy script (scripts/provision-photo-bucket.ts) は
// この値と突き合わせて、手元と本番の bucket が黙って食い違わないようにする。
export const PHOTO_BUCKET = {
  name: "item-photos",
  public: false,
  fileSizeLimit: PHOTO_FILE_MAX_BYTES,
  allowedMimeTypes: [PHOTO_CONTENT_TYPE],
} as const

// body 全体の上限は file の上限 + multipart の枠と小さな text field の分。
export const PHOTO_ROUTE_BODY_LIMIT = PHOTO_FILE_MAX_BYTES + 64 * 1024

export const SIGNED_URL_TTL_SECONDS = 60 * 60

// createSignedUrls は path の個数の上限を文書化していないので、固定の件数で分けて呼ぶ。
export const SIGN_CHUNK = 100

const MINUTE = 60 * 1000

// pending の行が、止まった upload のものとして sweep に片付けられるまでの時間。
// 1 回の要求は Storage の HTTP 上限 (STORAGE_TIMEOUT_MS) の数回分で終わるので、これを超えた pending は要求が死んだ行。
// 長すぎると、止まった行が item の枚数の上限を塞ぐ時間が伸びる。
export const PENDING_STALE_AFTER_MS = 20 * MINUTE

// 削除直後の再試行を sweep に任せるまでの猶予 (API が自分で消す最初の試行と重ならないように)
export const REMOVAL_RETRY_AFTER_MS = 5 * MINUTE

// 1 回の sweep が扱う行数の上限 (Storage の削除は 1 件ずつの往復)
export const SWEEP_BATCH = 500

// Storage の 1 回の HTTP 呼び出しの上限
export const STORAGE_TIMEOUT_MS = 30 * 1000

export const photoPath = (groupId: string, photoId: string): string =>
  `${groupId.toLowerCase()}/${photoId.toLowerCase()}.jpg`
