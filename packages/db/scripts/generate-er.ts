import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { is, SQL } from "drizzle-orm"
import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core"
import type { PgColumn } from "drizzle-orm/pg-core"
import * as schema from "../src/schema"

// packages/db/src/schema.ts から ER 図とテーブル定義を生成し、
// docs/reference/data-model.md に書き出す。生成物はコミット対象。

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, "../../../docs/reference/data-model.md")

const dialect = new PgDialect()

const sqlText = (value: SQL): string => dialect.sqlToQuery(value).sql

// mermaid の属性 type は空白を含められないため、空白入りの SQL 型名を短い別名に写す。
const MERMAID_TYPE: Record<string, string> = {
  "timestamp with time zone": "timestamptz",
  "timestamp without time zone": "timestamp",
  "double precision": "float8",
  "character varying": "varchar",
  "bit varying": "varbit",
}

const mermaidType = (sqlType: string): string =>
  MERMAID_TYPE[sqlType] ?? sqlType.replaceAll(/\s+/g, "_")

const renderDefault = (col: PgColumn): string | null => {
  const value = col.default
  if (value === undefined) return null
  if (value instanceof SQL) return `\`${sqlText(value)}\``
  if (typeof value === "string") return `\`${value.replaceAll("'", "''")}\``
  if (typeof value === "object") return `\`${JSON.stringify(value)}\``
  return `\`${String(value)}\``
}

type ForeignRef = {
  columns: string[]
  foreignTable: string
  foreignColumns: string[]
  onDelete: string | undefined
  onUpdate: string | undefined
}

type ColumnDoc = {
  name: string
  sqlType: string
  notNull: boolean
  isPrimary: boolean
  isUnique: boolean
  defaultText: string | null
  foreignKeys: ForeignRef[]
  enumValues: string[] | null
}

type IndexDoc = {
  name: string
  columns: string[]
  unique: boolean
  only: boolean
  method: string | undefined
  where: string | null
}

type TableDoc = {
  name: string
  columns: ColumnDoc[]
  uniques: { name: string; columns: string[] }[]
  indexes: IndexDoc[]
  checks: { name: string; expr: string }[]
  foreignKeys: ForeignRef[]
}

// schema モジュールは table / relations / enum の混在 union を export する。
// is() の実行時判定を型に反映するため unknown 経由で PgTable に絞る。
const tableConfigs = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => getTableConfig(table))
  .toSorted((a, b) => a.name.localeCompare(b.name))

const tableName = (table: PgTable): string => getTableConfig(table).name

