import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { createClient } from "@supabase/supabase-js"
import { provisionPhotoBucket } from "../scripts/provision-photo-bucket"
import { createApp } from "../src/app"
import { PHOTO_BUCKET, photoPath } from "../src/photos/config"
import { createSupabasePhotoStorage, StorageFailure } from "../src/photos/storage"
import { bearer, e2eAuth } from "./auth-helper"
import { jpeg, photoForm, setupPhotos } from "./photo-helper"
import { ensureMigrated, testDb, truncateAll } from "./setup"

// 本物の Supabase Storage に対する確認 (opt-in)。偽物 (fake-photo-storage.ts) が応答の形で分岐を押さえているので、
// その形が本物と同じことを 1 度ここで確かめる。次の env が無ければ全部 skip する:
//   PHOTO_STORAGE_TEST_URL         Storage を持つ Supabase の URL (例: http://127.0.0.1:54321)
//   PHOTO_STORAGE_TEST_SECRET_KEY  その secret key (service_role)
//   PHOTO_STORAGE_TEST_ANON_KEY    publishable / anon key (無ければ公開鍵での拒否の確認だけ skip)
const url = process.env["PHOTO_STORAGE_TEST_URL"]
const secretKey = process.env["PHOTO_STORAGE_TEST_SECRET_KEY"]
const anonKey = process.env["PHOTO_STORAGE_TEST_ANON_KEY"]
const enabled = Boolean(url && secretKey)

const suite = enabled ? describe : describe.skip
if (!enabled)
  console.warn("skipped: PHOTO_STORAGE_TEST_URL / PHOTO_STORAGE_TEST_SECRET_KEY are not set")

const base = (url ?? "").replace(/\/+$/, "")
const admin = createClient(base || "http://unset.invalid", secretKey ?? "unset", {
  auth: { persistSession: false, autoRefreshToken: false },
})
const storage = createSupabasePhotoStorage(base || "http://unset.invalid", secretKey ?? "unset")

const group = crypto.randomUUID()
const created: string[] = []
const newPath = () => {
  const p = photoPath(group, crypto.randomUUID())
  created.push(p)
  return p
}

