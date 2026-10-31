import { beforeAll, beforeEach, expect, test } from "bun:test"
import { createApp } from "../src/app"
import { errorResponseSchema } from "../src/routes/schemas"
import { ensureMigrated, testDb, truncateAll } from "./setup"
import { seedBaseFixture } from "./seed"
import { bearer, e2eAuth } from "./auth-helper"

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
  const app = createApp({ db: testDb, auth: e2eAuth })

  const res = await app.request("/v1/groups", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await bearer(userId) },
    body: JSON.stringify({ name: "" }),
  })

  await expectValidationError(res, "name")
})

test("invalid query returns 422 VALIDATION_ERROR with the field in details", async () => {
  const { userId, groupId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })

  const res = await app.request(`/v1/stocks?groupId=${groupId}&expiringBefore=not-a-date`, {
    headers: { authorization: await bearer(userId) },
  })

  await expectValidationError(res, "expiringBefore")
})

test("invalid path param returns 422 VALIDATION_ERROR with the field in details", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })

  const res = await app.request("/v1/stocks/not-a-uuid", {
    headers: { authorization: await bearer(userId) },
  })

  await expectValidationError(res, "id")
})

test("malformed groupId in query is reported as groupId", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })

  const res = await app.request("/v1/stocks?groupId=not-a-uuid", {
    headers: { authorization: await bearer(userId) },
  })

  await expectValidationError(res, "groupId")
})

test("malformed group id in path is reported under the path param name", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })

  const byId = await app.request("/v1/groups/not-a-uuid", {
    headers: { authorization: await bearer(userId) },
  })
  await expectValidationError(byId, "id")

  const byGroupId = await app.request("/v1/groups/not-a-uuid/memberships", {
    headers: { authorization: await bearer(userId) },
  })
  await expectValidationError(byGroupId, "groupId")
})

test("missing groupId is reported with the required-field message, not the UUID one", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })

  const missing = await app.request("/v1/stocks", {
    headers: { authorization: await bearer(userId) },
  })
  const missingBody = (await missing.clone().json()) as ValidationBody
  await expectValidationError(missing, "groupId")

  const malformed = await app.request("/v1/stocks?groupId=not-a-uuid", {
    headers: { authorization: await bearer(userId) },
  })
  const malformedBody = (await malformed.json()) as ValidationBody
  expect(missingBody.error.message).not.toBe(malformedBody.error.message)
})

test("every operation with parameters or a request body declares 422 as ApiError in /openapi.json", async () => {
  const app = createApp({ db: testDb, auth: e2eAuth })

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

test("PATCH bodies declare only their always-required fields as required in /openapi.json", async () => {
  const app = createApp({ db: testDb, auth: e2eAuth })

  const spec = (await (await app.request("/openapi.json")).json()) as {
    components: { schemas: Record<string, { required?: string[]; minProperties?: number }> }
  }
  const schemas = spec.components.schemas

  expect(schemas["UpdateGroupBody"]?.required).toEqual(["name"])
  expect(schemas["UpdateMembershipRoleBody"]?.required).toEqual(["role"])
  expect(schemas["UpdateItemBody"]).toBeDefined()
  expect(schemas["UpdateItemBody"]?.required).toBeUndefined()
  for (const name of [
    "UpdateItemBody",
    "UpdateStockBody",
    "UpdateLocationBody",
    "UpdateCategoryBody",
  ]) {
    expect(schemas[name]?.minProperties).toBe(1)
  }
  expect(schemas["UpdateGroupBody"]?.minProperties).toBeUndefined()
})

test("every operation with a JSON request body declares 400, 413 and 415 as ApiError in /openapi.json", async () => {
  const app = createApp({ db: testDb, auth: e2eAuth })

  type Operation = {
    requestBody?: { content?: Record<string, unknown> }
    responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
  }
  const spec = (await (await app.request("/openapi.json")).json()) as {
    paths: Record<string, Record<string, Operation>>
  }

  const jsonBodyOps = Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods)
      .filter(([, op]) => op.requestBody?.content?.["application/json"])
      .map(([method, op]) => ({ name: `${method.toUpperCase()} ${path}`, op })),
  )
  expect(jsonBodyOps.length).toBe(18)

  const missing = jsonBodyOps.flatMap(({ name, op }) =>
    ["400", "413", "415"]
      .filter(
        (status) =>
          op.responses[status]?.content?.["application/json"]?.schema?.$ref !==
          "#/components/schemas/ApiError",
      )
      .map((status) => `${name} ${status}`),
  )
  expect(missing).toEqual([])
})

