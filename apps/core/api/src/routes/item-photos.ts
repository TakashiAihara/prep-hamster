import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, eq, isNull } from "drizzle-orm"
import { items } from "@prep-hamster/db"
import { PHOTO_CONTENT_TYPE, PHOTO_FILE_MAX_BYTES } from "@prep-hamster/schema"
import type { AppEnv } from "../app"
import { checkGroupAccess, withGroupAccess } from "../middleware/group-access"
import { photoPath } from "../photos/config"
import {
  checkCapEarly,
  inspectExisting,
  listCovers,
  listItemPhotos,
  probePhoto,
  registerPhoto,
  removeObjectOf,
  settlePhoto,
  signPaths,
  softDeletePhoto,
  type PhotoRow,
  type Settled,
} from "../photos/service"
import { authErrorResponses, errorResponseSchema } from "./schemas"

const IdParamSchema = z.object({
  id: z
    .string()
    .guid()
    .openapi({ param: { name: "id", in: "path" } }),
})

const PhotoParamSchema = IdParamSchema.extend({
  photoId: z
    .string()
    .guid()
    .openapi({ param: { name: "photoId", in: "path" } }),
})

// width / height はレイアウト用の値で、他の用途には使わない。上限は実在しうる写真より大きく取る
const DIMENSION_MAX = 10000

const uploadFormSchema = z.object({
  file: z
    .custom<File>((v) => v instanceof File, { error: "file を指定してください" })
    .openapi({ type: "string", format: "binary" }),
  photoId: z.string().guid(),
  width: z.coerce.number().int().min(1).max(DIMENSION_MAX).optional(),
  height: z.coerce.number().int().min(1).max(DIMENSION_MAX).optional(),
})

export const photoDtoSchema = z
  .object({
    id: z.string(),
    itemId: z.string(),
    groupId: z.string(),
    contentType: z.string(),
    byteSize: z.number().int(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    createdBy: z.string(),
    createdAt: z.string(),
    // 署名付きの読み取り URL (期限あり)。署名に失敗した写真は null で、取り直せば付く
    url: z.string().nullable(),
  })
  .openapi("ItemPhoto")

const coverDtoSchema = z.object({ itemId: z.string(), photoId: z.string(), url: z.string() })

const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: errorResponseSchema } },
})

const ListQuerySchema = z.object({
  groupId: z.string().guid().openapi({ example: "00000000-0000-0000-0000-000000000000" }),
})

const coversRoute = createRoute({
  method: "get",
  path: "/photos",
  tags: ["items"],
  summary: "group の item ごとの先頭の写真 (一覧の行用。VIEWER 以上)",
  middleware: [withGroupAccess({ in: "query", name: "groupId" })] as const,
  request: { query: ListQuerySchema },
  responses: {
    ...authErrorResponses,
    200: {
      description: "item ごとの先頭 1 枚",
      content: { "application/json": { schema: z.object({ covers: z.array(coverDtoSchema) }) } },
    },
    401: errorContent("未認証"),
    403: errorContent("未参加"),
    422: errorContent("クエリ不正"),
    502: errorContent("Storage の署名に失敗"),
  },
})

const listRoute = createRoute({
  method: "get",
  path: "/{id}/photos",
  tags: ["items"],
  summary: "item の写真一覧 (署名付き URL つき。VIEWER 以上)",
  request: { params: IdParamSchema },
  responses: {
    ...authErrorResponses,
    200: {
      description: "一覧 (古い順)",
      content: { "application/json": { schema: z.object({ photos: z.array(photoDtoSchema) }) } },
    },
    401: errorContent("未認証"),
    403: errorContent("未参加"),
    404: errorContent("item が存在しない"),
    422: errorContent("path param 不正"),
    502: errorContent("Storage の署名に失敗"),
  },
})

