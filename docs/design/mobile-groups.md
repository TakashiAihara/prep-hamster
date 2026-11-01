# mobile のグループ (#127)

## To-Be

- サインインすると、自分が所属するグループの在庫が出る。固定の group id (`src/config.ts` の `getCurrentGroupId()` と env `EXPO_PUBLIC_STUB_GROUP_ID`) は無くなる
- 所属グループが 1 つも無ければ、タブの代わりに「グループを作る」画面が出る。名前を入れて作ると、そのグループで一覧に進む
- ヘッダーの左に今のグループ名のピルが出る。押すとグループ切替 (M-10) が開き、所属グループの一覧から選ぶと一覧の中身が変わる。M-10 の下に「新しいグループを作る」がある
- 選んだグループは端末に残り、次に開いたときもそのグループで始まる
- 切替画面 (M-10) の「このグループに招待する」で招待コードを発行し、共有シートで送る。受け取った人は「招待コードで参加」にコードを貼って参加する (判断キュー D-13)

## 今のグループの決め方

- `GET /v1/groups` の一覧と、端末に残した group id から決める
- 残した id が一覧にあればそれ。無ければ (初回 / 抜けたグループ / 別のユーザーでサインインし直した) `createdAt` が最も古いもの。一覧が空なら「無い」
- この判定は純粋関数 `pickCurrentGroup(groups, storedId)` に置き、unit で押さえる
- 端末に残す先は AsyncStorage の `prep-hamster.current-group-id` (秘密ではないので secure-store にしない)

## 画面の組み立て

- `src/current-group.tsx` の `CurrentGroupProvider` は root の layout で `AuthStatusProvider` の内側に置く (タブの外の M-10 と詳細画面からも使うため)。サインイン済みのときだけ一覧を取り、サインアウトしたら状態を捨てる
- `useCurrentGroup()` は `{ status: "loading" | "ok" | "error", message, group, groups, select, create, reload }` を配る。`status` が `ok` で `group` が無ければ所属グループ 0 件。`create(name)` は作ったグループを選んだ状態にし、失敗したら throw する
- タブの layout は取得中なら spinner、グループが無ければ「グループを作る」画面、取得に失敗したら理由と再試行を出す
- 在庫一覧・バーコード登録・詳細の 3 か所は `getCurrentGroupId()` の代わりに `useCurrentGroup()` の id を使う。グループが変わったら一覧を取り直す
- M-10 は root の Stack の modal (`app/groups.tsx`)

## テスト

- unit: `pickCurrentGroup` (残した id が一覧にある / 無い / 一覧が空 / 最古の選び方)
- 実機: Google でサインインしたユーザーで、グループを作る → 一覧が出る → もう 1 つ作って切り替える → アプリを開き直しても選んだグループで始まる
- Maestro の flow は、テスト用ユーザーが所属グループを持たないと「グループを作る」画面で止まる。flow の先頭でグループを作るかは、Maestro を流せる環境 (Android emulator) ができたときに決める

## 招待 (D-13)

- 発行: M-10 の「このグループに招待する」が `POST /v1/groups/{groupId}/invitations` を `role: "EDITOR"` (期限は API の既定の 7 日) で呼び、`Share.share` で招待コード (token) と使い方の 1 文を送る。OWNER 以外は API が 403 を返すので、その message を出す。役割の選択 (VIEWER) は付けない
- 受諾: M-10 と「グループを作る」画面に「招待コードで参加」の入力を置く。貼られた文字列から UUID を取り出して (共有シートの本文をまるごと貼っても通るように) `POST /v1/invitations/{token}/accept` を呼ぶ。成功したら一覧を取り直し、参加したグループを選ぶ。失敗は API の `error.message` (日本語) を出す。UUID が見つからなければ API を呼ばずに「招待コードが見つかりません」
- 取り出しは純関数 `parseInviteCode(text)` に置いて unit で押さえる
- 深リンク (`prep-hamster://invite/<token>`) は dev build / 本番 build を配るようになったら足す
