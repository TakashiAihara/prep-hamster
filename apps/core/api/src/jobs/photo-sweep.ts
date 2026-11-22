import { createDb } from "@prep-hamster/db"
import { createPhotoStorageFromEnv } from "../photos/storage"
import { sweepPhotos, type SweepResult } from "../photos/service"

export const exitCodeFor = (r: SweepResult): 0 | 1 =>
  r.pendingFailed + r.orphansFailed > 0 ? 1 : 0

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
      `[photo-sweep] pending removed ${r.pendingRemoved} (failed ${r.pendingFailed}), orphans removed ${r.orphansRemoved} (kept ${r.orphansKept}, busy ${r.orphansBusy}, failed ${r.orphansFailed})`,
    )
    // lock を待ちきれなかった object (busy) は次の回に回すだけで失敗ではない。それ以外の失敗は非 0
    process.exit(exitCodeFor(r))
  } catch (err) {
    console.error("[photo-sweep] failed:", err)
    process.exit(1)
  }
}