test("operations without a JSON request body declare neither 400 nor 415 in /openapi.json", async () => {
  const app = createApp({ db: testDb, auth: e2eAuth })

  type Operation = {
    requestBody?: { content?: Record<string, unknown> }
    responses: Record<string, unknown>
  }
  const spec = (await (await app.request("/openapi.json")).json()) as {
    paths: Record<string, Record<string, Operation>>
  }

  const noJsonBodyOps = Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods)
      .filter(([, op]) => !op.requestBody?.content?.["application/json"])
      .map(([method, op]) => ({ name: `${method.toUpperCase()} ${path}`, op })),
  )
  expect(noJsonBodyOps.length).toBeGreaterThan(10)

  const declared = noJsonBodyOps.flatMap(({ name, op }) =>
    ["400", "413", "415"]
      .filter((status) => status in op.responses)
      .map((status) => `${name} ${status}`),
  )
  expect(declared).toEqual([])
})

test("every /v1 operation declares 409 and 503 as ApiError in /openapi.json", async () => {
  const app = createApp({ db: testDb, auth: e2eAuth })

  type Operation = {
    responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
  }
  const spec = (await (await app.request("/openapi.json")).json()) as {
    paths: Record<string, Record<string, Operation>>
  }

  const v1Ops = Object.entries(spec.paths)
    .filter(([path]) => path.startsWith("/v1/"))
    .flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, op]) => ({
        name: `${method.toUpperCase()} ${path}`,
        op,
      })),
    )
  expect(v1Ops.length).toBe(35)

  const missing = v1Ops.flatMap(({ name, op }) =>
    ["409", "503"]
      .filter(
        (status) =>
          op.responses[status]?.content?.["application/json"]?.schema?.$ref !==
          "#/components/schemas/ApiError",
      )
      .map((status) => `${name} ${status}`),
  )
  expect(missing).toEqual([])
})

async function expectApiError(res: Response, status: number, code: string, message: string) {
  expect(res.status).toBe(status)
  const body = await res.json()
  expect(errorResponseSchema.safeParse(body).success).toBe(true)
  const error = (body as { error: { code: string; message: string } }).error
  expect(error.code).toBe(code)
  expect(error.message).toBe(message)
}

test("malformed JSON body returns 400 BAD_REQUEST", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })

  const res = await app.request("/v1/groups", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await bearer(userId) },
    body: "{not json",
  })

  await expectApiError(res, 400, "BAD_REQUEST", "JSON の形式が不正です")
})

test("JSON body without content-type returns 415 UNSUPPORTED_MEDIA_TYPE", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })

  // ReadableStream の body には runtime が content-type を自動付与しない
  // (文字列 body だと Node の undici は text/plain を付けてしまう)。
  // 「content-type なし」を runtime 非依存にするため stream で送る。
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ name: "x" })))
      controller.close()
    },
  })

  const res = await app.request("/v1/groups", {
    method: "POST",
    headers: { authorization: await bearer(userId) },
    body,
    duplex: "half",
  })

  await expectApiError(
    res,
    415,
    "UNSUPPORTED_MEDIA_TYPE",
    "Content-Type は application/json を指定してください",
  )
})

test("JSON body with text/plain content-type returns 415 UNSUPPORTED_MEDIA_TYPE", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })

  const res = await app.request("/v1/groups", {
    method: "POST",
    headers: { "content-type": "text/plain", authorization: await bearer(userId) },
    body: JSON.stringify({ name: "x" }),
  })

  await expectApiError(
    res,
    415,
    "UNSUPPORTED_MEDIA_TYPE",
    "Content-Type は application/json を指定してください",
  )
})

test("body over 1 MiB returns 413 PAYLOAD_TOO_LARGE", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })

  const res = await app.request("/v1/groups", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await bearer(userId) },
    body: "a".repeat(1024 * 1024 + 1),
  })

  await expectApiError(res, 413, "PAYLOAD_TOO_LARGE", "リクエストが大きすぎます")
})
