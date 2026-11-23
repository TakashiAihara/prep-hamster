import type { PhotoStorage } from "../src/photos/storage"

export type StorageCall =
  | { op: "upload"; path: string; contentType: string; size: number }
  | { op: "remove"; paths: string[] }
  | { op: "sign"; paths: string[]; expiresIn: number }

// Storage の偽物。受け取った呼び出しを records に残し、テストは応答だけでなく
// 「どの bucket 内の path に何を置いて何を消したか」も確かめる。
// 形は実 Storage に合わせてある (同じ path の upload は成功、無い path の remove は成功)。
// その形が本物と同じことは e2e/photo-storage-real.test.ts (opt-in) が確かめる。
export function createFakePhotoStorage() {
  const objects = new Map<string, { size: number; contentType: string }>()
  const calls: StorageCall[] = []
  const control = {
    failUpload: false,
    failRemove: false,
    failSign: false,
    // 立てている間、upload は gate が開くまで object を置かずに待つ (Storage が遅い状況)
    uploadGate: null as Promise<void> | null,
    // upload が呼ばれるたびに呼ぶ通知 (gate で待たせる側が「着いた」を知る / 他の要求を割り込ませる)
    onUploadReached: null as (() => void | Promise<void>) | null,
    // object を置いた直後に呼ぶ (置いた後・ready にする前の瞬間を作る)
    afterUploadStored: null as (() => void | Promise<void>) | null,
    // Storage の呼び出しごとに、中身を実行する前に呼ぶ (呼ばれた時点の DB の状態を見る)
    beforeCall: null as ((op: StorageCall["op"]) => void | Promise<void>) | null,
  }

  const storage: PhotoStorage = {
    async upload(path, bytes, contentType) {
      calls.push({ op: "upload", path, contentType, size: bytes.length })
      await control.beforeCall?.("upload")
      await control.onUploadReached?.()
      if (control.uploadGate) await control.uploadGate
      if (control.failUpload) throw new Error("storage down")
      if (!objects.has(path)) objects.set(path, { size: bytes.length, contentType })
      await control.afterUploadStored?.()
    },
    async remove(paths) {
      calls.push({ op: "remove", paths })
      await control.beforeCall?.("remove")
      if (control.failRemove) throw new Error("storage down")
      for (const p of paths) objects.delete(p)
    },
    async signUrls(paths, expiresIn) {
      calls.push({ op: "sign", paths, expiresIn })
      await control.beforeCall?.("sign")
      if (control.failSign) throw new Error("storage down")
      const urls = new Map<string, string>()
      for (const p of paths) {
        if (objects.has(p)) urls.set(p, `https://storage.test/sign/${p}?t=${crypto.randomUUID()}`)
      }
      return urls
    },
  }

  return {
    storage,
    objects,
    calls,
    control,
    callsOf: <T extends StorageCall["op"]>(op: T) =>
      calls.filter((c): c is Extract<StorageCall, { op: T }> => c.op === op),
    put: (path: string, size = 1) => {
      objects.set(path, { size, contentType: "image/jpeg" })
    },
  }
}

export type FakePhotoStorage = ReturnType<typeof createFakePhotoStorage>
