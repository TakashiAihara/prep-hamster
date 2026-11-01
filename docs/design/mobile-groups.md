# mobile のグループ (#127)

## To-Be

- サインインすると、自分が所属するグループの在庫が出る。固定の group id (`src/config.ts` の `getCurrentGroupId()` と env `EXPO_PUBLIC_STUB_GROUP_ID`) は無くなる
- 所属グループが 1 つも無ければ、タブの代わりに「グループを作る」画面が出る。名前を入れて作ると、そのグループで一覧に進む
- ヘッダーの左に今のグループ名のピルが出る。押すとグループ切替 (M-10) が開き、所属グループの一覧から選ぶと一覧の中身が変わる。M-10 の下に「新しいグループを作る」がある
- 選んだグループは端末に残り、次に開いたときもそのグループで始まる
- 招待の発行と受諾は判断キュー D-13 の決着後に足す (この文書の後半に追記する)

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
- Maestro の flow は、テスト用ユーザーが所属グループを持たないと「グループを作る」画面で止まる。flow の先頭でグループを作るかは、Maestro を流せる環境ができたときに決める (d1 に Android の環境が無い)
