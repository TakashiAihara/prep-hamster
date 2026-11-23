import { and, asc, count, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { itemPhotos, items, type Db } from "@prep-hamster/db"
import { PHOTO_CONTENT_TYPE, PHOTOS_PER_ITEM_MAX } from "@prep-hamster/schema"
import {
  PENDING_STALE_AFTER_MS,
  REMOVAL_RETRY_AFTER_MS,
  LATE_UPLOAD_WINDOW_MS,
  SIGN_CHUNK,
  SIGNED_URL_TTL_SECONDS,
  SWEEP_BATCH,
} from "./config"
import type { PhotoStorage } from "./storage"

// 行を先に作り (pending)、object を置き、行を ready にする。見えるのは ready の行だけ。
// DB の transaction の中では Storage を呼ばない。

export type PhotoRow = typeof itemPhotos.$inferSelect
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
type Reader = Pick<Db, "select" | "selectDistinctOn">

export type Clock = () => number

export type Expect = { groupId: string; itemId: string; byteSize: number }

export type ClaimInput = Expect & {
  photoId: string
  userId: string
  storagePath: string
  width: number | null
  height: number | null
}

export type ClaimResult =
  // 新しい pending の行を作った
  | { kind: "created"; row: PhotoRow }
  // 同じ photoId・group・item・大きさの行が既にある (pending なら upload を続け、ready なら 200 で返す)
  | { kind: "existing"; row: PhotoRow }
  // photoId は別の group・item・大きさ、または削除済みの行で使われている
  | { kind: "reused" }
  | { kind: "gone" }
  | { kind: "limit" }

const countActive = async (db: Reader, itemId: string): Promise<number> => {
  const [r] = await db
    .select({ n: count() })
    .from(itemPhotos)
    .where(and(eq(itemPhotos.itemId, itemId), isNull(itemPhotos.deletedAt)))
  return r?.n ?? 0
}

// 検査 (item が active / photoId の冪等 / 枚数の上限) と pending の行の insert を 1 つの短い transaction で行う。
// item の行を押さえるので、同じ item の upload・削除・merge と、枚数の判定が直列になる。
// 枚数は pending も数える (upload 中の写真も 1 枚)。
export async function claimPhoto(
  db: Db,
  input: ClaimInput,
  now: Clock,
  max = PHOTOS_PER_ITEM_MAX,
): Promise<ClaimResult> {
  return db.transaction(async (tx): Promise<ClaimResult> => {
    const [item] = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, input.itemId), isNull(items.deletedAt)))
      .for("no key update")
    if (!item) return { kind: "gone" }

    const [row] = await tx
      .select()
      .from(itemPhotos)
      .where(eq(itemPhotos.id, input.photoId))
      .limit(1)
    if (row) {
      const same =
        row.groupId === input.groupId &&
        row.itemId === input.itemId &&
        row.byteSize === input.byteSize &&
        row.width === input.width &&
        row.height === input.height &&
        row.deletedAt === null
      if (!same) return { kind: "reused" }
      if (row.status === "ready") return { kind: "existing", row }
      // 送り直しは pending の行の最後の動きとして数える (sweep が、いま続けている upload の行を止まった行と取り違えない)。
      // 読んでからこの UPDATE までの間に行が削除された (sweep・item の削除) なら、1 行も更新されず、削除済みの photoId として扱う
      const [touched] = await tx
        .update(itemPhotos)
        .set({ updatedAt: new Date(now()) })
        .where(
          and(
            eq(itemPhotos.id, row.id),
            eq(itemPhotos.status, "pending"),
            isNull(itemPhotos.deletedAt),
          ),
        )
        .returning()
      if (touched) return { kind: "existing", row: touched }
      // 更新できなかった: 読んだ後に ready になった (同じ photoId の別の要求が終えた) ならその行で続け、削除されたなら別物
      const [fresh] = await tx.select().from(itemPhotos).where(eq(itemPhotos.id, row.id)).limit(1)
      return fresh && !fresh.deletedAt && fresh.status === "ready"
        ? { kind: "existing", row: fresh }
        : { kind: "reused" }
    }

    if ((await countActive(tx, input.itemId)) >= max) return { kind: "limit" }

    // 時刻は sweep が読む時計 (now) で入れる。DB の既定の now() と混ぜると、止まった行の判定が 2 つの時計に分かれる
    const at = new Date(now())
    const [created] = await tx
      .insert(itemPhotos)
      .values({
        createdAt: at,
        updatedAt: at,
        id: input.photoId,
        groupId: input.groupId,
        itemId: input.itemId,
        storagePath: input.storagePath,
        contentType: PHOTO_CONTENT_TYPE,
        byteSize: input.byteSize,
        status: "pending",
        width: input.width,
        height: input.height,
        createdBy: input.userId,
      })
      .returning()
    if (!created) throw new Error("item_photos insert returned no row")
    return { kind: "created", row: created }
  })
}

