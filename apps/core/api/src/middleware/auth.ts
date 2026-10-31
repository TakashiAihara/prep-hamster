import { users } from "@prep-hamster/db"
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

    const keys = await auth.getKeys(kid)

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
    if (typeof sub !== "string" || typeof email !== "string" || email === "") {
      throw unauthorized()
    }

    // アプリ側の users 行は初回リクエストで作る。既に同じ email が別 id で居る場合はスキップし、
    // そのユーザーの一覧や権限は従来どおり 404 になる (本番では起きない dev seed 行だけが対象)。
    await c
      .get("db")
      .insert(users)
      .values({ id: sub, email, displayName: email.replace(/@.*$/s, "") })
      .onConflictDoNothing()

    c.set("userId", sub)
    await next()
  })
