import type { Context } from "hono"
import { createMiddleware } from "hono/factory"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "@hono/zod-openapi"
import { type Db, memberships } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import type { ApiErrorBody } from "./error"

// 全 groupId-scoped endpoint で「current user がその group の member であること」を強制する。
// 個別 route の handler から DB アクセス権チェックを取り除き、漏れを防ぐ。

export type Role = "OWNER" | "EDITOR" | "VIEWER"

// 上位 role が下位 role の権限を包含する: OWNER > EDITOR > VIEWER
const ROLE_RANK: Record<Role, number> = { OWNER: 3, EDITOR: 2, VIEWER: 1 }

export type Membership = typeof memberships.$inferSelect

export type GroupAccessEnv = {
  Variables: AppEnv["Variables"] & { membership: Membership }
}

export type ExtractGroupId = (c: Context) => string | undefined

const uuidSchema = z.string().uuid()

export type GroupAccessFailure = {
  ok: false
  status: 403
  body: ApiErrorBody
}

export type GroupAccessSuccess = {
  ok: true
  membership: Membership
}

export type GroupAccessResult = GroupAccessSuccess | GroupAccessFailure

// middleware から呼ぶ場合と、body.groupId / 関連リソース経由でしか groupId を解決できない
// handler から呼ぶ場合の両方で使えるよう、純関数として切り出した。
//
// groupId の UUID validation は呼び出し側 (body schema / middleware) で済ませている前提。
// ここでは認可ロジックだけに専念する。
export async function checkGroupAccess(
  db: Db,
  userId: string,
  groupId: string,
  requiredRole?: Role,
): Promise<GroupAccessResult> {
  const [member] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.groupId, groupId),
        isNull(memberships.deletedAt),
      ),
    )
    .limit(1)

  if (!member) {
    return {
      ok: false,
      status: 403,
      body: {
        error: {
          code: "FORBIDDEN_GROUP_ACCESS",
          message: "この group に対するアクセス権がありません",
        },
      },
    }
  }

  if (requiredRole) {
    // DB に想定外の role 文字列が入っていた場合は fail-closed で拒否する。
    // pgEnum で型は守られているはずだが、認可処理なので防御的に未知値を弾く。
    const memberRoleRank = ROLE_RANK[member.role as Role]
    if (memberRoleRank == null || memberRoleRank < ROLE_RANK[requiredRole]) {
      return {
        ok: false,
        status: 403,
        body: {
          error: {
            code: "INSUFFICIENT_ROLE",
            message: `${requiredRole} 以上の権限が必要です`,
          },
        },
      }
    }
  }

  return { ok: true, membership: member }
}

export const withGroupAccess = (extractGroupId: ExtractGroupId, requiredRole?: Role) =>
  createMiddleware<AppEnv & GroupAccessEnv>(async (c, next) => {
    const groupId = extractGroupId(c)
    if (!groupId || !uuidSchema.safeParse(groupId).success) {
      return c.json<ApiErrorBody>(
        {
          error: {
            code: "BAD_REQUEST",
            message: "有効な groupId が必要です",
          },
        },
        400,
      )
    }

    const db = c.get("db")
    const userId = c.get("userId")

    const result = await checkGroupAccess(db, userId, groupId, requiredRole)
    if (!result.ok) {
      return c.json<ApiErrorBody>(result.body, result.status)
    }

    c.set("membership", result.membership)
    await next()
    return
  })