// object を置いた後に行を ready にする。pending で削除されていないときだけ動く 1 文の UPDATE なので、
// 同じ写真への送り直しと、sweep・削除との競合は、どちらかが先に行を取る。
// 取れなかったときは、同じ写真の別の要求が先に ready にしたなら "ready"、削除されたなら "gone"
export async function markReady(
  db: Db,
  photoId: string,
  now: Clock,
): Promise<{ kind: "ready"; row: PhotoRow } | { kind: "gone" }> {
  const [row] = await db
    .update(itemPhotos)
    .set({ status: "ready", updatedAt: new Date(now()) })
    .where(
      and(
        eq(itemPhotos.id, photoId),
        eq(itemPhotos.status, "pending"),
        isNull(itemPhotos.deletedAt),
      ),
    )
    .returning()
  if (row) return { kind: "ready", row }
  const [current] = await db.select().from(itemPhotos).where(eq(itemPhotos.id, photoId)).limit(1)
  if (current && current.status === "ready" && current.deletedAt === null) {
    return { kind: "ready", row: current }
  }
  return { kind: "gone" }
}

// 自分が置いた object の行が、upload の間に削除されていた (item・写真の削除 / sweep)。object を消す。
// 消せなければ、行を削除待ちに戻して sweep に任せる (行の側の削除が先に済んで storage_deleted_at が立っていても、
// その後に置いた object は残っている)。戻すときは updated_at を進める: 先に始まっていた removeObjectOf の完了の記録は
// 始めたときの updated_at が条件なので、この戻しを後から上書きできない
export async function discardUploaded(
  db: Db,
  storage: PhotoStorage,
  row: Pick<PhotoRow, "id" | "storagePath">,
  now: Clock,
): Promise<void> {
  try {
    await storage.remove([row.storagePath])
  } catch {
    try {
      await db
        .update(itemPhotos)
        .set({
          storageDeletedAt: null,
          updatedAt: sql`greatest(${new Date(now()).toISOString()}::timestamptz, ${itemPhotos.updatedAt} + interval '1 millisecond')`,
        })
        .where(eq(itemPhotos.id, row.id))
    } catch {
      // sweep が拾えない場合は、object が残る
    }
  }
}

// upload が例外で終わった後の確認。Storage は object を置いてから失敗を返すことがある (timeout など) ので、
// その間に行が削除されていたら、その行の object を片付ける (行が生きていれば、同じ photoId の送り直しが続けるので触らない)。
// 削除済みの行の path にある object は、同じ photoId の別の要求のものでも持ち主が無い
export async function discardIfDeleted(
  db: Db,
  storage: PhotoStorage,
  row: Pick<PhotoRow, "id" | "storagePath">,
  now: Clock,
): Promise<void> {
  try {
    const [current] = await db
      .select({ deletedAt: itemPhotos.deletedAt })
      .from(itemPhotos)
      .where(eq(itemPhotos.id, row.id))
      .limit(1)
    if (current?.deletedAt) await discardUploaded(db, storage, row, now)
  } catch {
    // 確認できなければ、行が削除済みなら sweep が拾い、生きていれば送り直しが続ける
  }
}

