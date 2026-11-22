import { and, asc, count, eq, isNull, lt, sql } from "drizzle-orm"
import { itemPhotos, items, type Db } from "@prep-hamster/db"
import { PHOTOS_PER_ITEM_MAX } from "@prep-hamster/schema"
import {
  ADOPT_MAX_AGE_MS,
  REGISTER_DEADLINE_MS,
  REMOVAL_RETRY_AFTER_MS,
  SIGN_CHUNK,
  SIGNED_URL_TTL_SECONDS,
  SWEEP_BATCH,
  SWEEP_MIN_AGE_MS,
} from "./config"
import type { PhotoStorage } from "./storage"

export type PhotoRow = typeof itemPhotos.$inferSelect
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
type Reader = Pick<Db, "select" | "selectDistinctOn">

export type Clock = () => number

// 同じ photoId の判定は 1 か所に寄せる。none = 行が無い / match = 同じ item・group・大きさの active な行 /
// reused = 行はあるが別物 (別 item・別 group・別の大きさ・削除済み)。別 group の行も reused に倒すので、
// 他 group の photoId の有無は応答から分からない。
export type Probe = { kind: "none" } | { kind: "match"; row: PhotoRow } | { kind: "reused" }

export type Expect = { groupId: string; itemId: string; byteSize: number }

export async function probePhoto(db: Reader, photoId: string, expect: Expect): Promise<Probe> {
  const [row] = await db.select().from(itemPhotos).where(eq(itemPhotos.id, photoId)).limit(1)
  if (!row) return { kind: "none" }
  const same =
    row.groupId === expect.groupId &&
    row.itemId === expect.itemId &&
    row.byteSize === expect.byteSize &&
    row.deletedAt === null
  return same ? { kind: "match", row } : { kind: "reused" }
}

// 登録 (行の insert) と object の削除を photoId ごとに直列にする lock。
// 取るのはこの lock だけで item の行は押さえないので、待たされるのは同じ photoId の操作だけ。
// item 行 lock を取る側 (登録) は item → この lock の順。sweep と補償の削除はこの lock だけを取る。
const lockPhoto = (tx: Tx, photoId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${photoId}::text, 0))`)

async function underPhotoLock<T>(
  db: Db,
  photoId: string,
  fn: (tx: Tx) => Promise<T>,
  lockTimeout = "5s",
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local lock_timeout = '${lockTimeout}'`))
    await lockPhoto(tx, photoId)
    return fn(tx)
  })
}

export type CapCheck =
  | { kind: "ok" }
  | { kind: "replay"; row: PhotoRow }
  | { kind: "reused" }
  | { kind: "limit" }

const countActive = async (db: Reader, itemId: string): Promise<number> => {
  const [r] = await db
    .select({ n: count() })
    .from(itemPhotos)
    .where(and(eq(itemPhotos.itemId, itemId), isNull(itemPhotos.deletedAt)))
  return r?.n ?? 0
}

// upload の前の速い失敗 (ロックなし)。上限なら、数えている間に元の upload の行が commit したかを
// もう一度見る。見つかった行が別物なら IDEMPOTENCY_KEY_REUSED で、上限超過とは答えない。
export async function checkCapEarly(
  db: Db,
  photoId: string,
  expect: Expect,
  max = PHOTOS_PER_ITEM_MAX,
): Promise<CapCheck> {
  if ((await countActive(db, expect.itemId)) < max) return { kind: "ok" }
  const again = await probePhoto(db, photoId, expect)
  if (again.kind === "match") return { kind: "replay", row: again.row }
  if (again.kind === "reused") return { kind: "reused" }
  return { kind: "limit" }
}

export type RegisterInput = Expect & {
  photoId: string
  userId: string
  storagePath: string
  width: number | null
  height: number | null
  uploadStartedAt: number
}

export type RegisterResult =
  | { kind: "created"; row: PhotoRow }
  | { kind: "replay"; row: PhotoRow }
  | { kind: "reused" }
  | { kind: "gone" }
  | { kind: "limit" }
  | { kind: "too_late" }

