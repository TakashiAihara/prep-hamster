import type { ApiClient, ClientFetch } from "@prep-hamster/api-client"
import { PHOTO_LONG_EDGE_PX, PHOTOS_PER_ITEM_MAX } from "@prep-hamster/schema/photo"
import { apiErrorMessage } from "./api-error"
import type { ConfirmEnv } from "./stock-detail-controller"

// 写真の追加・一覧・削除の非 UI ロジック。画面から切り出して描画なしの unit test で固定する。

export type PhotoDto = {
  id: string
  itemId: string
  byteSize: number
  width: number | null
  height: number | null
  // 署名付き URL (期限あり)。保存せず、毎回の取得から使う
  url: string | null
}

export type ResizePlan = { width: number } | { height: number } | null

// 長辺が上限を超えるときだけ、長辺を上限に縮める。小さい写真は拡大しない
export function resizePlan(width: number, height: number): ResizePlan {
  if (Math.max(width, height) <= PHOTO_LONG_EDGE_PX) return null
  return width >= height ? { width: PHOTO_LONG_EDGE_PX } : { height: PHOTO_LONG_EDGE_PX }
}

// 選んだ 1 枚ごとに 1 つ作り、同じ写真の再送では使い回す。API はこの photoId で再送を見分ける
export type PhotoAttempt = { photoId: string }

export const newPhotoAttempt = (uuid: () => string = () => crypto.randomUUID()): PhotoAttempt => ({
  photoId: uuid(),
})

export type FilePart = Blob | { uri: string; name: string; type: string }

export function buildUploadForm(
  file: FilePart,
  attempt: PhotoAttempt,
  size: { width: number; height: number },
): FormData {
  const form = new FormData()
  // RN の FormData は { uri, name, type } を file として送る。型は DOM 側の Blob に合わせて渡す
  form.append("file", file as Blob, "photo.jpg")
  form.append("photoId", attempt.photoId)
  form.append("width", String(Math.round(size.width)))
  form.append("height", String(Math.round(size.height)))
  return form
}

export type UploadResult =
  | { ok: true; photo: PhotoDto; replay: boolean }
  // retrySamePhotoId = 結果が分からない / 一時的な失敗なので、同じ photoId のまま送り直してよい。
  // false (確定した拒否) のときだけ、次の試行で新しい photoId を作る
  | { ok: false; message: string; retrySamePhotoId: boolean }

type ApiError = { code: string | null; message: string | null }

async function readError(res: { json: () => Promise<unknown> }): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } }
    return {
      code: typeof body.error?.code === "string" ? body.error.code : null,
      message:
        typeof body.error?.message === "string" && body.error.message.length > 0
          ? body.error.message
          : null,
    }
  } catch {
    return { code: null, message: null }
  }
}

const NETWORK_MESSAGE = "通信できませんでした。電波の良い場所で、もう一度同じ写真を送ってください"
const STORAGE_MESSAGE = "写真の保存先に接続できませんでした。しばらくしてからもう一度試してください"

export function uploadErrorMessage(status: number, error: ApiError): string {
  switch (error.code) {
    case "PHOTO_TYPE_UNSUPPORTED":
      return "JPEG の写真だけ付けられます"
    case "PHOTO_LIMIT_EXCEEDED":
      return `写真は 1 つの商品に ${PHOTOS_PER_ITEM_MAX} 枚までです`
    case "IDEMPOTENCY_KEY_REUSED":
      return "この写真は送れませんでした。もう一度写真を選んでください"
    case "STORAGE_UNAVAILABLE":
    case "TEMPORARILY_UNAVAILABLE":
    case "PHOTO_STORAGE_NOT_CONFIGURED":
      return STORAGE_MESSAGE
  }
  if (status === 413) return "写真が大きすぎます (2 MB まで)"
  if (status === 403) return "この商品に写真を付ける権限がありません"
  if (status === 404) return "商品が見つかりません"
  if (status >= 500) return STORAGE_MESSAGE
  return error.message ?? `写真を追加できませんでした (HTTP ${status})`
}

// 408 / 429 / 5xx は、サーバがまだ決めていない・一時的な失敗。それ以外の 4xx はサーバが決めた拒否
export const isRetrySafeStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500

export type UploadDeps = {
  baseUrl: string
  fetch: ClientFetch
}

export async function uploadPhoto(
  deps: UploadDeps,
  itemId: string,
  file: FilePart,
  size: { width: number; height: number },
  attempt: PhotoAttempt,
): Promise<UploadResult> {
  let res: Response
  try {
    // content-type は付けない (multipart の boundary を fetch が決める)
    res = await deps.fetch(`${deps.baseUrl}/v1/items/${itemId}/photos`, {
      method: "POST",
      body: buildUploadForm(file, attempt, size),
    })
  } catch {
    return { ok: false, message: NETWORK_MESSAGE, retrySamePhotoId: true }
  }
  if (res.ok) {
    const { photo } = (await res.json()) as { photo: PhotoDto }
    return { ok: true, photo, replay: res.status === 200 }
  }
  const error = await readError(res)
  return {
    ok: false,
    message: uploadErrorMessage(res.status, error),
    retrySamePhotoId: isRetrySafeStatus(res.status),
  }
}

export type PhotoListResult = { ok: true; photos: PhotoDto[] } | { ok: false; message: string }

export async function listPhotos(client: ApiClient, itemId: string): Promise<PhotoListResult> {
  try {
    const res = await client.v1.items[":id"].photos.$get({ param: { id: itemId } })
    if (!res.ok) return { ok: false, message: await apiErrorMessage(res, `HTTP ${res.status}`) }
    const { photos } = await res.json()
    return { ok: true, photos }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "unknown" }
  }
}

export type PhotoActionResult = { ok: true } | { ok: false; message: string }

export async function deletePhoto(
  client: ApiClient,
  itemId: string,
  photoId: string,
): Promise<PhotoActionResult> {
  try {
    const res = await client.v1.items[":id"].photos[":photoId"].$delete({
      param: { id: itemId, photoId },
    })
    // 404 = もう無い (他のメンバーが先に消した)。消したい状態にはなっている
    if (res.ok || res.status === 404) return { ok: true }
    return { ok: false, message: await apiErrorMessage(res, `HTTP ${res.status}`) }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "unknown" }
  }
}

export function createConfirmDeletePhoto(env: ConfirmEnv): () => Promise<boolean> {
  return () => {
    const title = "写真を削除しますか？"
    const message = "この写真はグループの全員から見えなくなります。この操作は取り消せません。"
    if (env.os === "web") return Promise.resolve(env.webConfirm(`${title}\n${message}`))
    return new Promise((resolve) => {
      env.alert(
        title,
        message,
        [
          { text: "キャンセル", style: "cancel", onPress: () => resolve(false) },
          { text: "削除する", style: "destructive", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      )
    })
  }
}
