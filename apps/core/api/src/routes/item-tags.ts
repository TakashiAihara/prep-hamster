import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { itemTags, items, tags } from "@prep-hamster/db"
import { TAGS_PER_ITEM_MAX } from "@prep-hamster/schema"
import type { AppEnv } from "../app"
import { checkGroupAccess } from "../middleware/group-access"
import {
  authErrorResponses,
  errorResponseSchema,
  itemDtoSchema,
  jsonBodyErrorResponses,
  putItemTagsBodyDtoSchema,
  tagDtoSchema,
} from "./schemas"
import { listTagsWithCount, toTagDto } from "./tag-queries"
import { toItemDto } from "./items"

const IdParamSchema = z.object({
  id: z
    .string()
    .guid()
    .openapi({ param: { name: "id", in: "path" } }),
})

const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: errorResponseSchema } },
})

const putItemTagsRoute = createRoute({
  method: "put",
  path: "/{id}/tags",
  tags: ["items"],
  summary: "item の tag 集合を丸ごと置き換える (EDITOR 以上。最後の PUT が勝つ)",
  request: {
    params: IdParamSchema,
    body: {
      content: { "application/json": { schema: putItemTagsBodyDtoSchema } },
      required: true,
    },
  },
  responses: {
    ...authErrorResponses,
    ...jsonBodyErrorResponses,
    200: {
      description: "置き換え成功",
      content: {
        "application/json": {
          schema: z.object({ item: itemDtoSchema, tags: z.array(tagDtoSchema) }),
        },
      },
    },
    401: errorContent("未認証"),
    403: errorContent("未参加 / role 不足"),
    404: errorContent("item が存在しない"),
    422: errorContent("ボディ不正 / tag の group 不整合 / 1 item あたりの上限超過"),
  },
})

const ITEM_NOT_FOUND = { error: { code: "NOT_FOUND", message: "item が見つかりません" } } as const

// 存在しない・削除済み・別 group の tag を 1 つの文言にまとめる (別 group の UUID の有無を漏らさない)
const TAG_GROUP_MISMATCH = {
  error: {
    code: "TAG_GROUP_MISMATCH",
    message: "tagIds に、同じ group の active な tag ではないものが含まれています",
  },
} as const

const TAG_LIMIT_EXCEEDED = {
  error: {
    code: "TAG_LIMIT_EXCEEDED",
    message: `1 つの item に付けられる tag は ${TAGS_PER_ITEM_MAX} 件までです`,
  },
} as const

class ItemGone extends Error {}
class TagMismatch extends Error {}
class TagLimit extends Error {}

export const itemTagsRouter = new OpenAPIHono<AppEnv>().openapi(putItemTagsRoute, async (c) => {
  const { id } = c.req.valid("param")
  const body = c.req.valid("json")
  const db = c.get("db")

  const [existing] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, id), isNull(items.deletedAt)))
    .limit(1)
  if (!existing) {
    return c.json(ITEM_NOT_FOUND, 404)
  }
  const access = await checkGroupAccess(db, c.get("userId"), existing.groupId, "EDITOR")
  if (!access.ok) {
    return c.json(access.body, access.status)
  }

  // 重複は先に落とす (同じ id を 2 回入れると item_tags の主キーに当たる)。uuid は大文字小文字を
  // 区別せず同じ行を指すので、小文字にそろえてから落とす。
  // ロックは常に昇順にそろえて、同じ tag を取り合う別の PUT と待ち合いの輪を作らない
  const tagIds = [...new Set(body.tagIds.map((t) => t.toLowerCase()))].toSorted()

  let result: {
    saved: typeof items.$inferSelect
    applied: Awaited<ReturnType<typeof listTagsWithCount>>
  }
  try {
    result = await db.transaction(async (tx) => {
      const [lockedItem] = await tx
        .select()
        .from(items)
        .where(and(eq(items.id, id), isNull(items.deletedAt)))
        .for("no key update")
      if (!lockedItem) throw new ItemGone()

      if (tagIds.length > TAGS_PER_ITEM_MAX) throw new TagLimit()

      for (const tagId of tagIds) {
        // 1 行ずつ FOR SHARE (tag の DELETE / rename の FOR NO KEY UPDATE と衝突する)
        // oxlint-disable-next-line no-await-in-loop
        const [tag] = await tx
          .select({ groupId: tags.groupId })
          .from(tags)
          .where(and(eq(tags.id, tagId), isNull(tags.deletedAt)))
          .for("share")
        if (!tag || tag.groupId !== existing.groupId) throw new TagMismatch()
      }

      const current = await tx
        .select({ tagId: itemTags.tagId })
        .from(itemTags)
        .where(eq(itemTags.itemId, id))
      const currentIds = current.map((r) => r.tagId).toSorted()
      // 同じ集合の PUT (再送) は書かない。item_tags.created_at と items.updatedAt を動かさない
      if (currentIds.join() === tagIds.join()) {
        return { saved: lockedItem, applied: await listTagsWithCount(tx, existing.groupId, tagIds) }
      }

      // 外す分と足す分だけ書く。残る tag の行 (created_at) は動かさない
      const keep = new Set(tagIds)
      const toRemove = currentIds.filter((t) => !keep.has(t))
      const toAdd = tagIds.filter((t) => !currentIds.includes(t))
      if (toRemove.length > 0) {
        await tx
          .delete(itemTags)
          .where(and(eq(itemTags.itemId, id), inArray(itemTags.tagId, toRemove)))
      }
      if (toAdd.length > 0) {
        await tx.insert(itemTags).values(toAdd.map((tagId) => ({ itemId: id, tagId })))
      }
      // tagIds は item の表現に含まれるので、updatedAt を見て差分を取るクライアントが変更に気づけるよう touch する。
      // 応答は行を押さえたこの transaction の値から作る (削除済みの item を 200 で返さない)
      const [touched] = await tx
        .update(items)
        .set({ updatedAt: new Date() })
        .where(eq(items.id, id))
        .returning()
      if (!touched) throw new Error("item update returned no row")
      // 応答の tag 一覧は書いた後に数える (付けたばかりの tag の itemCount にこの item を含める)。
      // tag は FOR SHARE で押さえてあるので、commit までに消えない
      return { saved: touched, applied: await listTagsWithCount(tx, existing.groupId, tagIds) }
    })
  } catch (err) {
    if (err instanceof ItemGone) return c.json(ITEM_NOT_FOUND, 404)
    if (err instanceof TagMismatch) return c.json(TAG_GROUP_MISMATCH, 422)
    if (err instanceof TagLimit) return c.json(TAG_LIMIT_EXCEEDED, 422)
    throw err
  }

  const { saved, applied } = result
  return c.json(
    {
      item: toItemDto(saved, applied.map((t) => t.id).toSorted()),
      tags: applied.map(toTagDto),
    },
    200,
  )
})