// 行の登録。item 行を FOR NO KEY UPDATE で押さえ (上限と item の削除・merge と直列)、そのうえで photoId の lock を取る。
// どの結果も transaction は終わっている (戻り値で返し、途中で throw しない) ので、呼び出し側は
// 「行が無いと確かめた」状態から object を片付けられる。
export async function registerPhoto(
  db: Db,
  input: RegisterInput,
  now: Clock,
  max = PHOTOS_PER_ITEM_MAX,
): Promise<RegisterResult> {
  return db.transaction(async (tx): Promise<RegisterResult> => {
    const [item] = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, input.itemId), isNull(items.deletedAt)))
      .for("no key update")
    if (!item) return { kind: "gone" }

    await lockPhoto(tx, input.photoId)

    const probe = await probePhoto(tx, input.photoId, input)
    if (probe.kind === "match") return { kind: "replay", row: probe.row }
    if (probe.kind === "reused") return { kind: "reused" }

    // sweep が object を消せる歳になる前に登録を断る。sweep は同じ lock の下で行を確かめてから消すので、
    // ここを通れた登録は消されない (lock を取れた時点で sweep は待つ)。取る前に止まっていた登録はここで断られる
    if (now() - input.uploadStartedAt > REGISTER_DEADLINE_MS) return { kind: "too_late" }

    if ((await countActive(tx, input.itemId)) >= max) return { kind: "limit" }

    const [row] = await tx
      .insert(itemPhotos)
      .values({
        id: input.photoId,
        groupId: input.groupId,
        itemId: input.itemId,
        storagePath: input.storagePath,
        contentType: "image/jpeg",
        byteSize: input.byteSize,
        width: input.width,
        height: input.height,
        createdBy: input.userId,
      })
      .returning()
    if (!row) throw new Error("item_photos insert returned no row")
    return { kind: "created", row }
  })
}

export type Settled = { kind: "none" } | { kind: "match"; row: PhotoRow } | { kind: "reused" }

// 結果が分からなかった (commit の失敗など) あとの確定。photoId の lock を取れた時点で、元の登録 transaction は
// commit か abort で終わっている (lock を持ったまま止まることはない) ので、この時点の probe は確定した答え。
// 行が無ければ、自分が upload した object をこの lock の下で消す (行の確認と削除の間に登録は入れない)。
export async function settlePhoto(
  db: Db,
  storage: PhotoStorage,
  p: Expect & { photoId: string; storagePath: string; removeIfAbsent: boolean },
): Promise<Settled> {
  return underPhotoLock(db, p.photoId, async (tx) => {
    const probe = await probePhoto(tx, p.photoId, p)
    if (probe.kind !== "none") return probe
    if (p.removeIfAbsent) await storage.remove(p.storagePath)
    return { kind: "none" }
  })
}

// 既存の object (同じ path の upload が "exists") を扱う。
//   young = 他の要求が upload したばかりで、その登録が来る (または登録済み)。上書きも削除もせず、自分も登録する
//     (行が既にあるかどうかは登録の transaction が見る)
//   stale = 行の無い古い object。sweep に消されるので、行が無いと確かめて消し、upload し直す
//   replay / reused = 古い object の行が、確かめる間に現れた
export type ExistingObject =
  | { kind: "young" }
  | { kind: "stale-removed" }
  | { kind: "replay"; row: PhotoRow }
  | { kind: "reused" }

export async function inspectExisting(
  db: Db,
  storage: PhotoStorage,
  p: Expect & { photoId: string; storagePath: string },
  now: Clock,
): Promise<ExistingObject> {
  const created = await storage.createdAt(p.storagePath)
  // 見つからないのは、確認の間に誰かが消した (sweep など)。もう一度 upload する
  if (created === null) return { kind: "stale-removed" }
  if (now() - created.getTime() <= ADOPT_MAX_AGE_MS) return { kind: "young" }
  const settled = await settlePhoto(db, storage, { ...p, removeIfAbsent: true })
  if (settled.kind === "match") return { kind: "replay", row: settled.row }
  if (settled.kind === "reused") return { kind: "reused" }
  return { kind: "stale-removed" }
}

// photo の soft delete。1 文の UPDATE が photo の行を押さえるので、同じ写真への並行する削除は片方だけが行を得る。
// 別 item の photo と削除済みの photo は null (404)。
export async function softDeletePhoto(
  db: Db,
  itemId: string,
  photoId: string,
  now: Clock,
): Promise<PhotoRow | null> {
  const at = new Date(now())
  const [row] = await db
    .update(itemPhotos)
    .set({ deletedAt: at, updatedAt: at })
    .where(
      and(eq(itemPhotos.id, photoId), eq(itemPhotos.itemId, itemId), isNull(itemPhotos.deletedAt)),
    )
    .returning()
  return row ?? null
}

// item の削除と同じ transaction で呼ぶ。object の削除は commit の後 (removeObjectsOf)。
export async function softDeletePhotosOfItem(
  tx: Tx,
  itemId: string,
  at: Date,
): Promise<PhotoRow[]> {
  return tx
    .update(itemPhotos)
    .set({ deletedAt: at, updatedAt: at })
    .where(and(eq(itemPhotos.itemId, itemId), isNull(itemPhotos.deletedAt)))
    .returning()
}

