import type { Hook } from "@hono/zod-openapi"
import { DrizzleQueryError } from "drizzle-orm"
import type { Context } from "hono"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import type { AppEnv } from "../app"

// 全 endpoint の error response 統一フォーマット。
//
//   { error: { code: string; message: string; details?: unknown } }
//
// status code:
//   400 - リクエスト構文不正 (HTTPException 経由)
//   401 - 認証情報なし / 失効
//   403 - 認可不足 (role 不一致)
//   404 - 対象リソース不在
//   422 - バリデーション失敗 (body / query / path param。validationHook と groupId 検査)
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

export const validationErrorResponse = (c: Context, error: z.ZodError): Response =>
  c.json<ApiErrorBody>(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: error.issues[0]?.message ?? "リクエストの形式が不正です",
        details: z.flattenError(error),
      },
    },
    422,
  )

// createApp の OpenAPIHono の defaultHook に渡す。app.route() で載せた sub-router の
// route にも効く (sub-router 側に設定が無ければ親の hook が使われる。実測)。
// sub-router は module-level の singleton で、親は最初に route() で載せた app になる。hook 無しの app を先に作ると効かない。
// handler 内で ZodError を throw する経路は無いので、onError は ZodError を扱わない。
export const validationHook: Hook<unknown, AppEnv, string, Response | undefined> = (result, c) => {
  if (!result.success) return validationErrorResponse(c, result.error)
  return undefined
}

type ErrorLogger = (...args: unknown[]) => void

// DrizzleQueryError は message に bind した値 (params:) を、driver の PostgresError は message と detail に
// 行の値 (`Key (barcode)=(...)` / `invalid input syntax for type uuid: "..."`) を含む。
// ログに出すのは値を含まない項目 (SQL テキスト / SQLSTATE / 制約・表・列の名前 / stack frame) だけ。
const logUnhandled = (log: ErrorLogger, err: Error): void => {
  if (!(err instanceof DrizzleQueryError)) {
    log("[api] unhandled error:", err)
    return
  }

  const cause = (err.cause ?? {}) as Record<string, unknown>
  log("[api] unhandled database error:", {
    query: err.query,
    code: cause["code"],
    constraint: cause["constraint_name"],
    table: cause["table_name"],
    column: cause["column_name"],
    // stack の先頭は message (params を含む) なので、"    at " の行だけ残す
    frames: (err.stack ?? "")
      .split("\n")
      .filter((line) => line.startsWith("    at "))
      .join("\n"),
  })
}

export const createOnError =
  (log: ErrorLogger) =>
  (err: Error, c: Context): Response => {
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

    // 想定外エラー: 詳細はサーバ側ログにだけ出し、レスポンスには固定の message のみ返す
    logUnhandled(log, err)
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

export const onError = createOnError(console.error)

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
