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

// 登録は object ができてから REGISTER_DEADLINE_MS を過ぎると断られる (自分で upload したときは upload の開始から、
// 引き取った object は object の作成から数える)。sweep が消すのはそれより長く経った object だけ
// (REGISTER_DEADLINE_MS < SWEEP_MIN_AGE_MS)。登録が間に合わなかった object は、消せる歳になる前に必ず断られている。
// 引き取る object の歳の上限は期限と同じ: それより古い行の無い object は、元の登録がもう来ない orphan として消して置き直す。
export const REGISTER_DEADLINE_MS = 20 * MINUTE
export const ADOPT_MAX_AGE_MS = REGISTER_DEADLINE_MS
export const SWEEP_MIN_AGE_MS = 60 * MINUTE

// Storage の 1 回の HTTP 呼び出しの上限。transaction と photoId の lock を握って呼ぶ削除が止まらないようにする
export const STORAGE_TIMEOUT_MS = 30 * 1000

// 登録が photoId の lock を待つ上限。超えたら登録の transaction は失敗し、route の確定の経路 (503) に入る
export const REGISTER_LOCK_TIMEOUT = "10s"

// 削除直後の再試行を sweep に任せるまでの猶予 (API が自分で消す最初の試行と重ならないように)
export const REMOVAL_RETRY_AFTER_MS = 5 * MINUTE

// 1 回の sweep が扱う上限 (Storage の一覧と削除は 1 件ずつの往復)
export const SWEEP_BATCH = 500

export const photoPath = (groupId: string, photoId: string): string =>
  `${groupId.toLowerCase()}/${photoId.toLowerCase()}.jpg`