suite("real Supabase Storage", () => {
  beforeAll(async () => {
    await provisionPhotoBucket(admin.storage)
  })

  afterAll(async () => {
    await admin.storage.from(PHOTO_BUCKET.name).remove(created)
  })

  test("provisioning leaves a private bucket with the 2 MiB limit and image/jpeg only", async () => {
    const { data, error } = await admin.storage.getBucket(PHOTO_BUCKET.name)

    expect(error).toBeNull()
    expect(data?.public).toBe(false)
    expect(data?.file_size_limit).toBe(2097152)
    expect(data?.allowed_mime_types).toEqual(["image/jpeg"])
  })

  test("upload answers ok once and 'exists' for the same path (HTTP 400 with statusCode 409)", async () => {
    const path = newPath()

    expect(await storage.upload(path, jpeg(300), "image/jpeg")).toBe("ok")
    expect(await storage.upload(path, jpeg(300, 2), "image/jpeg")).toBe("exists")
    // 上書きされていない
    expect((await storage.stat(path))?.size).toBe(300)
    const raw = await admin.storage.from(PHOTO_BUCKET.name).upload(path, jpeg(300), {
      contentType: "image/jpeg",
      upsert: false,
    })
    expect(String((raw.error as { statusCode?: unknown }).statusCode)).toBe("409")
    expect(raw.error?.message).toBe("The resource already exists")
  })

  test("stat reads createdAt (camelCase from info()) and size; a missing object is null", async () => {
    const path = newPath()
    await storage.upload(path, jpeg(321), "image/jpeg")

    const stat = await storage.stat(path)

    expect(stat?.size).toBe(321)
    expect(Math.abs((stat?.createdAt.getTime() ?? 0) - Date.now())).toBeLessThan(5 * 60 * 1000)
    const info = await admin.storage.from(PHOTO_BUCKET.name).info(path)
    expect(Object.keys(info.data ?? {})).toContain("createdAt")
    expect(Object.keys(info.data ?? {})).not.toContain("created_at")
    expect(await storage.stat(photoPath(group, crypto.randomUUID()))).toBeNull()
  })

  test("signUrls returns fetchable URLs for existing objects and leaves a missing path out", async () => {
    const path = newPath()
    await storage.upload(path, jpeg(400), "image/jpeg")
    const missing = photoPath(group, crypto.randomUUID())

    const urls = await storage.signUrls([path, missing], 3600)

    expect([...urls.keys()]).toEqual([path])
    const res = await fetch(urls.get(path) ?? "")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/jpeg")
    expect((await res.arrayBuffer()).byteLength).toBe(400)
  })

  test("listObjects walks the group folders: folders have a null id, files carry created_at", async () => {
    const path = newPath()
    await storage.upload(path, jpeg(100), "image/jpeg")
    const future = new Date(Date.now() + 60 * 1000)

    const all = await storage.listObjects(future, 10000)
    const none = await storage.listObjects(new Date(Date.now() - 60 * 60 * 1000), 10000)
    const one = await storage.listObjects(future, 1)

    expect(all.map((o) => o.path)).toContain(path)
    expect(none.map((o) => o.path)).not.toContain(path)
    expect(one).toHaveLength(1)
    const root = await admin.storage.from(PHOTO_BUCKET.name).list("", { limit: 100 })
    expect(root.data?.find((f) => f.name === group)?.id).toBeNull()
  })

  test("remove deletes the object and also succeeds for a path that is not there", async () => {
    const path = newPath()
    await storage.upload(path, jpeg(100), "image/jpeg")

    await storage.remove(path)
    await storage.remove(path)

    expect(await storage.stat(path)).toBeNull()
  })

  test("a refused request (wrong key) is a StorageFailure for remove, not a silent success", async () => {
    const wrong = createSupabasePhotoStorage(base, "not-a-key")

    await expect(wrong.remove(newPath())).rejects.toBeInstanceOf(StorageFailure)
  })

  test("upload of another content type or over 2 MiB is a failure, not 'exists'", async () => {
    const png = storage.upload(newPath(), jpeg(100), "image/png")
    const big = storage.upload(newPath(), jpeg(2 * 1024 * 1024 + 1), "image/jpeg")

    await expect(png).rejects.toBeInstanceOf(StorageFailure)
    await expect(big).rejects.toBeInstanceOf(StorageFailure)
  })

  const denial = anonKey ? test : test.skip
  denial("a publishable key can neither upload nor read an object", async () => {
    const path = newPath()
    await storage.upload(path, jpeg(100), "image/jpeg")
    const anon = createClient(base, anonKey ?? "unset", { auth: { persistSession: false } })

    const up = await anon.storage
      .from(PHOTO_BUCKET.name)
      .upload(newPath(), jpeg(100), { contentType: "image/jpeg" })
    const down = await anon.storage.from(PHOTO_BUCKET.name).download(path)
    const publicUrl = await fetch(`${base}/storage/v1/object/public/${PHOTO_BUCKET.name}/${path}`)
    const authed = await fetch(`${base}/storage/v1/object/${PHOTO_BUCKET.name}/${path}`)

    expect(up.error).not.toBeNull()
    expect(down.error).not.toBeNull()
    expect(publicUrl.status).not.toBe(200)
    expect(authed.status).not.toBe(200)
  })

  describe("through the API", () => {
    beforeAll(async () => {
      await ensureMigrated()
    })
    beforeEach(async () => {
      await truncateAll()
    })

    test("upload, list with a signed URL that serves the bytes, replay, and delete", async () => {
      const ctx = await setupPhotos()
      const app = createApp({ db: testDb, auth: e2eAuth, photoStorage: storage })
      const token = await bearer(ctx.ownerId)
      const call = (method: string, path: string, body?: FormData) =>
        Promise.resolve(
          app.request(path, {
            method,
            headers: { authorization: token },
            ...(body ? { body } : {}),
          }),
        )
      const photoId = crypto.randomUUID()
      const objectPath = photoPath(ctx.groupId, photoId)
      created.push(objectPath)

      const up = await call(
        "POST",
        `/v1/items/${ctx.itemId}/photos`,
        photoForm({ photoId, bytes: jpeg(1500) }),
      )
      const replay = await call(
        "POST",
        `/v1/items/${ctx.itemId}/photos`,
        photoForm({ photoId, bytes: jpeg(1500) }),
      )
      const list = (await (await call("GET", `/v1/items/${ctx.itemId}/photos`)).json()) as {
        photos: { id: string; url: string }[]
      }
      const bytes = await fetch(list.photos[0]?.url ?? "")
      const covers = (await (
        await call("GET", `/v1/items/photos?groupId=${ctx.groupId}`)
      ).json()) as {
        covers: { photoId: string }[]
      }
      const del = await call("DELETE", `/v1/items/${ctx.itemId}/photos/${photoId}`)

      expect(up.status).toBe(201)
      expect(replay.status).toBe(200)
      expect(list.photos.map((p) => p.id)).toEqual([photoId])
      expect((await bytes.arrayBuffer()).byteLength).toBe(1500)
      expect(covers.covers.map((c) => c.photoId)).toEqual([photoId])
      expect(del.status).toBe(204)
      expect(await storage.stat(objectPath)).toBeNull()
    })
  })
})
