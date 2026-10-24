import { z } from "zod"

// Zod の組み込みエラーメッセージを日本語化する error map。
// API レスポンス / CLI 出力の両方で使えるよう zod-i18n-map ではなく自前で定義し、
// i18next 依存を持ち込まない。
//
// 適用は `z.config({ customError: jaErrorMap })` を起動時 1 回呼ぶ (apps/core/api/src/index.ts
// と CLI の entry point)。テスト中は副作用を避けたいので明示的に呼ばない。

export const jaErrorMap: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined) {
        return { message: "必須項目です" }
      }
      return {
        message: `${typeLabel(issue.expected)}を指定してください (受信: ${typeLabel(receivedType(issue.input))})`,
      }

    case "invalid_format":
      if (issue.format === "uuid" || issue.format === "guid") {
        return { message: "UUID 形式で指定してください" }
      }
      if (issue.format === "email") {
        return { message: "メールアドレス形式で指定してください" }
      }
      if (issue.format === "url") {
        return { message: "URL 形式で指定してください" }
      }
      if (issue.format === "datetime") {
        return { message: "ISO 8601 形式の日時で指定してください" }
      }
      if (issue.format === "date") {
        return { message: "YYYY-MM-DD 形式の日付で指定してください" }
      }
      return { message: "文字列形式が不正です" }

    case "too_small":
      if (issue.origin === "string") {
        return {
          message:
            issue.minimum === 1 ? "必須項目です" : `${issue.minimum} 文字以上で指定してください`,
        }
      }
      if (issue.origin === "number") {
        return {
          message: `${issue.minimum} 以上の数値で指定してください`,
        }
      }
      if (issue.origin === "array") {
        return {
          message: `${issue.minimum} 件以上で指定してください`,
        }
      }
      break

    case "too_big":
      if (issue.origin === "string") {
        return { message: `${issue.maximum} 文字以下で指定してください` }
      }
      if (issue.origin === "number") {
        return { message: `${issue.maximum} 以下の数値で指定してください` }
      }
      if (issue.origin === "array") {
        return { message: `${issue.maximum} 件以下で指定してください` }
      }
      break

    case "invalid_value":
      return {
        message: `次のいずれかを指定してください: ${issue.values.join(" / ")}`,
      }

    case "invalid_union":
      return { message: "いずれかの形式に一致する必要があります" }

    case "unrecognized_keys":
      return { message: `未知のキーが含まれています: ${issue.keys.join(", ")}` }

    case "custom":
      return { message: issue.message ?? "値が不正です" }
  }
  return undefined
}

// zod 4 は issue.received を持たないので、typeLabel が名前を持つ null / 配列 / Date だけ
// typeof から分ける (zod 3 の nan / map / set / promise は区別しない)。
const receivedType = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : v instanceof Date ? "date" : typeof v

const typeLabel = (t: string): string => {
  switch (t) {
    case "string":
      return "文字列"
    case "number":
      return "数値"
    case "bigint":
      return "整数"
    case "boolean":
      return "真偽値"
    case "array":
      return "配列"
    case "object":
      return "オブジェクト"
    case "null":
      return "null"
    case "undefined":
      return "undefined"
    case "date":
      return "日付"
    default:
      return t
  }
}

// 起動時 1 回呼ぶ。テスト等で global state を汚したくない場合は呼ばない。
export const installJaErrorMap = () => {
  z.config({ customError: jaErrorMap })
}
