import type { Context } from "hono"
import { HTTPException } from "hono/http-exception"
import { ZodError } from "zod"

// 全 endpoint の error response 統一フォーマット。
//
//   { error: { code: string; message: string; details?: unknown } }
//
// status code:
//   400 - リクエスト構文不正 / クエリ・ボディが parse 不能
//   401 - 認証情報なし / 失効
//   403 - 認可不足 (role 不一致)
//   404 - 対象リソース不在
//   422 - バリデーション失敗 (ZodError)
//   500 - 想定外
//
// Problem Details (RFC 7807) は v1.0.0 ではオーバーキル。

export type ApiErrorBody = {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export const onError = (err: Error, c: Context): Response => {
  if (err instanceof HTTPException) {
    const res = err.getResponse()
    // HTTPException は独自に Response を持っているが、本 API では JSON 統一フォーマットに乗せる
    if (res.headers.get("content-type")?.includes("application/json")) {
      return res
    }
    const status = err.status
    return c.json<ApiErrorBody>(
      {
        error: {
          code: codeForStatus(status),
          message: err.message,
        },
      },
      status,
    )
  }

  if (err instanceof ZodError) {
    return c.json<ApiErrorBody>(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "リクエストの形式が不正です",
          details: err.flatten(),
        },
      },
      422,
    )
  }

  // 想定外エラー: stack はサーバ側ログに出し、レスポンスには message のみ返す
  console.error("[api] unhandled error:", err)
  return c.json<ApiErrorBody>(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "サーバ内部エラーが発生しました",
      },
    },
    500,
  )
}

const codeForStatus = (status: number): string => {
  switch (status) {
    case 400:
      return "BAD_REQUEST"
    case 401:
      return "UNAUTHORIZED"
    case 403:
      return "FORBIDDEN"
    case 404:
      return "NOT_FOUND"
    case 422:
      return "VALIDATION_ERROR"
    default:
      return "HTTP_ERROR"
  }
}