const uploadRoute = createRoute({
  method: "post",
  path: "/{id}/photos",
  tags: ["items"],
  summary: "item に写真を 1 枚付ける (EDITOR 以上。multipart。同じ photoId の再送は 200)",
  request: {
    params: IdParamSchema,
    body: { content: { "multipart/form-data": { schema: uploadFormSchema } }, required: true },
  },
  responses: {
    ...authErrorResponses,
    200: {
      description: "同じ photoId の再送 (記録済みの写真)",
      content: { "application/json": { schema: z.object({ photo: photoDtoSchema }) } },
    },
    201: {
      description: "追加",
      content: { "application/json": { schema: z.object({ photo: photoDtoSchema }) } },
    },
    401: errorContent("未認証"),
    403: errorContent("未参加 / role 不足"),
    404: errorContent("item が存在しない・削除済み"),
    413: errorContent("body が上限超過 / file が 2 MiB 超過"),
    422: errorContent(
      "ボディ不正 / JPEG ではない (PHOTO_TYPE_UNSUPPORTED) / 上限枚数 (PHOTO_LIMIT_EXCEEDED) / photoId が別内容で再利用 (IDEMPOTENCY_KEY_REUSED)",
    ),
    502: errorContent("Storage への upload に失敗 (何も付いていない)"),
  },
})

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}/photos/{photoId}",
  tags: ["items"],
  summary: "写真を削除 (EDITOR 以上。object の削除が後になっても 204)",
  request: { params: PhotoParamSchema },
  responses: {
    ...authErrorResponses,
    204: { description: "削除成功" },
    401: errorContent("未認証"),
    403: errorContent("未参加 / role 不足"),
    404: errorContent("item または、その item の写真が存在しない"),
    422: errorContent("path param 不正"),
  },
})

const body = (code: string, message: string) => ({ error: { code, message } }) as const

const ITEM_NOT_FOUND = body("NOT_FOUND", "item が見つかりません")
const PHOTO_NOT_FOUND = body("NOT_FOUND", "写真が見つかりません")
const TOO_LARGE = body("PAYLOAD_TOO_LARGE", "写真が大きすぎます")
const UNSUPPORTED = body("PHOTO_TYPE_UNSUPPORTED", "JPEG の写真だけ付けられます")
const LIMIT = body("PHOTO_LIMIT_EXCEEDED", "1 つの item に付けられる写真は上限までです")
const REUSED = body("IDEMPOTENCY_KEY_REUSED", "この photoId は別の内容で使われています")
const STORAGE_DOWN = body("STORAGE_UNAVAILABLE", "写真の保存先に接続できません")
const RETRY = body("TEMPORARILY_UNAVAILABLE", "しばらくしてから同じ写真をもう一度送ってください")
const NOT_CONFIGURED = body("PHOTO_STORAGE_NOT_CONFIGURED", "写真の保存先が設定されていません")

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff

const toDto = (row: PhotoRow, url: string | null): z.infer<typeof photoDtoSchema> => ({
  id: row.id,
  itemId: row.itemId,
  groupId: row.groupId,
  contentType: row.contentType,
  byteSize: row.byteSize,
  width: row.width,
  height: row.height,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  url,
})

// 署名できなくても写真の行は返す (url は null)。登録に成功した応答を署名の失敗で 502 にしない
async function dtoOf(
  storage: NonNullable<AppEnv["Variables"]["photoStorage"]>,
  row: PhotoRow,
): Promise<z.infer<typeof photoDtoSchema>> {
  try {
    const urls = await signPaths(storage, [row.storagePath])
    return toDto(row, urls.get(row.storagePath) ?? null)
  } catch {
    return toDto(row, null)
  }
}

const activeItem = async (db: AppEnv["Variables"]["db"], id: string) => {
  const [row] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, id), isNull(items.deletedAt)))
    .limit(1)
  return row
}

