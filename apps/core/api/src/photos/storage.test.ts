import { afterAll, expect, test } from "bun:test"
import { createSupabasePhotoStorage, StorageFailure } from "./storage"

// 応答しない Storage。upload が上限時間で諦めること (接続と lock を握ったまま待たないこと) を見る
const stalled = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Promise<Response>(() => {}),
})

afterAll(() => {
  void stalled.stop(true)
})

test("a Storage call that never answers fails after the timeout instead of waiting forever", async () => {
  const storage = createSupabasePhotoStorage(`http://127.0.0.1:${stalled.port}`, "k", 200)
  const started = Date.now()

  await expect(storage.remove(["g/p.jpg"])).rejects.toBeInstanceOf(StorageFailure)

  expect(Date.now() - started).toBeLessThan(3000)
})
