import { expect, test } from "bun:test"
import type { ApiClient } from "@prep-hamster/api-client"
import {
  buildUploadForm,
  createConfirmDeletePhoto,
  deletePhoto,
  isRetrySafeStatus,
  listPhotos,
  newPhotoAttempt,
  resizePlan,
  uploadErrorMessage,
  uploadPhoto,
} from "../photo-upload"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const PHOTO = {
  id: "11111111-1111-4111-8111-111111111111",
  itemId: "22222222-2222-4222-8222-222222222222",
  byteSize: 300,
  width: 1280,
  height: 960,
  url: "https://storage.test/p",
}

const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" })

test("resizePlan shrinks the long edge to 1280 and never enlarges", () => {
  expect(resizePlan(4000, 3000)).toEqual({ width: 1280 })
  expect(resizePlan(3000, 4000)).toEqual({ height: 1280 })
  expect(resizePlan(3000, 3000)).toEqual({ width: 1280 })
  expect(resizePlan(1280, 720)).toBeNull()
  expect(resizePlan(720, 1281)).toEqual({ height: 1280 })
  expect(resizePlan(800, 600)).toBeNull()
})

test("newPhotoAttempt takes its id from the generator, one per picked photo", () => {
  const ids = ["a", "b"]
  const attempt = newPhotoAttempt(() => ids.shift() ?? "")

  expect(attempt).toEqual({ photoId: "a" })
  expect(newPhotoAttempt(() => ids.shift() ?? "")).toEqual({ photoId: "b" })
})

test("buildUploadForm sends file, photoId and whole-number dimensions", () => {
  const form = buildUploadForm(file, { photoId: "pid" }, { width: 1279.6, height: 959.6 })

  expect(form.get("photoId")).toBe("pid")
  expect(form.get("width")).toBe("1280")
  expect(form.get("height")).toBe("960")
  expect(form.get("file")).toBeInstanceOf(Blob)
})

test("uploadPhoto posts multipart to the item's photos route without a content-type header", async () => {
  let seen: { url: string; init: RequestInit | undefined } | null = null
  const result = await uploadPhoto(
    {
      baseUrl: "http://api.test",
      fetch: async (url, init) => {
        seen = { url: String(url), init }
        return json({ photo: PHOTO }, 201)
      },
    },
    PHOTO.itemId,
    file,
    { width: 1280, height: 960 },
    { photoId: PHOTO.id },
  )

  expect(result).toEqual({ ok: true, photo: PHOTO, replay: false })
  const sent = seen!
  const init = sent.init!
  expect(sent.url).toBe(`http://api.test/v1/items/${PHOTO.itemId}/photos`)
  expect(init.method).toBe("POST")
  expect(init.headers).toBeUndefined()
  expect((init.body as FormData).get("photoId")).toBe(PHOTO.id)
})

test("uploadPhoto reports a 200 as a replay of the same photo", async () => {
  const result = await uploadPhoto(
    { baseUrl: "http://x", fetch: async () => json({ photo: PHOTO }, 200) },
    PHOTO.itemId,
    file,
    { width: 1, height: 1 },
    { photoId: PHOTO.id },
  )

  expect(result).toMatchObject({ ok: true, replay: true })
})

test("uploadPhoto: a network failure keeps the photoId for a retry", async () => {
  const result = await uploadPhoto(
    {
      baseUrl: "http://x",
      fetch: async () => {
        throw new TypeError("Network request failed")
      },
    },
    PHOTO.itemId,
    file,
    { width: 1, height: 1 },
    { photoId: PHOTO.id },
  )

  expect(result).toEqual({
    ok: false,
    message: "通信できませんでした。電波の良い場所で、もう一度同じ写真を送ってください",
    retrySamePhotoId: true,
  })
})

const rejectedWith = (status: number, code: string) =>
  uploadPhoto(
    {
      baseUrl: "http://x",
      fetch: async () => json({ error: { code, message: "server text" } }, status),
    },
    PHOTO.itemId,
    file,
    { width: 1, height: 1 },
    { photoId: PHOTO.id },
  )

test("uploadPhoto: a rejection carries the message for the server's code", async () => {
  expect(await rejectedWith(422, "PHOTO_LIMIT_EXCEEDED")).toMatchObject({
    message: "写真は 1 つの商品に 5 枚までです",
  })
})

test("uploadPhoto: a server-decided rejection asks for a new photoId, a transient one does not", async () => {
  expect(await rejectedWith(422, "PHOTO_LIMIT_EXCEEDED")).toMatchObject({
    ok: false,
    retrySamePhotoId: false,
  })
  expect(await rejectedWith(422, "IDEMPOTENCY_KEY_REUSED")).toMatchObject({
    ok: false,
    retrySamePhotoId: false,
  })
  expect(await rejectedWith(503, "TEMPORARILY_UNAVAILABLE")).toMatchObject({
    ok: false,
    retrySamePhotoId: true,
  })
  expect(await rejectedWith(502, "STORAGE_UNAVAILABLE")).toMatchObject({
    ok: false,
    retrySamePhotoId: true,
  })
})

