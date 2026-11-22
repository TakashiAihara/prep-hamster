import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, eq, isNull } from "drizzle-orm"
import { itemTags, tags } from "@prep-hamster/db"
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
    body: { content: { "application/json": { schema: createTagBodyDtoSchema } } },
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
      const updated = await db.transaction(async (tx) => {
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
        return row
      })
      const [withCount] = await listTagsWithCount(db, updated.groupId, [id])
      return c.json({ tag: toTagDto(withCount ?? { ...updated, itemCount: 0 }) }, 200)
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

    try {
      // 並行する PUT の FOR SHARE と衝突するので、PUT が先なら下の delete が片付け、
      // 後なら PUT が削除済みを見て TAG_GROUP_MISMATCH を返す。
      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select({ id: tags.id })
          .from(tags)
          .where(and(eq(tags.id, id), isNull(tags.deletedAt)))
          .for("no key update")
        if (!locked) throw new TagNotApplied()
        const now = new Date()
        await tx.update(tags).set({ deletedAt: now, updatedAt: now }).where(eq(tags.id, id))
        await tx.delete(itemTags).where(eq(itemTags.tagId, id))
      })
    } catch (err) {
      if (err instanceof TagNotApplied) {
        return c.json(NOT_FOUND, 404)
      }
      throw err
    }

    return c.body(null, 204)
  })
