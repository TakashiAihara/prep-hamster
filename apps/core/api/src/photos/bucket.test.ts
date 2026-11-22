import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { provisionPhotoBucket } from "../../scripts/provision-photo-bucket"
import { PHOTOS_PER_ITEM_MAX } from "@prep-hamster/schema"
import { PHOTO_BUCKET } from "./config"

type Buckets = Record<
  string,
  { public?: boolean; file_size_limit?: string; allowed_mime_types?: string[] }
>

const configToml = fileURLToPath(new URL("../../../../../supabase/config.toml", import.meta.url))

test("supabase/config.toml defines the photo bucket as private, 2 MiB, image/jpeg only", () => {
  const parsed = Bun.TOML.parse(readFileSync(configToml, "utf8")) as {
    storage: { buckets?: Buckets }
  }
  const bucket = parsed.storage.buckets?.[PHOTO_BUCKET.name]

  expect(bucket).toBeDefined()
  expect(bucket?.public).toBe(false)
  expect(bucket?.file_size_limit).toBe("2MiB")
  expect(bucket?.allowed_mime_types).toEqual(["image/jpeg"])
})

test("the per-item photo limit is five", () => {
  expect(PHOTOS_PER_ITEM_MAX).toBe(5)
})

test("the shared bucket definition is private, 2 MiB, image/jpeg only", () => {
  expect(PHOTO_BUCKET).toEqual({
    name: "item-photos",
    public: false,
    fileSizeLimit: 2097152,
    allowedMimeTypes: ["image/jpeg"],
  })
})

const fakeAdmin = (existing: "missing" | "present" | "denied" | "empty") => {
  const calls: Array<{ op: string; name: string; options: unknown }> = []
  return {
    calls,
    admin: {
      getBucket: async () =>
        existing === "present"
          ? { data: { id: "x" }, error: null }
          : existing === "empty"
            ? { data: null, error: null }
            : {
                data: null,
                error: { message: existing === "denied" ? "forbidden" : "Bucket not found" },
              },
      createBucket: async (name: string, options: unknown) => {
        calls.push({ op: "create", name, options })
        return { error: null }
      },
      updateBucket: async (name: string, options: unknown) => {
        calls.push({ op: "update", name, options })
        return { error: null }
      },
    },
  }
}

const EXPECTED_OPTIONS = { public: false, fileSizeLimit: 2097152, allowedMimeTypes: ["image/jpeg"] }

test("provisioning creates a missing bucket from the shared definition", async () => {
  const { admin, calls } = fakeAdmin("missing")

  expect(await provisionPhotoBucket(admin)).toBe("created")
  expect(calls).toEqual([{ op: "create", name: "item-photos", options: EXPECTED_OPTIONS }])
})

test("provisioning creates the bucket when the lookup answers with no data and no error", async () => {
  const { admin, calls } = fakeAdmin("empty")

  expect(await provisionPhotoBucket(admin)).toBe("created")
  expect(calls.map((c) => c.op)).toEqual(["create"])
})

test("provisioning updates an existing bucket to the shared definition", async () => {
  const { admin, calls } = fakeAdmin("present")

  expect(await provisionPhotoBucket(admin)).toBe("updated")
  expect(calls).toEqual([{ op: "update", name: "item-photos", options: EXPECTED_OPTIONS }])
})

test("provisioning stops on a lookup failure that is not 'not found'", async () => {
  const { admin, calls } = fakeAdmin("denied")

  await expect(provisionPhotoBucket(admin)).rejects.toThrow("getBucket failed: forbidden")
  expect(calls).toEqual([])
})