// photo の soft delete。1 文の UPDATE が行を押さえるので、同じ写真への並行する削除は片方だけが行を得る。
// 見えているのは ready の行だけなので、pending の行・別 item の photo・削除済みの photo は null (404)。
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
      and(
        eq(itemPhotos.id, photoId),
        eq(itemPhotos.itemId, itemId),
        eq(itemPhotos.status, "ready"),
        isNull(itemPhotos.deletedAt),
      ),
    )
    .returning()
  return row ?? null
}

// item の削除と同じ transaction で呼ぶ (pending の行も含める)。object の削除は commit の後 (removeObjectOf)。
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
// 行を削除待ちのまま残す (sweep が再試行する)。"requeued" は、消している間に discardUploaded が行を削除待ちに戻した
// (記録を書かなかった) 場合
export async function removeObjectOf(
  db: Db,
  storage: PhotoStorage,
  row: Pick<PhotoRow, "id" | "storagePath" | "updatedAt">,
  now: Clock,
): Promise<"removed" | "requeued" | "failed"> {
  const r = await removeObjectsOf(db, storage, [row], now)
  if (r.failed > 0) return "failed"
  return r.removed > 0 ? "removed" : "requeued"
}

export type RemovalResult = { removed: number; requeued: number; failed: number }

// 1 回の Storage 呼び出しで消す path の数。1 item の写真 (上限 5) は 1 回で済み、sweep の 1 回 (SWEEP_BATCH) は数回で済む
export const REMOVAL_CHUNK = 100

export async function removeObjectsOf(
  db: Db,
  storage: PhotoStorage,
  rows: Pick<PhotoRow, "id" | "storagePath" | "updatedAt">[],
  now: Clock,
): Promise<RemovalResult> {
  const total: RemovalResult = { removed: 0, requeued: 0, failed: 0 }
  for (let i = 0; i < rows.length; i += REMOVAL_CHUNK) {
    const chunk = rows.slice(i, i + REMOVAL_CHUNK)
    // object を消した後の行の更新が失敗しても、行は削除待ちのまま残るだけ (sweep が object の削除をやり直す。冪等)。
    // 完了の記録は、読んだときの updated_at の行にだけ書く。その間に discardUploaded が行を削除待ちに戻した
    // (object を置き直された) なら、その行の記録は何も更新せず、行は削除待ちのまま残る
    try {
      // oxlint-disable-next-line no-await-in-loop
      await storage.remove(chunk.map((r) => r.storagePath))
      // oxlint-disable-next-line no-await-in-loop
      const marked = await db
        .update(itemPhotos)
        .set({ storageDeletedAt: new Date(now()) })
        .where(
          or(
            ...chunk.map((r) =>
              and(
                eq(itemPhotos.id, r.id),
                sql`date_trunc('milliseconds', ${itemPhotos.updatedAt}) = ${r.updatedAt.toISOString()}::timestamptz`,
              ),
            ),
          ),
        )
        .returning({ id: itemPhotos.id })
      total.removed += marked.length
      total.requeued += chunk.length - marked.length
    } catch {
      total.failed += chunk.length
    }
  }
  return total
}

export type SweepResult = {
  // 止まった pending の行を削除済みにした数
  staleClaimed: number
  // object を消して storage_deleted_at を立てた行
  removed: number
  // object を消したが、その間に削除待ちに戻されて記録を書かなかった行 (次の回が拾う。失敗ではない)
  requeued: number
  // object の削除か行の更新に失敗した行 (job は非 0 で終わり、次の回で再試行する)
  failed: number
}

