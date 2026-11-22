import { createDb } from "@prep-hamster/db"
import { createPhotoStorageFromEnv } from "../photos/storage"
import { sweepPhotos } from "../photos/service"

// 削除待ちの写真の object と、行の無い古い object を片付ける (定期実行。冪等)。
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
      `[photo-sweep] pending removed ${r.pendingRemoved} (failed ${r.pendingFailed}), orphans removed ${r.orphansRemoved} (kept ${r.orphansKept}, busy ${r.orphansBusy})`,
    )
    process.exit(r.pendingFailed > 0 ? 1 : 0)
  } catch (err) {
    console.error("[photo-sweep] failed:", err)
    process.exit(1)
  }
}
