import type { ApiClient } from "@prep-hamster/api-client"

// 在庫詳細 (M-05) の非 UI ロジック: 入力検証 / patch の組み立て / API 呼び出し。
// 画面から切り出して描画なしの unit test で固定する。

export type Result<T> = { ok: true; value: T } | { ok: false; message: string }

export type StockDto = {
  id: string
  groupId: string
  itemId: string
  locationId: string
  quantity: number
  unit: string
  useByDate: string | null
  bestBeforeDate: string | null
  note: string | null
}

export type LocationDto = { id: string; name: string }

export type StockDetail = { stock: StockDto; itemName: string; locations: LocationDto[] }

export type EditPatch = {
  useByDate?: string | null
  bestBeforeDate?: string | null
  note?: string | null
}

export type ActionResult = { ok: true; stock: StockDto } | { ok: false; message: string }

const REASON_MAX = 500

export function parseAmount(input: string, remaining: number): Result<number> {
  const trimmed = input.trim()
  const value = trimmed === "" ? Number.NaN : Number(trimmed)
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, message: "数量は 0 より大きい数値で入力してください" }
  }
  if (value > remaining) return { ok: false, message: `残量 ${remaining} を超えています` }
  return { ok: true, value }
}

export function parseReason(input: string): Result<string | null> {
  const trimmed = input.trim()
  if (trimmed.length > REASON_MAX) {
    return { ok: false, message: `理由は ${REASON_MAX} 文字以内で入力してください` }
  }
  return { ok: true, value: trimmed === "" ? null : trimmed }
}

export function parseDateField(input: string): Result<string | null> {
  const trimmed = input.trim()
  if (trimmed === "") return { ok: true, value: null }
  const bad = { ok: false, message: "日付は YYYY-MM-DD 形式で入力してください" } as const
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!m) return bad
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  // 2026-02-30 のような実在しない日付は Date が繰り上げるので往復で弾く
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return bad
  return { ok: true, value: trimmed }
}

export function buildEditPatch(
  original: { useByDate: string | null; bestBeforeDate: string | null; note: string | null },
  form: { useByDate: string; bestBeforeDate: string; note: string },
): Result<EditPatch> {
  const useBy = parseDateField(form.useByDate)
  if (!useBy.ok) return { ok: false, message: `使用期限: ${useBy.message}` }
  const bestBefore = parseDateField(form.bestBeforeDate)
  if (!bestBefore.ok) return { ok: false, message: `賞味期限: ${bestBefore.message}` }
  const note = form.note.trim() === "" ? null : form.note

  const patch: EditPatch = {}
  if (useBy.value !== original.useByDate) patch.useByDate = useBy.value
  if (bestBefore.value !== original.bestBeforeDate) patch.bestBeforeDate = bestBefore.value
  if (note !== original.note) patch.note = note
  if (Object.keys(patch).length === 0) return { ok: false, message: "変更がありません" }
  return { ok: true, value: patch }
}

// screen-flow.md 2.3.2: 残量 0 で買い物リスト追加を提案する (表示のみ)。
export function shouldSuggestShopping(quantity: number): boolean {
  return quantity <= 0
}

export function moveTargets(locations: LocationDto[], currentLocationId: string): LocationDto[] {
  return locations.filter((l) => l.id !== currentLocationId)
}

async function failure(res: Response): Promise<{ ok: false; message: string }> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } }
    const message = body.error?.message
    if (typeof message === "string" && message !== "") return { ok: false, message }
  } catch {
    // body が JSON でなければ status だけ返す
  }
  return { ok: false, message: `HTTP ${res.status}` }
}

function errorMessage(err: unknown): { ok: false; message: string } {
  return { ok: false, message: err instanceof Error ? err.message : "unknown" }
}

export async function loadStockDetail(
  client: ApiClient,
  id: string,
): Promise<{ ok: true; detail: StockDetail } | { ok: false; message: string }> {
  try {
    const stockRes = await client.v1.stocks[":id"].$get({ param: { id } })
    if (!stockRes.ok) return await failure(stockRes)
    const { stock } = await stockRes.json()
    const [itemRes, locsRes] = await Promise.all([
      client.v1.items[":id"].$get({ param: { id: stock.itemId } }),
      client.v1.locations.$get({ query: { groupId: stock.groupId } }),
    ])
    if (!itemRes.ok) return await failure(itemRes)
    if (!locsRes.ok) return await failure(locsRes)
    const { item } = await itemRes.json()
    const { locations } = await locsRes.json()
    return { ok: true, detail: { stock, itemName: item.name, locations } }
  } catch (err) {
    return errorMessage(err)
  }
}

export async function consumeStock(
  client: ApiClient,
  id: string,
  quantityDelta: number,
): Promise<ActionResult> {
  try {
    const res = await client.v1.stocks[":id"].consume.$post({
      param: { id },
      json: { quantityDelta },
    })
    if (!res.ok) return await failure(res)
    return { ok: true, stock: (await res.json()).stock }
  } catch (err) {
    return errorMessage(err)
  }
}

export async function discardStock(
  client: ApiClient,
  id: string,
  quantityDelta: number,
  reason: string | null,
): Promise<ActionResult> {
  try {
    const res = await client.v1.stocks[":id"].discard.$post({
      param: { id },
      json: { quantityDelta, ...(reason === null ? {} : { reason }) },
    })
    if (!res.ok) return await failure(res)
    return { ok: true, stock: (await res.json()).stock }
  } catch (err) {
    return errorMessage(err)
  }
}

export async function moveStock(
  client: ApiClient,
  id: string,
  toLocationId: string,
): Promise<ActionResult> {
  try {
    const res = await client.v1.stocks[":id"].move.$post({ param: { id }, json: { toLocationId } })
    if (!res.ok) return await failure(res)
    return { ok: true, stock: (await res.json()).stock }
  } catch (err) {
    return errorMessage(err)
  }
}

export async function editStock(
  client: ApiClient,
  id: string,
  patch: EditPatch,
): Promise<ActionResult> {
  try {
    const res = await client.v1.stocks[":id"].$patch({ param: { id }, json: patch })
    if (!res.ok) return await failure(res)
    return { ok: true, stock: (await res.json()).stock }
  } catch (err) {
    return errorMessage(err)
  }
}