export const itemPhotosRouter = new OpenAPIHono<AppEnv>()
  .openapi(coversRoute, async (c) => {
    const storage = c.get("photoStorage")
    if (!storage) return c.json(NOT_CONFIGURED, 503)
    const { groupId } = c.req.valid("query")
    const covers = await listCovers(c.get("db"), groupId)
    let urls: Map<string, string>
    try {
      urls = await signPaths(
        storage,
        covers.map((r) => r.path),
      )
    } catch {
      return c.json(STORAGE_DOWN, 502)
    }
    return c.json(
      {
        covers: covers.flatMap((r) => {
          const url = urls.get(r.path)
          return url ? [{ itemId: r.itemId, photoId: r.photoId, url }] : []
        }),
      },
      200,
    )
  })
  .openapi(listRoute, async (c) => {
    const storage = c.get("photoStorage")
    if (!storage) return c.json(NOT_CONFIGURED, 503)
    const { id } = c.req.valid("param")
    const db = c.get("db")
    const item = await activeItem(db, id)
    if (!item) return c.json(ITEM_NOT_FOUND, 404)
    const access = await checkGroupAccess(db, c.get("userId"), item.groupId)
    if (!access.ok) return c.json(access.body, access.status)

    const rows = await listItemPhotos(db, id)
    let urls: Map<string, string>
    try {
      urls = await signPaths(
        storage,
        rows.map((r) => r.storagePath),
      )
    } catch {
      return c.json(STORAGE_DOWN, 502)
    }
    return c.json({ photos: rows.map((r) => toDto(r, urls.get(r.storagePath) ?? null)) }, 200)
  })
  .openapi(uploadRoute, async (c) => {
    const storage = c.get("photoStorage")
    if (!storage) return c.json(NOT_CONFIGURED, 503)
    const { id: itemId } = c.req.valid("param")
    const form = c.req.valid("form")
    const photoId = form.photoId.toLowerCase()
    const db = c.get("db")
    const now = c.get("photoClock")

    if (form.file.size > PHOTO_FILE_MAX_BYTES) return c.json(TOO_LARGE, 413)
    if (form.file.type !== PHOTO_CONTENT_TYPE) return c.json(UNSUPPORTED, 422)
    const bytes = new Uint8Array(await form.file.arrayBuffer())
    if (!isJpeg(bytes)) return c.json(UNSUPPORTED, 422)

    // 削除済みの item は 404。item を消すと写真も消えるので、削除済みの item に記録済みの写真は無い。
    // 兄弟の route と同じく group の確認より先に読み、削除済みの item の有無を 403 で見分けられないようにする
    const item = await activeItem(db, itemId)
    if (!item) return c.json(ITEM_NOT_FOUND, 404)
    const access = await checkGroupAccess(db, c.get("userId"), item.groupId, "EDITOR")
    if (!access.ok) return c.json(access.body, access.status)

    // 比べる itemId は DB の値 (小文字の標準形)。path の大文字の itemId のままだと、同じ写真の再送が別物になる
    const expect = { groupId: item.groupId, itemId: item.id, byteSize: bytes.length }
    const path = photoPath(item.groupId, photoId)

    const first = await probePhoto(db, photoId, expect)
    if (first.kind === "match") return c.json({ photo: await dtoOf(storage, first.row) }, 200)
    if (first.kind === "reused") return c.json(REUSED, 422)

    const cap = await checkCapEarly(db, photoId, expect)
    if (cap.kind === "replay") return c.json({ photo: await dtoOf(storage, cap.row) }, 200)
    if (cap.kind === "reused") return c.json(REUSED, 422)
    if (cap.kind === "limit") return c.json(LIMIT, 422)

    // 同じ path の object を他の要求が先に置いていたら、大きさが同じ若いものは引き取り、行が無いと確かめた古いものは
    // 消して置き直す。upload は上書きしない。2 周で決まらなければ断る
    let uploadStartedAt = now()
    let weUploaded = false
    // 引き取った object の作成時刻。登録の期限はここから数える (引き取った要求の開始からではない)
    let adoptedAtMs: number | null = null

    const place = async () => {
      for (let attempt = 0; attempt < 2 && !weUploaded && adoptedAtMs === null; attempt++) {
        let result: "ok" | "exists"
        try {
          // oxlint-disable-next-line no-await-in-loop
          result = await storage.upload(path, bytes, PHOTO_CONTENT_TYPE)
        } catch {
          return c.json(STORAGE_DOWN, 502)
        }
        if (result === "ok") {
          weUploaded = true
          continue
        }
        let existing: Awaited<ReturnType<typeof inspectExisting>>
        try {
          // oxlint-disable-next-line no-await-in-loop
          existing = await inspectExisting(
            db,
            storage,
            { ...expect, photoId, storagePath: path },
            now,
          )
        } catch {
          return c.json(RETRY, 503)
        }
        if (existing.kind === "replay") {
          // oxlint-disable-next-line no-await-in-loop
          return c.json({ photo: await dtoOf(storage, existing.row) }, 200)
        }
        if (existing.kind === "reused") return c.json(REUSED, 422)
        if (existing.kind === "young") adoptedAtMs = existing.createdAtMs
      }
      return !weUploaded && adoptedAtMs === null ? c.json(RETRY, 503) : null
    }
    const refused = await place()
    if (refused) return refused

    // 行を書く前に失敗したときの片付け。行が無いと lock の下で確かめられたときだけ、自分が上げた object を消す
    const cleanUp = async (): Promise<Settled | null> => {
      if (!weUploaded) return null
      try {
        return await settlePhoto(db, storage, {
          ...expect,
          photoId,
          storagePath: path,
          removeIfAbsent: true,
        })
      } catch {
        // 消せなければ object は残り、sweep が拾う
        return null
      }
    }

    const register = () =>
      registerPhoto(
        db,
        {
          ...expect,
          photoId,
          userId: c.get("userId"),
          storagePath: path,
          width: form.width ?? null,
          height: form.height ?? null,
          uploadStartedAt: adoptedAtMs ?? uploadStartedAt,
          // 引き取った object は、元の要求の補償の削除と重なって消えていることがある。lock の下で確かめる
          ...(adoptedAtMs === null
            ? {}
            : { verifyObject: async () => (await storage.stat(path)) !== null }),
        },
        now,
      )

    // commit の結果が分からない。photoId の lock を取れれば元の transaction は終わっているので、
    // その時点の行の有無で決める。lock を取れなければ object は触らず、同じ photoId で送り直してもらう
    const unclear = async (err: unknown) => {
      let settled: Settled
      try {
        settled = await settlePhoto(db, storage, {
          ...expect,
          photoId,
          storagePath: path,
          removeIfAbsent: weUploaded,
        })
      } catch {
        return c.json(RETRY, 503)
      }
      if (settled.kind === "match") return c.json({ photo: await dtoOf(storage, settled.row) }, 200)
      if (settled.kind === "reused") return c.json(REUSED, 422)
      throw err
    }

    let reg: Awaited<ReturnType<typeof registerPhoto>>
    try {
      reg = await register()
    } catch (err) {
      return await unclear(err)
    }

    if (reg.kind === "missing") {
      // 引き取った object が消えていた。自分の bytes を置き直して、期限も数え直して登録する
      try {
        if ((await storage.upload(path, bytes, PHOTO_CONTENT_TYPE)) !== "ok") {
          return c.json(RETRY, 503)
        }
      } catch {
        return c.json(STORAGE_DOWN, 502)
      }
      weUploaded = true
      adoptedAtMs = null
      uploadStartedAt = now()
      try {
        reg = await register()
      } catch (err) {
        return await unclear(err)
      }
    }

    switch (reg.kind) {
      case "created":
        return c.json({ photo: await dtoOf(storage, reg.row) }, 201)
      case "replay":
        return c.json({ photo: await dtoOf(storage, reg.row) }, 200)
      case "reused":
        return c.json(REUSED, 422)
      case "gone":
        await cleanUp()
        return c.json(ITEM_NOT_FOUND, 404)
      case "limit":
        await cleanUp()
        return c.json(LIMIT, 422)
      case "too_late":
        await cleanUp()
        return c.json(RETRY, 503)
      case "missing":
        return c.json(RETRY, 503)
    }
  })
  .openapi(deleteRoute, async (c) => {
    const storage = c.get("photoStorage")
    if (!storage) return c.json(NOT_CONFIGURED, 503)
    const { id, photoId } = c.req.valid("param")
    const db = c.get("db")
    const now = c.get("photoClock")

    const item = await activeItem(db, id)
    if (!item) return c.json(ITEM_NOT_FOUND, 404)
    const access = await checkGroupAccess(db, c.get("userId"), item.groupId, "EDITOR")
    if (!access.ok) return c.json(access.body, access.status)

    const row = await softDeletePhoto(db, id, photoId.toLowerCase(), now)
    if (!row) return c.json(PHOTO_NOT_FOUND, 404)

    // 行が消えた時点で写真は誰からも見えない。object の削除が失敗しても 204 で、sweep が残りを片付ける
    await removeObjectOf(db, storage, row, now)
    return c.body(null, 204)
  })
