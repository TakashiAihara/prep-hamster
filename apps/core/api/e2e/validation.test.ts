import { beforeAll, beforeEach, expect, test } from "bun:test"
import { createApp } from "../src/app"
import { errorResponseSchema } from "../src/routes/schemas"
import { ensureMigrated, testDb, truncateAll } from "./setup"
import { seedBaseFixture } from "./seed"

type ValidationBody = {
  error: { code: string; message: string; details: { fieldErrors: Record<string, string[]> } }
}

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

const FALLBACK_MESSAGE = "リクエストの形式が不正です"

async function expectValidationError(res: Response, field: string) {
  expect(res.status).toBe(422)
  const body = (await res.json()) as ValidationBody
  expect(errorResponseSchema.safeParse(body).success).toBe(true)
  expect(body.error.code).toBe("VALIDATION_ERROR")
  const messages = body.error.details.fieldErrors[field]
  expect(messages?.length).toBeGreaterThan(0)
  // e2e/setup.ts が入れた ja error map の文言であって、validationErrorResponse のフォールバックではない。
  expect(messages?.[0]).toBe(body.error.message)
  expect(body.error.message).not.toBe(FALLBACK_MESSAGE)
  expect(body.error.message).toMatch(/[ぁ-んァ-ン一-龥]/)
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

test("missing groupId is reported with the required-field message, not the UUID one", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb })

  const missing = await app.request("/v1/stocks", { headers: { "x-user-id": userId } })
  const missingBody = (await missing.clone().json()) as ValidationBody
  await expectValidationError(missing, "groupId")

  const malformed = await app.request("/v1/stocks?groupId=not-a-uuid", {
    headers: { "x-user-id": userId },
  })
  const malformedBody = (await malformed.json()) as ValidationBody
  expect(missingBody.error.message).not.toBe(malformedBody.error.message)
})

test("every operation with parameters or a request body declares 422 as ApiError in /openapi.json", async () => {
  const app = createApp({ db: testDb })

  type Operation = {
    parameters?: unknown[]
    requestBody?: unknown
    responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
  }
  const spec = (await (await app.request("/openapi.json")).json()) as {
    paths: Record<string, Record<string, Operation>>
  }

  const validated = Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods)
      .filter(([, op]) => (op.parameters?.length ?? 0) > 0 || op.requestBody)
      .map(([method, op]) => ({ name: `${method.toUpperCase()} ${path}`, op })),
  )
  expect(validated.length).toBeGreaterThan(20)

  const missing = validated
    .filter(
      ({ op }) =>
        op.responses["422"]?.content?.["application/json"]?.schema?.$ref !==
        "#/components/schemas/ApiError",
    )
    .map(({ name }) => name)
  expect(missing).toEqual([])
})