test("isRetrySafeStatus: 408, 429 and 5xx only", () => {
  expect([400, 401, 403, 404, 409, 413, 422].map(isRetrySafeStatus)).toEqual(Array(7).fill(false))
  expect([408, 429, 500, 502, 503].map(isRetrySafeStatus)).toEqual(Array(5).fill(true))
})

test("uploadErrorMessage maps each reason to Japanese text the user can act on", () => {
  const none = { code: null, message: null }

  expect(uploadErrorMessage(413, none)).toBe("写真が大きすぎます (2 MB まで)")
  expect(uploadErrorMessage(422, { code: "PHOTO_TYPE_UNSUPPORTED", message: null })).toBe(
    "JPEG の写真だけ付けられます",
  )
  expect(uploadErrorMessage(422, { code: "PHOTO_LIMIT_EXCEEDED", message: null })).toBe(
    "写真は 1 つの商品に 5 枚までです",
  )
  expect(uploadErrorMessage(403, none)).toBe("この商品に写真を付ける権限がありません")
  expect(uploadErrorMessage(404, none)).toBe("商品が見つかりません")
  expect(uploadErrorMessage(418, { code: null, message: "teapot" })).toBe("teapot")
  expect(uploadErrorMessage(418, none)).toBe("写真を追加できませんでした (HTTP 418)")
  expect(uploadErrorMessage(422, { code: "IDEMPOTENCY_KEY_REUSED", message: null })).toBe(
    "この写真は送れませんでした。もう一度写真を選んでください",
  )
  const storage = "写真の保存先に接続できませんでした。しばらくしてからもう一度試してください"
  for (const code of [
    "STORAGE_UNAVAILABLE",
    "TEMPORARILY_UNAVAILABLE",
    "PHOTO_STORAGE_NOT_CONFIGURED",
  ]) {
    expect(uploadErrorMessage(503, { code, message: null })).toBe(storage)
  }
  expect(uploadErrorMessage(500, none)).toBe(storage)
})

// hono client の `client.v1.items[":id"].photos.$get` / `[":photoId"].$delete` の形だけを模した偽物
const fakeClient = (get: () => Promise<Response>, del: () => Promise<Response>) =>
  ({
    v1: {
      items: {
        ":id": {
          photos: {
            $get: get,
            ":photoId": { $delete: del },
          },
        },
      },
    },
  }) as unknown as ApiClient

test("listPhotos returns the photos, or the API's message on failure", async () => {
  const ok = await listPhotos(
    fakeClient(
      async () => json({ photos: [PHOTO] }),
      async () => json({}),
    ),
    PHOTO.itemId,
  )
  const bad = await listPhotos(
    fakeClient(
      async () => json({ error: { message: "権限なし" } }, 403),
      async () => json({}),
    ),
    PHOTO.itemId,
  )

  expect(ok).toEqual({ ok: true, photos: [PHOTO] })
  expect(bad).toEqual({ ok: false, message: "権限なし" })
})

test("deletePhoto: 204 and 404 both leave the photo gone; other failures carry the message", async () => {
  const run = (res: Response) =>
    deletePhoto(
      fakeClient(
        async () => json({}),
        async () => res,
      ),
      PHOTO.itemId,
      PHOTO.id,
    )

  expect(await run(new Response(null, { status: 204 }))).toEqual({ ok: true })
  expect(await run(json({ error: { message: "x" } }, 404))).toEqual({ ok: true })
  expect(await run(json({ error: { message: "権限なし" } }, 403))).toEqual({
    ok: false,
    message: "権限なし",
  })
})

test("createConfirmDeletePhoto uses window.confirm on web and resolves false when the alert is dismissed", async () => {
  const web = createConfirmDeletePhoto({
    os: "web",
    webConfirm: (m) => m.includes("写真を削除しますか"),
    alert: () => {
      throw new Error("alert must not be used on web")
    },
  })
  expect(await web()).toBe(true)

  const native = createConfirmDeletePhoto({
    os: "android",
    webConfirm: () => {
      throw new Error("confirm must not be used on native")
    },
    alert: (_t, _m, _b, options) => options?.onDismiss?.(),
  })
  expect(await native()).toBe(false)

  const cancelled = createConfirmDeletePhoto({
    os: "ios",
    webConfirm: () => true,
    alert: (_t, _m, buttons) => buttons?.find((b) => b.style === "cancel")?.onPress?.(),
  })
  expect(await cancelled()).toBe(false)

  const accepted = createConfirmDeletePhoto({
    os: "ios",
    webConfirm: () => false,
    alert: (_t, _m, buttons) => buttons?.find((b) => b.style === "destructive")?.onPress?.(),
  })
  expect(await accepted()).toBe(true)
})
