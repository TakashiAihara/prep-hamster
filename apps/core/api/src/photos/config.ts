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

// 3 つの時間は REGISTER_DEADLINE_MS < ADOPT_MAX_AGE_MS < SWEEP_MIN_AGE_MS を守る。
// 登録が間に合わなかった upload の object は、sweep が消せる歳になる前に必ず登録を断られている。
export const REGISTER_DEADLINE_MS = 20 * MINUTE
export const ADOPT_MAX_AGE_MS = 30 * MINUTE
export const SWEEP_MIN_AGE_MS = 60 * MINUTE

// 削除直後の再試行を sweep に任せるまでの猶予 (API が自分で消す最初の試行と重ならないように)
export const REMOVAL_RETRY_AFTER_MS = 5 * MINUTE

// 1 回の sweep が扱う上限 (Storage の一覧と削除は 1 件ずつの往復)
export const SWEEP_BATCH = 500

export const photoPath = (groupId: string, photoId: string): string =>
  `${groupId.toLowerCase()}/${photoId.toLowerCase()}.jpg`
