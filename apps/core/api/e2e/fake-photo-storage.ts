import type { PhotoStorage } from "../src/photos/storage"

export type StorageCall =
  | { op: "upload"; path: string; contentType: string; size: number }
  | { op: "remove"; path: string }
  | { op: "sign"; paths: string[]; expiresIn: number }
  | { op: "createdAt"; path: string }
  | { op: "list" }

// Storage の偽物。受け取った呼び出しを records に残し、テストは応答だけでなく
// 「どの bucket 内の path に何を置いて何を消したか」も確かめる。
export function createFakePhotoStorage() {
  const objects = new Map<string, { size: number; contentType: string; createdAt: Date }>()
  const calls: StorageCall[] = []
  const control = {
    failUpload: false,
    failRemove: false,
    failSign: false,
    failInfo: false,
    // upload が object を置かずに "exists" と答える (置いたはずの object が見えない競合)
    uploadAlwaysExists: false,
    // 立てている間、upload は gate が開くまで object を置かずに待つ (Storage が遅い状況)
    uploadGate: null as Promise<void> | null,
    // upload が呼ばれるたびに呼ぶ通知 (gate で待たせる側が「着いた」を知る / 他の要求を割り込ませる)
    onUploadReached: null as (() => void | Promise<void>) | null,
    // 次の createdAt の応答の前に走らせる処理 (object が消える瞬間などを作る)
    beforeCreatedAt: null as (() => Promise<void>) | null,
    now: () => Date.now(),
  }

  const storage: PhotoStorage = {
    async upload(path, bytes, contentType) {
      calls.push({ op: "upload", path, contentType, size: bytes.length })
      await control.onUploadReached?.()
      if (control.uploadGate) await control.uploadGate
      if (control.failUpload) throw new Error("storage down")
      if (control.uploadAlwaysExists || objects.has(path)) return "exists"
      objects.set(path, { size: bytes.length, contentType, createdAt: new Date(control.now()) })
      return "ok"
    },
    async remove(path) {
      calls.push({ op: "remove", path })
      if (control.failRemove) throw new Error("storage down")
      objects.delete(path)
    },
    async signUrls(paths, expiresIn) {
      calls.push({ op: "sign", paths, expiresIn })
      if (control.failSign) throw new Error("storage down")
      const urls = new Map<string, string>()
      for (const p of paths)
        if (objects.has(p)) urls.set(p, `https://storage.test/sign/${p}?t=${crypto.randomUUID()}`)
      return urls
    },
    async createdAt(path) {
      calls.push({ op: "createdAt", path })
      if (control.beforeCreatedAt) {
        const f = control.beforeCreatedAt
        control.beforeCreatedAt = null
        await f()
      }
      if (control.failInfo) throw new Error("storage down")
      return objects.get(path)?.createdAt ?? null
    },
    async listObjects() {
      calls.push({ op: "list" })
      return [...objects].map(([path, o]) => ({ path, createdAt: o.createdAt }))
    },
  }

  return {
    storage,
    objects,
    calls,
    control,
    callsOf: <T extends StorageCall["op"]>(op: T) =>
      calls.filter((c): c is Extract<StorageCall, { op: T }> => c.op === op),
    // object を過去に置いたことにする
    age: (path: string, ms: number) => {
      const o = objects.get(path)
      if (!o) throw new Error(`no object ${path}`)
      o.createdAt = new Date(control.now() - ms)
    },
    put: (path: string, ageMs = 0) => {
      objects.set(path, {
        size: 1,
        contentType: "image/jpeg",
        createdAt: new Date(control.now() - ageMs),
      })
    },
  }
}

export type FakePhotoStorage = ReturnType<typeof createFakePhotoStorage>
