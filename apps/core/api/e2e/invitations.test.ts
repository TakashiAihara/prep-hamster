import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { invitations } from "@prep-hamster/db"
import { createApp } from "../src/app"
import { seedGroupWithMembership, seedMembership, seedUser } from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

async function createInvitation(
  ownerId: string,
  groupId: string,
  role: "EDITOR" | "VIEWER" = "EDITOR",
) {
  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/groups/${groupId}/invitations`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": ownerId },
    body: JSON.stringify({ role }),
  })
  if (res.status !== 201) {
    throw new Error(`createInvitation failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as { invitation: { token: string; role: string; groupId: string } }
}

test("POST /v1/groups/:groupId/invitations issues a token (OWNER only)", async () => {
  const ownerId = await seedUser("owner")
  const groupId = await seedGroupWithMembership(ownerId)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/groups/${groupId}/invitations`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": ownerId },
    body: JSON.stringify({ role: "EDITOR" }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as {
    invitation: { token: string; role: string; expiresAt: string; groupId: string }
  }
  expect(body.invitation.role).toBe("EDITOR")
  expect(body.invitation.token).toMatch(/^[0-9a-f-]{36}$/)
  expect(body.invitation.groupId).toBe(groupId)
  // 期限は default 7 日後 (前後 1 分の許容)
  const diff = new Date(body.invitation.expiresAt).getTime() - Date.now()
  expect(diff).toBeGreaterThan(6 * 24 * 60 * 60 * 1000)
  expect(diff).toBeLessThan(8 * 24 * 60 * 60 * 1000)
})

test("POST /v1/groups/:groupId/invitations by EDITOR returns 403", async () => {
  const ownerId = await seedUser("owner")
  const editorId = await seedUser("editor")
  const groupId = await seedGroupWithMembership(ownerId)
  await seedMembership(editorId, groupId, "EDITOR")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/groups/${groupId}/invitations`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": editorId },
    body: JSON.stringify({ role: "EDITOR" }),
  })
  expect(res.status).toBe(403)
})

test("POST /v1/invitations/:token/accept creates membership and marks token used", async () => {
  const ownerId = await seedUser("owner")
  const newcomerId = await seedUser("newcomer")
  const groupId = await seedGroupWithMembership(ownerId)
  const created = await createInvitation(ownerId, groupId, "EDITOR")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/invitations/${created.invitation.token}/accept`, {
    method: "POST",
    headers: { "x-user-id": newcomerId },
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { membership: { userId: string; role: string } }
  expect(body.membership.userId).toBe(newcomerId)
  expect(body.membership.role).toBe("EDITOR")

  // token は used 状態に更新される
  const [row] = await testDb
    .select()
    .from(invitations)
    .where(eq(invitations.token, created.invitation.token))
    .limit(1)
  expect(row?.usedAt).not.toBeNull()
  expect(row?.usedBy).toBe(newcomerId)
})

test("accept on used token returns 409 INVITATION_USED", async () => {
  const ownerId = await seedUser("owner")
  const a = await seedUser("a")
  const b = await seedUser("b")
  const groupId = await seedGroupWithMembership(ownerId)
  const created = await createInvitation(ownerId, groupId)

  const app = createApp({ db: testDb })
  const first = await app.request(`/v1/invitations/${created.invitation.token}/accept`, {
    method: "POST",
    headers: { "x-user-id": a },
  })
  expect(first.status).toBe(201)

  const second = await app.request(`/v1/invitations/${created.invitation.token}/accept`, {
    method: "POST",
    headers: { "x-user-id": b },
  })
  expect(second.status).toBe(409)
  const body = (await second.json()) as { error: { code: string } }
  expect(body.error.code).toBe("INVITATION_USED")
})

test("accept on expired token returns 422 INVITATION_EXPIRED", async () => {
  const ownerId = await seedUser("owner")
  const newcomerId = await seedUser("newcomer")
  const groupId = await seedGroupWithMembership(ownerId)
  const created = await createInvitation(ownerId, groupId)

  // expiresAt を過去に手動で書き戻す
  await testDb
    .update(invitations)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(invitations.token, created.invitation.token))

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/invitations/${created.invitation.token}/accept`, {
    method: "POST",
    headers: { "x-user-id": newcomerId },
  })
  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("INVITATION_EXPIRED")
})

test("accept by existing member returns 409 ALREADY_MEMBER", async () => {
  const ownerId = await seedUser("owner")
  const editorId = await seedUser("editor")
  const groupId = await seedGroupWithMembership(ownerId)
  await seedMembership(editorId, groupId, "EDITOR")
  const created = await createInvitation(ownerId, groupId)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/invitations/${created.invitation.token}/accept`, {
    method: "POST",
    headers: { "x-user-id": editorId },
  })
  expect(res.status).toBe(409)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("ALREADY_MEMBER")
})

test("accept on non-existent token returns 404", async () => {
  const userId = await seedUser()

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/invitations/${crypto.randomUUID()}/accept`, {
    method: "POST",
    headers: { "x-user-id": userId },
  })
  expect(res.status).toBe(404)
})
