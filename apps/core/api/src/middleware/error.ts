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
//   415 - JSON body route への content-type 不正 (HTTPException 経由)
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

const MAX_CAUSE_DEPTH = 5
const SQLSTATE = /^[0-9A-Z]{5}$/

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

const firstLine = (s: string): string => s.split("\n")[0] ?? s

// drizzle-orm が 2 コピー入ると instanceof が外れて message (params を含む) がログに出るので、
// 形 (query が文字列で params が配列) でも判定する。
const isDrizzleQueryError = (e: unknown): e is { query: string; params: unknown[] } => {
  if (e instanceof DrizzleQueryError) return true
  if (typeof e !== "object" || e === null) return false
  const r = e as Record<string, unknown>
  return typeof r["query"] === "string" && Array.isArray(r["params"])
}

// 42P01 (undefined_table) の message は `relation "<表名>" does not exist` 形で行の値を含まない。
const UNDEFINED_TABLE_MESSAGE = /^relation "(?:[^"]|"")+" does not exist$/

// driver (postgres-js) の PostgresError は drizzle の wrap を通らずに届くことがあるので、形で見分ける。
const isDriverError = (e: unknown): e is Record<string, unknown> =>
  typeof e === "object" &&
  e !== null &&
  SQLSTATE.test(str((e as Record<string, unknown>)["code"]) ?? "") &&
  ("severity" in e || "detail" in e || "routine" in e)

const causeChain = (err: unknown): unknown[] => {
  const links: unknown[] = []
  const seen = new Set<unknown>()
  let cur: unknown = err
  while (cur !== undefined && cur !== null && links.length < MAX_CAUSE_DEPTH && !seen.has(cur)) {
    links.push(cur)
    seen.add(cur)
    cur = typeof cur === "object" ? (cur as { cause?: unknown }).cause : undefined
  }
  return links
}

// driver エラーの message は値 (`Key (barcode)=(...)` 等) を含むので原則出さない。
// 42P01 だけは出さないと表名が落ちて調査できないので、値を含まない形に合致する message だけ出す
// (合致しない message は値を含み得るので落とす。locale や wording 違いもここで fail-closed になる)。
const driverMessage = (e: Record<string, unknown>): string | undefined => {
  if (str(e["code"]) !== "42P01") return undefined
  const message = str(e["message"])
  return message !== undefined && UNDEFINED_TABLE_MESSAGE.test(message) ? message : undefined
}

// 1 つの link から値を含まない項目だけを取り出す。DB 由来の link は detail / params を一切出さず、
// message も driverMessage が許すもの以外は出さない。
const describeLink = (e: unknown): Record<string, unknown> => {
  if (isDrizzleQueryError(e)) return { name: "DrizzleQueryError", query: e.query }
  if (isDriverError(e)) {
    return {
      name: str(e["name"]),
      code: e["code"],
      message: driverMessage(e),
      severity: str(e["severity"]),
      constraint: str(e["constraint_name"]),
      table: str(e["table_name"]),
      column: str(e["column_name"]),
      schema: str(e["schema_name"]),
      routine: str(e["routine"]),
    }
  }
  if (e instanceof Error) {
    // driver 以外の cause の message はそのまま出す。Bun 組み込みのエラー (ERR_INVALID_ARG_TYPE 等) は
    // 値を引用した message を持ち得るが、今の src から届く throw は全て固定文言なので受け入れる (#137)。
    // name は先頭行だけにする (Bun は stack header を現在の name で組むので、2 行目以降は捨てる)。
    return {
      name: firstLine(e.name),
      message: e.message,
      code: str((e as { code?: unknown }).code),
    }
  }
  return { type: typeof e }
}

// stack の先頭 (`${name}: ${message}`) は name と message の行数分だけ続く。Bun は header を現在の
// name で組むので name に改行が入っても、message に bind した値の改行が入っても、行数で数えて落とせば
// それらの中の "    at " は frame として残らない (name が文字列でない時 Bun は class 名に fallback するが、行数は変わらない)。
const framesOf = (err: unknown): string =>
  err instanceof Error && err.stack
    ? err.stack.split("\n").slice(`${err.name}: ${err.message}`.split("\n").length).join("\n")
    : ""

// DrizzleQueryError は message に bind した値 (params:) を、driver の PostgresError は message と detail に
// 行の値 (`Key (barcode)=(...)` / `invalid input syntax for type uuid: "..."`) を含む。
// 生の error は cause を再帰して Bun が全部印字するので渡さず、cause の連鎖も link ごとに絞って出す。
// ログに出すのは値を含まない項目 (SQL テキスト / SQLSTATE / 制約・表・列・schema・routine の名前 /
// 42P01 の relation 名だけの message / stack frame) だけ。
// SQL テキストが値を含まないのは、sql.raw や値を埋め込んだ文字列でクエリを組まない間だけ (今は grep で 0 件)。
const logUnhandled = (log: ErrorLogger, err: Error): void => {
  const [top, ...causes] = causeChain(err)
  const isDb = isDrizzleQueryError(err) || isDriverError(err)
  log(isDb ? "[api] unhandled database error:" : "[api] unhandled error:", {
    ...describeLink(top),
    frames: framesOf(err),
    cause: causes.length > 0 ? causes.map(describeLink) : undefined,
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
    case 415:
      return "UNSUPPORTED_MEDIA_TYPE"
    case 422:
      return "VALIDATION_ERROR"
    default:
      return "HTTP_ERROR"
  }
}
