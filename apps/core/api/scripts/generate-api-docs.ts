import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Db } from "@prep-hamster/db"
import { createApp } from "../src/app"

// apps/core/api が配信する OpenAPI spec (/openapi.json) から
// docs/reference/api.md を生成する。生成物はコミット対象。
// spec の取得に DB 接続は不要 (doc endpoint は middleware を通らない)。

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, "../../../../docs/reference/api.md")

type SpecSchema = {
  $ref?: string
  type?: string | string[]
  format?: string
  nullable?: boolean
  enum?: unknown[]
  items?: SpecSchema
  properties?: Record<string, SpecSchema>
  required?: string[]
  description?: string
  anyOf?: SpecSchema[]
  oneOf?: SpecSchema[]
  allOf?: SpecSchema[]
  additionalProperties?: SpecSchema | boolean
  minProperties?: number
  maxProperties?: number
}

type SpecParameter = {
  name: string
  in: string
  required?: boolean
  description?: string
  schema?: SpecSchema
}

type SpecMedia = {
  schema?: SpecSchema
}

type SpecOperation = {
  tags?: string[]
  summary?: string
  description?: string
  parameters?: SpecParameter[]
  requestBody?: {
    required?: boolean
    content?: Record<string, SpecMedia>
  }
  responses?: Record<
    string,
    {
      description?: string
      content?: Record<string, SpecMedia>
    }
  >
}

type OpenApiSpec = {
  paths: Record<string, Record<string, SpecOperation>>
  components?: {
    schemas?: Record<string, SpecSchema>
  }
}

const app = createApp({
  // doc 生成では route 登録だけが必要で、DB / 認証は一度も呼ばれない。
  db: null as unknown as Db,
  auth: { getKeys: async () => [], issuer: "docs", audience: "docs" },
})

const res = await app.request("/openapi.json")
if (!res.ok) {
  throw new Error(`failed to fetch /openapi.json: ${res.status}`)
}
const spec = (await res.json()) as OpenApiSpec

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"]

// "default" / "2XX" のような非数値 status は末尾に回す。
const statusOrder = (status: string) => {
  const n = Number(status)
  return Number.isNaN(n) ? Infinity : n
}

const refName = (ref: string): string => ref.split("/").pop() ?? ref

