import { createApp } from "../src/app"
import { bearer, e2eAuth } from "./auth-helper"
import { createFakePhotoStorage } from "./fake-photo-storage"
import { seedGroupWithMembership, seedItem, seedMembership, seedUser } from "./seed"
import { testDb } from "./setup"
import type { Db } from "@prep-hamster/db"

// 先頭が JPEG の署名で、fill で中身を区別できる偽の JPEG
export const jpeg = (size = 1000, fill = 1): Uint8Array => {
  const b = new Uint8Array(size).fill(fill)
  b.set([0xff, 0xd8, 0xff])
  return b
}

export type Form = {
  bytes?: Uint8Array
  type?: string
  photoId?: string | null
  width?: string
  height?: string
  omitFile?: boolean
}

export const photoForm = (f: Form = {}): FormData => {
  const form = new FormData()
  if (!f.omitFile) {
    // Bun は multipart を読むとき file の type を拡張子から決めるので、拡張子も type に合わせる
    const type = f.type ?? "image/jpeg"
    form.set("file", new File([f.bytes ?? jpeg()], `p.${type.split("/")[1]}`, { type }))
  }
  if (f.photoId !== null) form.set("photoId", f.photoId ?? crypto.randomUUID())
  if (f.width !== undefined) form.set("width", f.width)
  if (f.height !== undefined) form.set("height", f.height)
  return form
}

export async function setupPhotos(opts: { db?: Db; now?: () => number } = {}) {
  const fake = createFakePhotoStorage()
  if (opts.now) fake.control.now = opts.now
  const ownerId = await seedUser()
  const groupId = await seedGroupWithMembership(ownerId, "Home")
  const itemId = await seedItem(groupId, "Tomato")
  const app = createApp({
    db: opts.db ?? testDb,
    auth: e2eAuth,
    photoStorage: fake.storage,
    ...(opts.now ? { photoClock: opts.now } : {}),
  })
  const as = async (userId: string) => {
    const authorization = await bearer(userId)
    return {
      req: (method: string, path: string, body?: FormData) =>
        app.request(path, { method, headers: { authorization }, ...(body ? { body } : {}) }),
    }
  }
  const owner = await as(ownerId)
  const upload = (itemIdArg: string, f: Form = {}) =>
    owner.req("POST", `/v1/items/${itemIdArg}/photos`, photoForm(f))
  return { fake, ownerId, groupId, itemId, app, as, owner, upload, seedMembership }
}
