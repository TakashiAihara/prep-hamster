import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, eq, isNull } from "drizzle-orm"
import { invitations, memberships } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import { withGroupAccess } from "../middleware/group-access"
import {
  createInvitationBodyDtoSchema,
  errorResponseSchema,
  invitationDtoSchema,
  membershipDtoSchema,
} from "./schemas"

const GroupParamSchema = z.object({
  groupId: z
    .string()
    .uuid()
    .openapi({ param: { name: "groupId", in: "path" } }),
})

const TokenParamSchema = z.object({
  token: z
    .string()
    .min(1)
    .openapi({ param: { name: "token", in: "path" } }),
})

const DEFAULT_EXPIRES_IN_DAYS = 7

const toInvitationDto = (
  row: typeof invitations.$inferSelect,
): z.infer<typeof invitationDtoSchema> => ({
  id: row.id,
  groupId: row.groupId,
  inviterId: row.inviterId,
  role: row.role,
  token: row.token,
  expiresAt: row.expiresAt.toISOString(),
  usedAt: row.usedAt ? row.usedAt.toISOString() : null,
  usedBy: row.usedBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
})

const createInvitationRoute = createRoute({
  method: "post",
  path: "/groups/{groupId}/invitations",
  tags: ["invitations"],
  summary: "招待トークンを発行 (OWNER のみ)",
  middleware: [withGroupAccess((c) => c.req.param("groupId"), "OWNER")] as const,
  request: {
    params: GroupParamSchema,
    body: { content: { "application/json": { schema: createInvitationBodyDtoSchema } } },
  },
  responses: {
    201: {
      description: "発行成功",
      content: {
        "application/json": {
          schema: z.object({ invitation: invitationDtoSchema }),
        },
      },
    },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    403: {
      description: "OWNER でない / 未参加",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    422: {
      description: "ボディ不正",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const acceptInvitationRoute = createRoute({
  method: "post",
  path: "/invitations/{token}/accept",
  tags: ["invitations"],
  summary: "招待トークンで group に参加",
  request: { params: TokenParamSchema },
  responses: {
    201: {
      description: "参加成功 (新規 membership)",
      content: {
        "application/json": {
          schema: z.object({ membership: membershipDtoSchema }),
        },
      },
    },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "token が存在しない",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    409: {
      description: "token 使用済み / 既に当該 group の member",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    422: {
      description: "token 期限切れ",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

export const invitationsRouter = new OpenAPIHono<AppEnv>()
  .openapi(createInvitationRoute, async (c) => {
    const { groupId } = c.req.valid("param")
    const body = c.req.valid("json")
    const db = c.get("db")
    const inviterId = c.get("userId")

    const expiresInDays = body.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)

    const [created] = await db
      .insert(invitations)
      .values({
        id: crypto.randomUUID(),
        groupId,
        inviterId,
        role: body.role,
        // v1.0.0 では UUID をそのまま token に使う。URL safe で衝突確率も無視できる。
        // 推測されにくくしたいなら別 Issue で `randomBytes(32).toString("base64url")` 等に置換可能。
        token: crypto.randomUUID(),
        expiresAt,
      })
      .returning()
    if (!created) {
      throw new Error("invitation insert returned no row")
    }

    return c.json({ invitation: toInvitationDto(created) }, 201)
  })
  .openapi(acceptInvitationRoute, async (c) => {
    const { token } = c.req.valid("param")
    const db = c.get("db")
    const userId = c.get("userId")

    const [invitation] = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.token, token), isNull(invitations.deletedAt)))
      .limit(1)
    if (!invitation) {
      return c.json({ error: { code: "NOT_FOUND", message: "招待トークンが見つかりません" } }, 404)
    }
    if (invitation.usedAt) {
      return c.json(
        {
          error: { code: "INVITATION_USED", message: "招待トークンは使用済みです" },
        },
        409,
      )
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      return c.json(
        {
          error: { code: "INVITATION_EXPIRED", message: "招待トークンの有効期限が切れています" },
        },
        422,
      )
    }

    // 既に member の場合は冪等性を取らず 409 を返す。再 invite ではなく前回の token を使い直す
    // のが想定運用なため、エラーで知らせた方が分かりやすい。
    const [existing] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.groupId, invitation.groupId),
          eq(memberships.userId, userId),
          isNull(memberships.deletedAt),
        ),
      )
      .limit(1)
    if (existing) {
      return c.json(
        {
          error: {
            code: "ALREADY_MEMBER",
            message: "既に当該 group の member です",
          },
        },
        409,
      )
    }

    const now = new Date()
    const created = await db.transaction(async (tx) => {
      // membership 作成と invitation 消化を 1 tx に閉じる。
      // 失敗時に「token は消えたが membership は無い」状態を防ぐ。
      const [m] = await tx
        .insert(memberships)
        .values({
          id: crypto.randomUUID(),
          userId,
          groupId: invitation.groupId,
          role: invitation.role,
          joinedAt: now,
        })
        .returning()
      if (!m) {
        throw new Error("membership insert returned no row")
      }
      await tx
        .update(invitations)
        .set({ usedAt: now, usedBy: userId, updatedAt: now })
        .where(eq(invitations.id, invitation.id))
      return m
    })

    return c.json(
      {
        membership: {
          id: created.id,
          userId: created.userId,
          groupId: created.groupId,
          role: created.role,
          joinedAt: created.joinedAt.toISOString(),
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
          deletedAt: created.deletedAt ? created.deletedAt.toISOString() : null,
        },
      },
      201,
    )
  })
