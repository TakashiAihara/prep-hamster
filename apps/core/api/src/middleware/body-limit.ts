import { bodyLimit } from "hono/body-limit"
import type { ApiErrorBody } from "./error"

// /v1/* 共通の body サイズ上限。上限なしだと巨大な body を全部読み込んでしまうため 1 MiB で打ち切る。
// 超過時は他の失敗と同じ ApiError 形式で 413 を返す。
export const MAX_BODY_BYTES = 1024 * 1024

export const withBodyLimit = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) =>
    c.json<ApiErrorBody>(
      {
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "リクエストが大きすぎます",
        },
      },
      413,
    ),
})
