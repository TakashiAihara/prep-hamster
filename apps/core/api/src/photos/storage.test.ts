import { afterAll, expect, test } from "bun:test"
import {
  createPhotoStorageFromEnv,
  createSignedUrlRewriter,
  createSupabasePhotoStorage,
  normalizedUrl,
  StorageFailure,
  toPublicUrl,
} from "./storage"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 応答しない Storage。要求が届いたこと (即時の失敗と区別する) と、上限時間で client が諦めて接続を切ったことを見る
let reached = 0
let aborted = Promise.withResolvers<void>()
const stalled = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (req) => {
    reached++
    req.signal.addEventListener("abort", () => aborted.resolve())
    return new Promise<Response>(() => {})
  },
})

// 署名の応答だけを返す Storage
const signing = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () =>
    Response.json([
      { path: "a.jpg", signedURL: "/object/sign/item-photos/a.jpg?token=t", error: null },
    ]),
})

afterAll(() => {
  void stalled.stop(true)
  void signing.stop(true)
})

test("a Storage call that never answers is aborted by the timeout instead of waiting forever", async () => {
  reached = 0
  aborted = Promise.withResolvers<void>()
  const storage = createSupabasePhotoStorage(`http://127.0.0.1:${stalled.port}`, "k", 200)
  const started = Date.now()

  await expect(storage.remove(["g/p.jpg"])).rejects.toBeInstanceOf(StorageFailure)
  const elapsed = Date.now() - started
  const connection = await Promise.race([
    aborted.promise.then(() => "closed" as const),
    sleep(2000).then(() => "still open" as const),
  ])

  expect(reached).toBe(1)
  expect(elapsed).toBeGreaterThanOrEqual(150)
  expect(elapsed).toBeLessThan(3000)
  expect(connection).toBe("closed")
})

test("signed URLs keep the origin the client connected to unless a public URL is given", async () => {
  const base = `http://127.0.0.1:${signing.port}`

  const plain = await createSupabasePhotoStorage(base, "k").signUrls(["a.jpg"], 60)
  const publicly = await createSupabasePhotoStorage(
    base,
    "k",
    1000,
    "https://photos.example",
  ).signUrls(["a.jpg"], 60)

  expect(plain.get("a.jpg")).toBe(`${base}/storage/v1/object/sign/item-photos/a.jpg?token=t`)
  expect(publicly.get("a.jpg")).toBe(
    "https://photos.example/storage/v1/object/sign/item-photos/a.jpg?token=t",
  )
})

test("createPhotoStorageFromEnv is null without a URL or a key, and reads SUPABASE_PUBLIC_URL for signed URLs", async () => {
  expect(createPhotoStorageFromEnv({})).toBeNull()
  expect(createPhotoStorageFromEnv({ SUPABASE_URL: "https://p.supabase.co" })).toBeNull()
  expect(createPhotoStorageFromEnv({ SUPABASE_SECRET_KEY: "k" })).toBeNull()
  const base = `http://127.0.0.1:${signing.port}`

  const storage = createPhotoStorageFromEnv({
    SUPABASE_URL: `${base}/`,
    SUPABASE_SECRET_KEY: " k ",
    SUPABASE_PUBLIC_URL: "https://photos.example/",
  })

  expect((await storage?.signUrls(["a.jpg"], 60))?.get("a.jpg")).toBe(
    "https://photos.example/storage/v1/object/sign/item-photos/a.jpg?token=t",
  )
})

const make = (url: string) =>
  createPhotoStorageFromEnv({ SUPABASE_URL: url, SUPABASE_SECRET_KEY: "k" })

test("createPhotoStorageFromEnv refuses to send the secret key over plain http, except to a local Supabase", () => {
  expect(() => make("http://project.supabase.co")).toThrow("SUPABASE_URL must be https")
  expect(() => make("http://10.0.0.5:54321")).toThrow("SUPABASE_URL must be https")
  for (const ok of [
    "https://project.supabase.co",
    "http://localhost:54321",
    "http://127.0.0.1:54321",
    "http://[::1]:54321",
    "http://host.docker.internal:54321",
  ]) {
    expect(make(ok)).not.toBeNull()
  }
})

test("createPhotoStorageFromEnv names the variable whose value is not a URL", () => {
  expect(() =>
    createPhotoStorageFromEnv({ SUPABASE_URL: "not a url", SUPABASE_SECRET_KEY: "k" }),
  ).toThrow("SUPABASE_URL is not a valid URL")
  expect(() =>
    createPhotoStorageFromEnv({
      SUPABASE_URL: "https://p.supabase.co",
      SUPABASE_SECRET_KEY: "k",
      SUPABASE_PUBLIC_URL: "nope",
    }),
  ).toThrow("SUPABASE_PUBLIC_URL is not a valid URL")
})

const withPublic = (publicUrl: string) =>
  createPhotoStorageFromEnv({
    SUPABASE_URL: "https://p.supabase.co",
    SUPABASE_SECRET_KEY: "k",
    SUPABASE_PUBLIC_URL: publicUrl,
  })

