import { expect, test } from "bun:test"
import { Hono } from "hono"
import type { Db } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import { withUserAuth } from "../middleware/auth"
import { withDb } from "../middleware/db"
import { onError } from "../middleware/error"
import { USER_ID, createTestKey, signAccessToken, testAuth } from "./auth-fixture"

// 同じ user の初回リクエストが 2 本同時に来て、こちらの insert の前に相手が行を作った状態を作る。
// select は 1 回目に空、2 回目に行を返し、insert は id の衝突で何も返さない。
const racedDb = () => {
  let selects = 0
  return {
    select: () => ({
      from: () => ({ where: async () => (selects++ === 0 ? [] : [{ id: USER_ID }]) }),
    }),
    insert: () => ({
      values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }),
    }),
  } as unknown as Db
}

test("a first request that loses the insert race to the same user is let through", async () => {
  const key = await createTestKey("unit")
  const app = new Hono<AppEnv>()
    .onError(onError)
    .use("*", withDb(racedDb()))
    .use("*", withUserAuth(testAuth(key.publicJwk)))
    .get("/me", (c) => c.json({ userId: c.get("userId") }))

  const jwt = await signAccessToken(key.privateJwk)
  const res = await app.request("/me", { headers: { authorization: `Bearer ${jwt}` } })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ userId: USER_ID })
})
