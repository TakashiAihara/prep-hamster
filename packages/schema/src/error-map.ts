import { z } from "zod"

// Zod の組み込みエラーメッセージを日本語化する error map。
// API レスポンス / CLI 出力の両方で使えるよう zod-i18n-map ではなく自前で定義し、
// i18next 依存を持ち込まない。
//
// 適用は `z.setErrorMap(jaErrorMap)` を起動時 1 回呼ぶ (apps/core/api/src/index.ts
// と CLI の entry point)。テスト中は副作用を避けたいので明示的に呼ばない。

export const jaErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === "undefined") {
        return { message: "必須項目です" }
      }
      return {
        message: `${typeLabel(issue.expected)}を指定してください (受信: ${typeLabel(issue.received)})`,
      }

    case z.ZodIssueCode.invalid_string:
      if (issue.validation === "uuid") {
        return { message: "UUID 形式で指定してください" }
      }
      if (issue.validation === "email") {
        return { message: "メールアドレス形式で指定してください" }
      }
      if (issue.validation === "url") {
        return { message: "URL 形式で指定してください" }
      }
      if (issue.validation === "datetime") {
        return { message: "ISO 8601 形式の日時で指定してください" }
      }
      if (issue.validation === "date") {
        return { message: "YYYY-MM-DD 形式の日付で指定してください" }
      }
      return { message: "文字列形式が不正です" }

    case z.ZodIssueCode.too_small:
      if (issue.type === "string") {
        return {
          message:
            issue.minimum === 1 ? "必須項目です" : `${issue.minimum} 文字以上で指定してください`,
        }
      }
      if (issue.type === "number") {
        return {
          message: `${issue.minimum} 以上の数値で指定してください`,
        }
      }
      if (issue.type === "array") {
        return {
          message: `${issue.minimum} 件以上で指定してください`,
        }
      }
      break

    case z.ZodIssueCode.too_big:
      if (issue.type === "string") {
        return { message: `${issue.maximum} 文字以下で指定してください` }
      }
      if (issue.type === "number") {
        return { message: `${issue.maximum} 以下の数値で指定してください` }
      }
      if (issue.type === "array") {
        return { message: `${issue.maximum} 件以下で指定してください` }
      }
      break

    case z.ZodIssueCode.invalid_enum_value:
      return {
        message: `次のいずれかを指定してください: ${issue.options.join(" / ")}`,
      }

    case z.ZodIssueCode.invalid_union:
      return { message: "いずれかの形式に一致する必要があります" }

    case z.ZodIssueCode.unrecognized_keys:
      return { message: `未知のキーが含まれています: ${issue.keys.join(", ")}` }

    case z.ZodIssueCode.custom:
      return { message: issue.message ?? "値が不正です" }
  }
  return { message: ctx.defaultError }
}

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
  z.setErrorMap(jaErrorMap)
}