test("SUPABASE_URL is trimmed like the other variables, and SUPABASE_PUBLIC_URL must be http or https", async () => {
  expect(make(" https://p.supabase.co \n")).not.toBeNull()
  const base = `http://127.0.0.1:${signing.port}`
  const padded = createPhotoStorageFromEnv({
    SUPABASE_URL: ` ${base}/ \n`,
    SUPABASE_SECRET_KEY: "k",
    SUPABASE_PUBLIC_URL: "https://photos.example",
  })
  // the rewrite compares against the connection URL, so an untrimmed one would leave the origin as it was
  expect((await padded?.signUrls(["a.jpg"], 60))?.get("a.jpg")).toBe(
    "https://photos.example/storage/v1/object/sign/item-photos/a.jpg?token=t",
  )
  expect(() => make(" http://project.supabase.co ")).toThrow("SUPABASE_URL must be https")
  expect(() => withPublic("ftp://photos.example")).toThrow(
    "SUPABASE_PUBLIC_URL must be http or https",
  )
  expect(() => withPublic("javascript:alert(1)")).toThrow(
    "SUPABASE_PUBLIC_URL must be http or https",
  )
  expect(withPublic("http://192.168.0.5:54321")).not.toBeNull()
})

test("only the origin of a signed URL is replaced: scheme, host and port change, path and query stay", () => {
  const signed = "http://127.0.0.1:54321/storage/v1/object/sign/item-photos/a%20b.jpg?token=abc.def"

  expect(toPublicUrl(signed, "http://127.0.0.1:54321", "https://photos.example")).toBe(
    "https://photos.example/storage/v1/object/sign/item-photos/a%20b.jpg?token=abc.def",
  )
  expect(toPublicUrl(signed, "http://127.0.0.1:54321", "http://192.168.0.5:8000")).toBe(
    "http://192.168.0.5:8000/storage/v1/object/sign/item-photos/a%20b.jpg?token=abc.def",
  )
  // a connection URL with a path still has the same origin
  expect(toPublicUrl(signed, "http://127.0.0.1:54321/x", "https://photos.example")).toBe(
    "https://photos.example/storage/v1/object/sign/item-photos/a%20b.jpg?token=abc.def",
  )
})

test("a signed URL from another origin, or one that is not a URL, is not rewritten", () => {
  expect(
    toPublicUrl(
      "https://other.example/storage/v1/x?token=t",
      "http://127.0.0.1:54321",
      "https://p.example",
    ),
  ).toBeNull()
  expect(toPublicUrl("not a url", "http://127.0.0.1:54321", "https://p.example")).toBeNull()
})

test("the rewriter returns an unrewritable URL unchanged and warns once", () => {
  const warnings: unknown[][] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => void warnings.push(args)
  try {
    const rewrite = createSignedUrlRewriter("http://127.0.0.1:54321", "https://photos.example")

    const first = rewrite("https://other.example/storage/v1/x?token=t")
    const second = rewrite("https://other.example/storage/v1/y?token=t")
    const fine = rewrite("http://127.0.0.1:54321/storage/v1/z?token=t")

    expect(first).toBe("https://other.example/storage/v1/x?token=t")
    expect(second).toBe("https://other.example/storage/v1/y?token=t")
    expect(fine).toBe("https://photos.example/storage/v1/z?token=t")
    expect(warnings).toHaveLength(1)
    expect(String(warnings[0]?.[0])).toContain("SUPABASE_PUBLIC_URL was not applied")
    expect(createSignedUrlRewriter("http://127.0.0.1:54321")("anything")).toBe("anything")
    expect(warnings).toHaveLength(1)
  } finally {
    console.warn = original
  }
})

test("a local host is accepted only over http or https, and a public URL must be an origin", () => {
  expect(() => make("ftp://localhost:54321")).toThrow("SUPABASE_URL must be https")
  expect(() => make("ws://127.0.0.1:54321")).toThrow("SUPABASE_URL must be https")
  expect(() => withPublic("https://photos.example/storage")).toThrow(
    "SUPABASE_PUBLIC_URL must be an origin without a path",
  )
  expect(() => withPublic("https://photos.example?x=1")).toThrow(
    "SUPABASE_PUBLIC_URL must be an origin without a path",
  )
  expect(withPublic("https://photos.example:8443")).not.toBeNull()
})

test("normalizedUrl strips surrounding whitespace and any run of trailing slashes and spaces", () => {
  expect(normalizedUrl(" https://p.supabase.co/ / \n")).toBe("https://p.supabase.co")
  expect(normalizedUrl("https://p.supabase.co/ /")).toBe("https://p.supabase.co")
  expect(normalizedUrl("https://p.supabase.co//")).toBe("https://p.supabase.co")
  expect(normalizedUrl("https://p.supabase.co/path/")).toBe("https://p.supabase.co/path")
  expect(normalizedUrl(undefined)).toBeUndefined()
})

test("trailing slashes and whitespace are stripped in any order from both URLs", async () => {
  const base = `http://127.0.0.1:${signing.port}`

  const storage = createPhotoStorageFromEnv({
    SUPABASE_URL: ` ${base}/ / \n`,
    SUPABASE_SECRET_KEY: "k",
    SUPABASE_PUBLIC_URL: " https://photos.example / \n",
  })

  expect((await storage?.signUrls(["a.jpg"], 60))?.get("a.jpg")).toBe(
    "https://photos.example/storage/v1/object/sign/item-photos/a.jpg?token=t",
  )
})
