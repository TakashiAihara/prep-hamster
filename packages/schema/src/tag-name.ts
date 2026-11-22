// タグ名の同一判定に使う正規化。API (POST / PATCH / PUT の突き合わせ) と mobile の
// find-or-create が同じ関数を通すことで、同名タグを 1 本に保つ。
// Unicode の case folding ではなく toLowerCase なので、世帯のタグ一覧で足りる範囲に限る。
export const TAG_NAME_MAX = 50
export const TAGS_PER_ITEM_MAX = 20

// trim は NFKC の後。NFKC が空白 (U+3000 や U+00B4 の分解) を作るので、先に trim すると先頭に残る
export const normalizeTagName = (name: string): string =>
  name.normalize("NFKC").trim().toLowerCase()
