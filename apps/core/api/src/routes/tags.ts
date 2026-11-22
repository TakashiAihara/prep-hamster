import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { itemTags, items, tags } from "@prep-hamster/db"
import { normalizeTagName } from "@prep-hamster/schema"
import type { AppEnv } from "../app"
import { checkGroupAccess, withGroupAccess } from "../middleware/group-access"
import { isUniqueViolation } from "./items"
import {
  authErrorResponses,
  createTagBodyDtoSchema,
  errorResponseSchema,
  jsonBodyErrorResponses,
  tagDtoSchema,
  updateTagBodyDtoSchema,
} from "./schemas"
import { listTagsWithCount, toTagDto } from "./tag-queries"

const IdParamSchema = z.object({
  id: z
    .string()
    .guid()
    .openapi({ param: { name: "id", in: "path" } }),
})

const ListQuerySchema = z.object({
  groupId: z.string().guid().openapi({ example: "00000000-0000-0000-0000-000000000000" }),
})

const NOT_FOUND = { error: { code: "NOT_FOUND", message: "tag が見つかりません" } } as const

const TAG_NAME_DUPLICATE = {
  error: {
    code: "TAG_NAME_DUPLICATE",
    message: "同じ group に同じ名前の tag が既に存在します",
  },
} as const

const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: errorResponseSchema } },
})

const listTagsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["tags"],
  summary: "group 単位で tag 一覧 (使われている item が多い順)",
  middleware: [withGroupAccess({ in: "query", name: "groupId" })] as const,
  request: { query: ListQuerySchema },
  responses: {
    ...authErrorResponses,
    200: {
      description: "一覧",
      content: { "application/json": { schema: z.object({ tags: z.array(tagDtoSchema) }) } },
    },
    401: errorContent("未認証"),
    403: errorContent("未参加"),
    422: errorContent("クエリ不正"),
  },
})

const createTagRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["tags"],
  summary: "tag を作成 (EDITOR 以上)",
  request: {
    body: { content: { "application/json": { schema: createTagBodyDtoSchema } }, required: true },
  },
  responses: {
    ...authErrorResponses,
    ...jsonBodyErrorResponses,
    201: {
      description: "作成成功",
      content: { "application/json": { schema: z.object({ tag: tagDtoSchema }) } },
    },
    401: errorContent("未認証"),
    403: errorContent("未参加 / role 不足"),
    422: errorContent("ボディ不正 / 同名の tag が存在する"),
  },
})

const patchTagRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["tags"],
  summary: "tag を rename (EDITOR 以上)",
  request: {
    params: IdParamSchema,
    body: { content: { "application/json": { schema: updateTagBodyDtoSchema } }, required: true },
  },
  responses: {
    ...authErrorResponses,
    ...jsonBodyErrorResponses,
    200: {
      description: "更新成功",
      content: { "application/json": { schema: z.object({ tag: tagDtoSchema }) } },
    },
    401: errorContent("未認証"),
    403: errorContent("未参加 / role 不足"),
    404: errorContent("存在しない"),
    422: errorContent("ボディ不正 / 同名の tag が存在する"),
  },
})

const deleteTagRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["tags"],
  summary: "tag を soft delete し全 item から外す (EDITOR 以上)",
  request: { params: IdParamSchema },
  responses: {
    ...authErrorResponses,
    204: { description: "削除成功" },
    401: errorContent("未認証"),
    403: errorContent("未参加 / role 不足"),
    404: errorContent("存在しない"),
    422: errorContent("パラメータ不正"),
  },
})

type Db = AppEnv["Variables"]["db"]

async function loadActiveTag(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.id, id), isNull(tags.deletedAt)))
    .limit(1)
  return row ?? null
}

class TagNotApplied extends Error {}
class RetryDelete extends Error {}

const DELETE_ATTEMPTS = 5

