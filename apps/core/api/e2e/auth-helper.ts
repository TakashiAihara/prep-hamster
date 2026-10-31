import { createTestKey, signAccessToken, testAuth } from "../src/__tests__/auth-fixture"

// テストプロセスごとに 1 組の鍵を作り、全 e2e が同じ公開鍵で検証する。
const key = await createTestKey("e2e")

export const e2eKey = key
export const e2eAuth = testAuth(key.publicJwk)

// email は id から作る。seed 済みの users 行があれば id の衝突で insert は何もしない。
export const bearer = async (userId: string) =>
  `Bearer ${await signAccessToken(key.privateJwk, { sub: userId, email: `${userId}@example.test` })}`
