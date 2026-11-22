// タグ名の同一判定に使う正規化。API (POST / PATCH / PUT の突き合わせ) と mobile の
// find-or-create が同じ関数を通すことで、同名タグを 1 本に保つ。
// Unicode の case folding ではなく toLowerCase なので、世帯のタグ一覧で足りる範囲に限る。
export const TAG_NAME_MAX = 50
export const TAGS_PER_ITEM_MAX = 20

export const normalizeTagName = (name: string): string =>
  name.trim().normalize("NFKC").toLowerCase()