const describeType = (schema: SpecSchema | undefined, depth = 0): string => {
  if (!schema || depth > 6) return "unknown"
  if (schema.$ref) return refName(schema.$ref)

  const variants = schema.anyOf ?? schema.oneOf
  if (variants) {
    return variants.map((v) => describeType(v, depth + 1)).join(" | ")
  }
  if (schema.allOf) {
    return schema.allOf.map((v) => describeType(v, depth + 1)).join(" & ")
  }

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  const nullable = schema.nullable === true || types.includes("null")
  const base = types.filter((t) => t !== "null")

  let text: string
  if (base.includes("object") || schema.properties) {
    text = describeObject(schema, depth)
  } else if (base.includes("array")) {
    const inner = describeType(schema.items, depth + 1)
    text = /^[\w`]+(\[\])?$/.test(inner) ? `${inner}[]` : `Array<${inner}>`
  } else if (schema.enum) {
    text = `enum(${schema.enum.map((v) => JSON.stringify(v)).join(", ")})`
  } else {
    const t = base[0] ?? "unknown"
    text = t === "string" && schema.format ? `${t}(${schema.format})` : t
  }

  return nullable ? `${text} | null` : text
}

const describeObject = (schema: SpecSchema, depth: number): string => {
  const properties = schema.properties
  if (!properties) {
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      return `Record<string, ${describeType(schema.additionalProperties, depth + 1)}>`
    }
    return "object"
  }
  const required = new Set(schema.required ?? [])
  const fields = Object.entries(properties).map(([name, prop]) => {
    const optional = required.has(name) ? "" : "?"
    return `${name}${optional}: ${describeType(prop, depth + 1)}`
  })
  return `{ ${fields.join(", ")} }`
}

const describeMedia = (content: Record<string, SpecMedia> | undefined): string => {
  if (!content) return "—"
  const entries = Object.entries(content)
  // content type が 1 つだけ (この API は全部 application/json) なら prefix は冗長なので省く。
  if (entries.length === 1) {
    return describeType(entries[0]?.[1].schema)
  }
  return entries
    .map(([contentType, media]) => `${contentType}: ${describeType(media.schema)}`)
    .join(", ")
}

// markdown table のセル内では `|` が列区切りと解釈されるので escape する。
const cell = (text: string): string => text.replaceAll("|", "\\|")

const codeCell = (text: string): string => `\`${cell(text)}\``

const lines: string[] = []

lines.push("# API reference")
lines.push("")
lines.push(
  "> `apps/core/api` が配信する OpenAPI spec (`/openapi.json`) から `bun run docs:generate` (`apps/core/api/scripts/generate-api-docs.ts`) で自動生成される。手で編集せず、route 定義を変えたら再生成する。",
)
lines.push(">")
lines.push(
  "> - 起動中の API では `/docs` で対話的なリファレンス (Scalar) を、`/openapi.json` で spec 本体を取得できる。",
)
lines.push(
  "> - `/v1/*` の全 endpoint は `Authorization: Bearer <Supabase access token>` による認証が必要。",
)
lines.push("")

// tag ごとに endpoint をまとめる。tag・path・method の順でソートして差分を安定させる。
const endpointsByTag = new Map<string, { path: string; method: string; op: SpecOperation }[]>()
for (const [path, ops] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    // path item 直下の `parameters` 等のキーを operation と誤認しないよう method で絞る。
    if (!HTTP_METHODS.includes(method)) continue
    const tag = op.tags?.[0] ?? "other"
    const list = endpointsByTag.get(tag) ?? []
    list.push({ path, method, op })
    endpointsByTag.set(tag, list)
  }
}
const byPathThenMethod = (
  a: { path: string; method: string },
  b: { path: string; method: string },
) => a.path.localeCompare(b.path) || HTTP_METHODS.indexOf(a.method) - HTTP_METHODS.indexOf(b.method)

for (const [tag, list] of endpointsByTag) {
  endpointsByTag.set(tag, list.toSorted(byPathThenMethod))
}

for (const tag of [...endpointsByTag.keys()].toSorted()) {
  lines.push(`## ${tag}`)
  lines.push("")
  for (const { path, method, op } of endpointsByTag.get(tag) ?? []) {
    lines.push(`### \`${method.toUpperCase()} ${path}\``)
    lines.push("")
    if (op.summary) lines.push(op.summary)
    if (op.description) lines.push("", op.description)
    lines.push("")

    if (op.parameters && op.parameters.length > 0) {
      lines.push("| パラメータ | 場所 | 必須 | 型 | 説明 |")
      lines.push("| --- | --- | --- | --- | --- |")
      for (const param of op.parameters) {
        const description = param.description ?? param.schema?.description ?? "—"
        lines.push(
          `| ${codeCell(param.name)} | ${codeCell(param.in)} | ${param.required ? "yes" : "no"} | ${codeCell(describeType(param.schema))} | ${cell(description)} |`,
        )
      }
      lines.push("")
    }

    if (op.requestBody) {
      lines.push(`**リクエストボディ**: ${codeCell(describeMedia(op.requestBody.content))}`)
      lines.push("")
    }

    const responses = Object.entries(op.responses ?? {}).toSorted(
      (a, b) => statusOrder(a[0]) - statusOrder(b[0]),
    )
    if (responses.length > 0) {
      lines.push("| ステータス | 説明 | レスポンス |")
      lines.push("| --- | --- | --- |")
      for (const [status, response] of responses) {
        lines.push(
          `| ${codeCell(status)} | ${cell(response.description ?? "—")} | ${codeCell(describeMedia(response.content))} |`,
        )
      }
      lines.push("")
    }
  }
}

const schemas = spec.components?.schemas ?? {}
if (Object.keys(schemas).length > 0) {
  lines.push("## スキーマ")
  lines.push("")
  for (const name of Object.keys(schemas).toSorted()) {
    const schema = schemas[name]
    if (!schema) continue
    lines.push(`### \`${name}\``)
    lines.push("")

    const objectConstraints = [
      schema.additionalProperties === false ? "additionalProperties: false" : null,
      schema.minProperties !== undefined ? `minProperties: ${schema.minProperties}` : null,
      schema.maxProperties !== undefined ? `maxProperties: ${schema.maxProperties}` : null,
    ].filter(Boolean)
    if (objectConstraints.length > 0) {
      lines.push(`\`${objectConstraints.join("`, `")}\``)
      lines.push("")
    }

    if (!schema.properties) {
      lines.push(codeCell(describeType(schema)))
      lines.push("")
      continue
    }

    lines.push("| フィールド | 型 | 必須 | 説明 |")
    lines.push("| --- | --- | --- | --- |")
    const required = new Set(schema.required ?? [])
    for (const [field, prop] of Object.entries(schema.properties)) {
      const description = prop.description ?? "—"
      lines.push(
        `| ${codeCell(field)} | ${codeCell(describeType(prop))} | ${required.has(field) ? "yes" : "no"} | ${cell(description)} |`,
      )
    }
    lines.push("")
  }
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${lines.join("\n")}\n`)
console.log(`[docs] wrote ${OUT}`)
