import { users } from "@prep-hamster/db"
import { eq } from "drizzle-orm"
import { createMiddleware } from "hono/factory"
import { HTTPException } from "hono/http-exception"
import { Jwt } from "hono/utils/jwt"
import type { HonoJsonWebKey } from "hono/utils/jwt/jws"
import type { AppEnv } from "../app"

export type AuthOptions = {
  getKeys: (kid: string) => Promise<HonoJsonWebKey[]>
  issuer: string
  audience: string
}

const BEARER_PREFIX = "Bearer "
// users.id は uuid 型。形の違う sub を通すと insert が DB エラー (500) になる。
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const unauthorized = () => new HTTPException(401, { message: "valid access token required" })

// NOTE: 許可 alg を ES256 / RS256 に絞る。HS256 は共有秘密での検証になり、Supabase の公開鍵を
// HMAC の鍵として使う alg 混同攻撃の余地が生まれるため拒否する。
export const withUserAuth = (auth: AuthOptions) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header("authorization")
    if (!header?.startsWith(BEARER_PREFIX)) {
      throw unauthorized()
    }
    const token = header.slice(BEARER_PREFIX.length)

    let kid: string | undefined
    try {
      kid = Jwt.decode(token).header.kid
    } catch {
      throw unauthorized()
    }
    if (!kid) {
      throw unauthorized()
    }

    // 鍵が 1 度も取れていない (Supabase に届かない) ときだけここに来る。token の誤りではないので 503。
    let keys: HonoJsonWebKey[]
    try {
      keys = await auth.getKeys(kid)
    } catch {
      return c.json(
        { error: { code: "AUTH_UNAVAILABLE", message: "認証サーバに接続できません" } },
        503,
      )
    }

    let payload: Awaited<ReturnType<typeof Jwt.verifyWithJwks>>
    try {
      payload = await Jwt.verifyWithJwks(token, {
        keys,
        allowedAlgorithms: ["ES256", "RS256"],
        verification: { iss: auth.issuer, aud: auth.audience, exp: true },
      })
    } catch {
      throw unauthorized()
    }

    const sub = payload["sub"]
    const email = payload["email"]
    if (typeof sub !== "string" || !UUID.test(sub) || typeof email !== "string" || email === "") {
      throw unauthorized()
    }

    // アプリ側の users 行は初回リクエストで作る。行がある user は select 1 回で済ませる。
    const db = c.get("db")
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, sub))
    if (!existing) {
      const created = await db
        .insert(users)
        .values({ id: sub, email, displayName: email.replace(/@.*$/s, "") })
        .onConflictDoNothing()
        .returning({ id: users.id })
      // 同じ email の行が別 id で既にある (seed の行や、作り直した Supabase のアカウント)。
      // 黙って進むと後段の外部キーで 500 になるので、ここで 409 にする。
      if (created.length === 0) {
        // id が一致すれば同じアカウントなので通す (email はプロフィールで、食い違っても本人の判定には使わない)。
        const [raced] = await db.select({ id: users.id }).from(users).where(eq(users.id, sub))
        if (!raced) {
          return c.json(
            {
              error: {
                code: "EMAIL_IN_USE",
                message: "このメールアドレスは別のアカウントで使われています",
              },
            },
            409,
          )
        }
      }
    }

    c.set("userId", sub)
    return next()
  })