// 1. 止まった pending の行 (最後の動きから PENDING_STALE_AFTER_MS 経過) を、1 文の UPDATE で削除済みにする。
//    ready にする UPDATE と同じ行を取り合うので、ready になった行は取られず、取られた行は ready にならない
//    (遅れて来た要求は markReady が "gone" で、自分の object を消す)。object は取った後に消す
// 2. 削除済みで storage_deleted_at が null の行 (1 で取った行を含む) の object を、Storage の外の transaction なしで消す
// 3. 削除済みの行は、削除から LATE_UPLOAD_WINDOW_MS の間は、止まらなかった要求が object を置きうる。
//    pending の間に削除された行だけでなく、同じ photoId の 2 本の要求の一方が ready にした後に削除された行も (もう一方が upload を続けている)。
//    その間に記録した削除は最終ではないので、窓が閉じた後にもう 1 度 object を消して記録し直す
export async function sweepPhotos(
  db: Db,
  storage: PhotoStorage,
  now: Clock = Date.now,
): Promise<SweepResult> {
  const at = new Date(now())
  const stale = db
    .select({ id: itemPhotos.id })
    .from(itemPhotos)
    .where(
      and(
        eq(itemPhotos.status, "pending"),
        isNull(itemPhotos.deletedAt),
        lt(itemPhotos.updatedAt, new Date(now() - PENDING_STALE_AFTER_MS)),
      ),
    )
    .orderBy(asc(itemPhotos.updatedAt))
    .limit(SWEEP_BATCH)
  const claimed = await db
    .update(itemPhotos)
    .set({ deletedAt: at, updatedAt: at })
    .where(
      and(
        inArray(itemPhotos.id, stale),
        eq(itemPhotos.status, "pending"),
        isNull(itemPhotos.deletedAt),
        // 副問い合わせの結果は文の開始時点のまま。行の lock を待っている間に送り直しが updated_at を進めたなら、
        // この条件の再検査で外れる (READ COMMITTED は更新後の行に外側の条件を当て直す)
        lt(itemPhotos.updatedAt, new Date(now() - PENDING_STALE_AFTER_MS)),
      ),
    )
    .returning()

  const waiting = await db
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

  const late = await db
    .select()
    .from(itemPhotos)
    .where(
      and(
        lt(itemPhotos.deletedAt, new Date(now() - LATE_UPLOAD_WINDOW_MS)),
        // 窓が閉じる前に記録した削除だけ。窓の後の記録は最終。記録の無い行 (null) は比較が真にならず、上の waiting の担当
        lt(
          itemPhotos.storageDeletedAt,
          sql`${itemPhotos.deletedAt} + ${LATE_UPLOAD_WINDOW_MS} * interval '1 millisecond'`,
        ),
      ),
    )
    .orderBy(asc(itemPhotos.deletedAt))
    .limit(SWEEP_BATCH)

  const removal = await removeObjectsOf(db, storage, [...claimed, ...waiting, ...late], now)
  return { staleClaimed: claimed.length, ...removal }
}

export type CoverRow = { itemId: string; photoId: string; path: string }

// item ごとの先頭 1 枚 (created_at、同時刻は id の小さい方)。ready の写真で、item も photo も active なものだけ。
export async function listCovers(db: Reader, groupId: string): Promise<CoverRow[]> {
  return db
    .selectDistinctOn([itemPhotos.itemId], {
      itemId: itemPhotos.itemId,
      photoId: itemPhotos.id,
      path: itemPhotos.storagePath,
    })
    .from(itemPhotos)
    .innerJoin(
      items,
      and(eq(items.id, itemPhotos.itemId), eq(items.groupId, groupId), isNull(items.deletedAt)),
    )
    .where(
      and(
        eq(itemPhotos.groupId, groupId),
        eq(itemPhotos.status, "ready"),
        isNull(itemPhotos.deletedAt),
      ),
    )
    .orderBy(itemPhotos.itemId, itemPhotos.createdAt, itemPhotos.id)
}

export async function listItemPhotos(db: Reader, itemId: string): Promise<PhotoRow[]> {
  return db
    .select()
    .from(itemPhotos)
    .where(
      and(
        eq(itemPhotos.itemId, itemId),
        eq(itemPhotos.status, "ready"),
        isNull(itemPhotos.deletedAt),
      ),
    )
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
