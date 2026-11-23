import { bodyLimit } from "hono/body-limit"
import { PHOTO_ROUTE_BODY_LIMIT } from "../photos/config"
import type { ApiErrorBody } from "./error"

// /v1/* 共通の body サイズ上限。上限なしだと巨大な body を全部読み込んでしまうため 1 MiB で打ち切る。
// 超過時は他の失敗と同じ ApiError 形式で 413 を返す。
export const MAX_BODY_BYTES = 1024 * 1024

const onError = (c: Parameters<NonNullable<Parameters<typeof bodyLimit>[0]["onError"]>>[0]) =>
  c.json<ApiErrorBody>(
    {
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "リクエストが大きすぎます",
      },
    },
    413,
  )

const common = bodyLimit({ maxSize: MAX_BODY_BYTES, onError })
const photoUpload = bodyLimit({ maxSize: PHOTO_ROUTE_BODY_LIMIT, onError })

// 写真の upload だけ、file の上限 + multipart の枠の分まで受ける。ほかの route は 1 MiB のまま
const PHOTO_UPLOAD_PATH = /^\/v1\/items\/[^/]+\/photos\/?$/

export const withBodyLimit: typeof common = (c, next) =>
  c.req.method === "POST" && PHOTO_UPLOAD_PATH.test(c.req.path)
    ? photoUpload(c, next)
    : common(c, next)
