import { beforeAll, beforeEach, expect, test } from "bun:test"
import { installJaErrorMap } from "@prep-hamster/schema"
import { createApp } from "../src/app"
import { errorResponseSchema } from "../src/routes/schemas"
import { ensureMigrated, testDb, truncateAll } from "./setup"
import { seedBaseFixture } from "./seed"

type ValidationBody = {
  error: { code: string; message: string; details: { fieldErrors: Record<string, string[]> } }
}

beforeAll(async () => {
  await ensureMigrated()
  // createApp は error map を入れない (index.ts の起動時だけ)。message の言語まで固定するため明示する。
  installJaErrorMap()
})

beforeEach(async () => {
  await truncateAll()
})

async function expectValidationError(res: Response, field: string) {
  expect(res.status).toBe(422)
  const body = (await res.json()) as ValidationBody
  expect(errorResponseSchema.safeParse(body).success).toBe(true)
  expect(body.error.code).toBe("VALIDATION_ERROR")
  expect(body.error.message).toMatch(/[ぁ-んァ-ン一-龥]/)
  expect(Object.keys(body.error.details.fieldErrors)).toContain(field)
}

test("invalid body returns 422 VALIDATION_ERROR with the field in details", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb })

  const res = await app.request("/v1/groups", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ name: "" }),
  })

  await expectValidationError(res, "name")
})

test("invalid query returns 422 VALIDATION_ERROR with the field in details", async () => {
  const { userId, groupId } = await seedBaseFixture()
  const app = createApp({ db: testDb })

  const res = await app.request(`/v1/stocks?groupId=${groupId}&expiringBefore=not-a-date`, {
    headers: { "x-user-id": userId },
  })

  await expectValidationError(res, "expiringBefore")
})

test("invalid path param returns 422 VALIDATION_ERROR with the field in details", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb })

  const res = await app.request("/v1/stocks/not-a-uuid", { headers: { "x-user-id": userId } })

  await expectValidationError(res, "id")
})

test("malformed groupId in query is reported as groupId", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb })

  const res = await app.request("/v1/stocks?groupId=not-a-uuid", {
    headers: { "x-user-id": userId },
  })

  await expectValidationError(res, "groupId")
})

test("malformed group id in path is reported under the path param name", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb })

  const byId = await app.request("/v1/groups/not-a-uuid", { headers: { "x-user-id": userId } })
  await expectValidationError(byId, "id")

  const byGroupId = await app.request("/v1/groups/not-a-uuid/memberships", {
    headers: { "x-user-id": userId },
  })
  await expectValidationError(byGroupId, "groupId")
})

test("/openapi.json declares the same ApiError schema for 422", async () => {
  const app = createApp({ db: testDb })

  const spec = (await (await app.request("/openapi.json")).json()) as {
    paths: Record<string, Record<string, { responses: Record<string, unknown> }>>
  }

  expect(spec.paths["/v1/groups"]?.["post"]?.responses["422"]).toEqual({
    description: expect.any(String),
    content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
  })
})