const tables: TableDoc[] = tableConfigs.map((cfg) => {
  const foreignKeys: ForeignRef[] = cfg.foreignKeys.map((fk) => {
    const ref = fk.reference()
    return {
      columns: ref.columns.map((c) => c.name),
      foreignTable: tableName(ref.foreignTable),
      foreignColumns: ref.foreignColumns.map((c) => c.name),
      onDelete: fk.onDelete,
      onUpdate: fk.onUpdate,
    }
  })

  const fkByColumn = new Map<string, ForeignRef[]>()
  for (const fk of foreignKeys) {
    for (const column of fk.columns) {
      const list = fkByColumn.get(column) ?? []
      list.push(fk)
      fkByColumn.set(column, list)
    }
  }

  const columns: ColumnDoc[] = cfg.columns.map((col) => ({
    name: col.name,
    sqlType: col.getSQLType(),
    notNull: col.notNull,
    isPrimary: col.primary,
    isUnique: col.isUnique,
    defaultText: renderDefault(col),
    foreignKeys: fkByColumn.get(col.name) ?? [],
    enumValues: Array.isArray(col.enumValues) ? [...col.enumValues] : null,
  }))

  const uniques = cfg.uniqueConstraints
    .map((uc) => ({
      name: uc.getName() ?? uc.columns.map((c) => c.name).join("_"),
      columns: uc.columns.map((c) => c.name),
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name))

  const indexes: IndexDoc[] = cfg.indexes
    .map((idx) => {
      const config = idx.config
      return {
        name: config.name ?? "(unnamed)",
        columns: config.columns.map((c) => {
          if (c instanceof SQL) return sqlText(c)
          if ("name" in c && typeof c.name === "string") return c.name
          return "?"
        }),
        unique: config.unique,
        only: config.only,
        method: config.method,
        where: config.where ? sqlText(config.where) : null,
      }
    })
    .toSorted((a, b) => a.name.localeCompare(b.name))

  const checks = cfg.checks
    .map((check) => ({ name: check.name, expr: sqlText(check.value) }))
    .toSorted((a, b) => a.name.localeCompare(b.name))

  return { name: cfg.name, columns, uniques, indexes, checks, foreignKeys }
})

// ---------------------------------------------------------------------------
// markdown 生成
// ---------------------------------------------------------------------------

const lines: string[] = []

lines.push("# Data model")
lines.push("")
lines.push(
  "> `packages/db/src/schema.ts` から `bun run docs:generate` (`packages/db/scripts/generate-er.ts`) で自動生成される。手で編集せず、スキーマを変えたら再生成する。",
)
lines.push(
  "> v1.0.0 の設計時点の ER 図とエンティティ定義は `docs/flow/v1.0.0/data-model.md` に残っている (現在のスキーマとは一致しない)。",
)
lines.push("")
lines.push("## ER 図")
lines.push("")
lines.push("```mermaid")
lines.push("erDiagram")

for (const table of tables) {
  lines.push(`    ${table.name} {`)
  for (const col of table.columns) {
    const keys: string[] = []
    if (col.isPrimary) keys.push("PK")
    if (col.foreignKeys.length > 0) keys.push("FK")
    if (col.isUnique && !col.isPrimary) keys.push("UK")
    const suffix = keys.length > 0 ? ` ${keys.join(", ")}` : ""
    lines.push(`        ${mermaidType(col.sqlType)} ${col.name}${suffix}`)
  }
  lines.push("    }")
}

const relationships = tables
  .flatMap((table) =>
    table.foreignKeys.map((fk) => ({ parent: fk.foreignTable, child: table.name, fk })),
  )
  .toSorted(
    (a, b) =>
      a.parent.localeCompare(b.parent) ||
      a.child.localeCompare(b.child) ||
      a.fk.columns.join(",").localeCompare(b.fk.columns.join(",")),
  )

for (const { parent, child, fk } of relationships) {
  // FK カラムが全て NOT NULL なら子は必ず親を 1 つ持つ (||)。
  // nullable を含むなら 0..1 (|o)。親側は常に 0 個以上 (o{)。
  const childCols = tables
    .find((t) => t.name === child)
    ?.columns.filter((c) => fk.columns.includes(c.name))
  const required = childCols !== undefined && childCols.every((c) => c.notNull)
  const left = required ? "||" : "|o"
  lines.push(`    ${parent} ${left}--o{ ${child} : "${fk.columns.join(", ")}"`)
}

lines.push("```")
lines.push("")

// Enums (enum 型のカラムから収集。複数カラムが同じ enum を共有するので型名で dedupe)
const enums = new Map<string, string[]>()
for (const table of tables) {
  for (const col of table.columns) {
    if (col.enumValues !== null && !enums.has(col.sqlType)) {
      enums.set(col.sqlType, col.enumValues)
    }
  }
}

if (enums.size > 0) {
  lines.push("## Enum")
  lines.push("")
  lines.push("| 名前 | 値 |")
  lines.push("| --- | --- |")
  for (const [name, values] of [...enums.entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| \`${name}\` | ${values.map((v) => `\`${v}\``).join(", ")} |`)
  }
  lines.push("")
}

lines.push("## テーブル")
lines.push("")

for (const table of tables) {
  lines.push(`### \`${table.name}\``)
  lines.push("")
  lines.push("| カラム | 型 | NULL | デフォルト | キー |")
  lines.push("| --- | --- | --- | --- | --- |")
  for (const col of table.columns) {
    const keys: string[] = []
    if (col.isPrimary) keys.push("PK")
    for (const fk of col.foreignKeys) {
      keys.push(`FK → \`${fk.foreignTable}\`.\`${fk.foreignColumns.join("`, `")}\``)
    }
    if (col.isUnique && !col.isPrimary) keys.push("UK")
    lines.push(
      `| \`${col.name}\` | \`${col.sqlType}\` | ${col.notNull ? "NOT NULL" : "NULL"} | ${col.defaultText ?? "—"} | ${keys.join(", ") || "—"} |`,
    )
  }
  lines.push("")

  const notes: string[] = []
  for (const fk of table.foreignKeys) {
    const action = [
      fk.onUpdate && fk.onUpdate !== "no action" ? `on update ${fk.onUpdate}` : null,
      fk.onDelete && fk.onDelete !== "no action" ? `on delete ${fk.onDelete}` : null,
    ]
      .filter(Boolean)
      .join(", ")
    notes.push(
      `- FK \`${fk.columns.join("`, `")}\` → \`${fk.foreignTable}\`.\`${fk.foreignColumns.join("`, `")}\`${action ? ` (${action})` : ""}`,
    )
  }
  for (const uc of table.uniques) {
    notes.push(`- UNIQUE \`${uc.name}\` (\`${uc.columns.join("`, `")}\`)`)
  }
  for (const idx of table.indexes) {
    const flags = [
      idx.unique ? "UNIQUE" : null,
      idx.only ? "ONLY" : null,
      idx.method && idx.method !== "btree" ? `USING ${idx.method}` : null,
    ]
      .filter(Boolean)
      .join(" ")
    const where = idx.where ? ` WHERE ${idx.where}` : ""
    notes.push(
      `- INDEX \`${idx.name}\` (\`${idx.columns.join("`, `")}\`)${flags ? ` ${flags}` : ""}${where}`,
    )
  }
  for (const check of table.checks) {
    notes.push(`- CHECK \`${check.name}\`: \`${check.expr}\``)
  }
  if (notes.length > 0) {
    lines.push(...notes)
    lines.push("")
  }
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${lines.join("\n")}\n`)
console.log(`[docs] wrote ${OUT}`)