export const tagsRouter = new OpenAPIHono<AppEnv>()
  .openapi(listTagsRoute, async (c) => {
    const { groupId } = c.req.valid("query")
    const rows = await listTagsWithCount(c.get("db"), groupId)
    return c.json({ tags: rows.map(toTagDto) }, 200)
  })
  .openapi(createTagRoute, async (c) => {
    const body = c.req.valid("json")
    const db = c.get("db")

    const access = await checkGroupAccess(db, c.get("userId"), body.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    try {
      const [created] = await db
        .insert(tags)
        .values({
          id: crypto.randomUUID(),
          groupId: body.groupId,
          name: body.name,
          normalizedName: normalizeTagName(body.name),
        })
        .returning()
      if (!created) {
        throw new Error("tag insert returned no row")
      }
      return c.json({ tag: toTagDto({ ...created, itemCount: 0 }) }, 201)
    } catch (err) {
      if (isUniqueViolation(err)) {
        return c.json(TAG_NAME_DUPLICATE, 422)
      }
      throw err
    }
  })
  .openapi(patchTagRoute, async (c) => {
    const { id } = c.req.valid("param")
    const body = c.req.valid("json")
    const db = c.get("db")

    const existing = await loadActiveTag(db, id)
    if (!existing) {
      return c.json(NOT_FOUND, 404)
    }
    const access = await checkGroupAccess(db, c.get("userId"), existing.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    try {
      // 行を FOR NO KEY UPDATE で押さえてから書く。並行する DELETE に負けた rename は
      // 削除済みの行を見て 404 になり、消えた tag を書き戻さない。
      const renamed = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(tags)
          .where(and(eq(tags.id, id), isNull(tags.deletedAt)))
          .for("no key update")
        if (!locked) throw new TagNotApplied()
        const [row] = await tx
          .update(tags)
          .set({
            name: body.name,
            normalizedName: normalizeTagName(body.name),
            updatedAt: new Date(),
          })
          .where(eq(tags.id, id))
          .returning()
        if (!row) throw new Error("tag update returned no row")
        // 応答は行を押さえたこの transaction の値から作る (commit 後に読み直すと、並行する DELETE の後の
        // 状態を deletedAt: null のまま返すことになる)
        const [withCount] = await listTagsWithCount(tx, row.groupId, [id])
        if (!withCount) throw new Error("renamed tag is missing from its own transaction")
        return withCount
      })
      return c.json({ tag: toTagDto(renamed) }, 200)
    } catch (err) {
      if (err instanceof TagNotApplied) {
        return c.json(NOT_FOUND, 404)
      }
      if (isUniqueViolation(err)) {
        return c.json(TAG_NAME_DUPLICATE, 422)
      }
      throw err
    }
  })
  .openapi(deleteTagRoute, async (c) => {
    const { id } = c.req.valid("param")
    const db = c.get("db")

    const existing = await loadActiveTag(db, id)
    if (!existing) {
      return c.json(NOT_FOUND, 404)
    }
    const access = await checkGroupAccess(db, c.get("userId"), existing.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    // item → tag の順を守るため、付いている item を先に読んで昇順に押さえてから tag を押さえる。
    // tag を押さえた後に付いている item が増えていたら、それは先に tag を FOR SHARE して commit した PUT の分で、
    // その item はまだ押さえていない (tag を押さえた後に item を取ると、item を持って tag を待つ PUT と輪になる)。
    // その場合は全部やり直す。連続して増え続けることはまず無いので、上限を超えたら 500 で止める。
    for (let attempt = 0; attempt < DELETE_ATTEMPTS; attempt++) {
      try {
        // PUT と衝突するので、PUT が先なら下の delete が片付け、後なら PUT が削除済みを見て
        // TAG_GROUP_MISMATCH を返す。
        // oxlint-disable-next-line no-await-in-loop
        await db.transaction(async (tx) => {
          const attached = async () =>
            (
              await tx
                .select({ itemId: itemTags.itemId })
                .from(itemTags)
                .where(eq(itemTags.tagId, id))
            )
              .map((r) => r.itemId)
              .toSorted()

          const itemIds = await attached()
          for (const itemId of itemIds) {
            // oxlint-disable-next-line no-await-in-loop
            await tx
              .select({ id: items.id })
              .from(items)
              .where(eq(items.id, itemId))
              .for("no key update")
          }

          const [locked] = await tx
            .select({ id: tags.id })
            .from(tags)
            .where(and(eq(tags.id, id), isNull(tags.deletedAt)))
            .for("no key update")
          if (!locked) throw new TagNotApplied()

          const lockedSet = new Set(itemIds)
          if ((await attached()).some((itemId) => !lockedSet.has(itemId))) throw new RetryDelete()

          const now = new Date()
          await tx.update(tags).set({ deletedAt: now, updatedAt: now }).where(eq(tags.id, id))
          const removed = await tx
            .delete(itemTags)
            .where(eq(itemTags.tagId, id))
            .returning({ itemId: itemTags.itemId })
          // tagIds が変わった item だけ updatedAt を動かす (PUT と同じ。差分を取るクライアントが detach に気づける)
          if (removed.length > 0) {
            await tx
              .update(items)
              .set({ updatedAt: now })
              .where(
                inArray(
                  items.id,
                  removed.map((r) => r.itemId),
                ),
              )
          }
        })
        return c.body(null, 204)
      } catch (err) {
        if (err instanceof TagNotApplied) {
          return c.json(NOT_FOUND, 404)
        }
        if (!(err instanceof RetryDelete)) throw err
      }
    }
    throw new Error("tag delete kept racing with new attachments")
  })
