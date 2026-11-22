import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { itemTags, items, tags } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import type { z } from "@hono/zod-openapi"
import type { tagDtoSchema } from "./schemas"

type Db = AppEnv["Variables"]["db"]
// transaction の handle でも読めるよう、select だけを要求する
type Reader = Pick<Db, "select">

export type TagWithCount = typeof tags.$inferSelect & { itemCount: number }

export const toTagDto = (row: TagWithCount): z.infer<typeof tagDtoSchema> => ({
  id: row.id,
  groupId: row.groupId,
  name: row.name,
  itemCount: row.itemCount,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
})

// active なタグを、紐づく active な item の数 (多い順、同数は名前順) で返す。
// 件数は保存せず読むたびに数える (PUT / 削除と並行しても食い違う別の正本を持たない)。
export async function listTagsWithCount(
  db: Reader,
  groupId: string,
  onlyIds?: string[],
): Promise<TagWithCount[]> {
  if (onlyIds && onlyIds.length === 0) return []
  const itemCount = sql<number>`count(${items.id})::int`
  const rows = await db
    .select({ tag: tags, itemCount })
    .from(tags)
    .leftJoin(itemTags, eq(itemTags.tagId, tags.id))
    .leftJoin(items, and(eq(items.id, itemTags.itemId), isNull(items.deletedAt)))
    .where(
      and(
        eq(tags.groupId, groupId),
        isNull(tags.deletedAt),
        onlyIds ? inArray(tags.id, onlyIds) : undefined,
      ),
    )
    .groupBy(tags.id)
    .orderBy(desc(itemCount), asc(tags.name))
  return rows.map((r) => Object.assign(r.tag, { itemCount: r.itemCount }))
}

// item ごとの tagId の一覧。削除済みのタグの行が紛れても出さない。
export async function loadTagIdsByItem(
  db: Reader,
  itemIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (itemIds.length === 0) return result
  const rows = await db
    .select({ itemId: itemTags.itemId, tagId: itemTags.tagId })
    .from(itemTags)
    .innerJoin(tags, and(eq(tags.id, itemTags.tagId), isNull(tags.deletedAt)))
    .where(inArray(itemTags.itemId, itemIds))
    .orderBy(asc(itemTags.itemId), asc(itemTags.tagId))
  for (const r of rows) {
    const list = result.get(r.itemId)
    if (list) list.push(r.tagId)
    else result.set(r.itemId, [r.tagId])
  }
  return result
}

// tagId を持つ item の id を返す部分問い合わせ。stocks / items の一覧の絞り込みで使う。
export const itemIdsWithTag = (db: Db, tagId: string) =>
  db
    .select({ id: itemTags.itemId })
    .from(itemTags)
    .innerJoin(tags, and(eq(tags.id, itemTags.tagId), isNull(tags.deletedAt)))
    .where(eq(itemTags.tagId, tagId))