// soft delete 済みの行の object を消し、済んだら storage_deleted_at を立てる。失敗は握らず "failed" で返し、
// 行を削除待ちのまま残す (sweep が再試行する)。
export async function removeObjectOf(
  db: Db,
  storage: PhotoStorage,
  row: Pick<PhotoRow, "id" | "storagePath">,
  now: Clock,
): Promise<"removed" | "failed"> {
  try {
    await storage.remove(row.storagePath)
  } catch {
    return "failed"
  }
  await db
    .update(itemPhotos)
    .set({ storageDeletedAt: new Date(now()) })
    .where(eq(itemPhotos.id, row.id))
  return "removed"
}

export type SweepResult = {
  pendingRemoved: number
  pendingFailed: number
  orphansRemoved: number
  orphansKept: number
  orphansBusy: number
}

const PHOTO_OBJECT = /^[^/]+\/([0-9a-f-]{36})\.jpg$/

// 削除待ちの object を消し、行の無い古い object を消す。
// orphan は一覧の時点ではなく、photoId の lock の下で行を確かめ直してから消す
// (一覧と削除の間に登録が commit しても、登録済みの object は消えない)。
export async function sweepPhotos(
  db: Db,
  storage: PhotoStorage,
  now: Clock = Date.now,
): Promise<SweepResult> {
  const result: SweepResult = {
    pendingRemoved: 0,
    pendingFailed: 0,
    orphansRemoved: 0,
    orphansKept: 0,
    orphansBusy: 0,
  }

  const pending = await db
    .select()
    .from(itemPhotos)
    .where(
      and(
        isNull(itemPhotos.storageDeletedAt),
        lt(itemPhotos.deletedAt, new Date(now() - REMOVAL_RETRY_AFTER_MS)),
      ),
    )
    .orderBy(asc(itemPhotos.deletedAt))
    .limit(SWEEP_BATCH)
  for (const row of pending) {
    // oxlint-disable-next-line no-await-in-loop
    const r = await removeObjectOf(db, storage, row, now)
    if (r === "removed") result.pendingRemoved++
    else result.pendingFailed++
  }

  const cutoff = now() - SWEEP_MIN_AGE_MS
  const objects = (await storage.listObjects())
    .filter((o) => o.createdAt.getTime() < cutoff)
    .slice(0, SWEEP_BATCH)
  for (const object of objects) {
    const photoId = PHOTO_OBJECT.exec(object.path)?.[1]
    // 写真の名前ではない object は触らない
    if (!photoId) continue
    try {
      // oxlint-disable-next-line no-await-in-loop
      const removed = await underPhotoLock(
        db,
        photoId,
        async (tx) => {
          const [row] = await tx
            .select({ id: itemPhotos.id })
            .from(itemPhotos)
            .where(eq(itemPhotos.id, photoId))
            .limit(1)
          // 削除済みの行の object は上の削除待ちの処理が持つ
          if (row) return false
          await storage.remove(object.path)
          return true
        },
        "1s",
      )
      if (removed) result.orphansRemoved++
      else result.orphansKept++
    } catch {
      result.orphansBusy++
    }
  }
  return result
}

export type CoverRow = { itemId: string; photoId: string; path: string }

// item ごとの先頭 1 枚 (created_at、同時刻は id の小さい方)。item も photo も active なものだけ。
export async function listCovers(db: Reader, groupId: string): Promise<CoverRow[]> {
  return db
    .selectDistinctOn([itemPhotos.itemId], {
      itemId: itemPhotos.itemId,
      photoId: itemPhotos.id,
      path: itemPhotos.storagePath,
    })
    .from(itemPhotos)
    .innerJoin(items, and(eq(items.id, itemPhotos.itemId), isNull(items.deletedAt)))
    .where(and(eq(itemPhotos.groupId, groupId), isNull(itemPhotos.deletedAt)))
    .orderBy(itemPhotos.itemId, itemPhotos.createdAt, itemPhotos.id)
}

export async function listItemPhotos(db: Reader, itemId: string): Promise<PhotoRow[]> {
  return db
    .select()
    .from(itemPhotos)
    .where(and(eq(itemPhotos.itemId, itemId), isNull(itemPhotos.deletedAt)))
    .orderBy(asc(itemPhotos.createdAt), asc(itemPhotos.id))
}

export async function signPaths(
  storage: PhotoStorage,
  paths: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  for (let i = 0; i < paths.length; i += SIGN_CHUNK) {
    // oxlint-disable-next-line no-await-in-loop
    const part = await storage.signUrls(paths.slice(i, i + SIGN_CHUNK), SIGNED_URL_TTL_SECONDS)
    for (const [k, v] of part) urls.set(k, v)
  }
  return urls
}
