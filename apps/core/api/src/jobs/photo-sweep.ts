import { createDb } from "@prep-hamster/db"
import { createPhotoStorageFromEnv } from "../photos/storage"
import { sweepPhotos, type SweepResult } from "../photos/service"

export const exitCodeFor = (r: SweepResult): 0 | 1 => (r.failed > 0 ? 1 : 0)

// 止まった pending の行と、削除待ちの写真の object を片付ける (定期実行。冪等)。
if (import.meta.main) {
  const databaseUrl = process.env["DATABASE_URL"]
  if (!databaseUrl) {
    console.error("[photo-sweep] DATABASE_URL is required")
    process.exit(1)
  }
  const storage = createPhotoStorageFromEnv()
  if (!storage) {
    console.error("[photo-sweep] SUPABASE_URL and SUPABASE_SECRET_KEY are required")
    process.exit(1)
  }
  try {
    const r = await sweepPhotos(createDb(databaseUrl), storage)
    console.log(
      `[photo-sweep] stale pending claimed ${r.staleClaimed}, objects removed ${r.removed}, failed ${r.failed}`,
    )
    process.exit(exitCodeFor(r))
  } catch (err) {
    console.error("[photo-sweep] failed:", err)
    process.exit(1)
  }
}
