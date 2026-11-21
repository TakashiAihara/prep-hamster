# mobile の場所 (location) 管理 (#171)

## To-Be

- 場所の新規作成は `/add/details` のインライン作成 (#179) に加えて、名前の変更と削除がモバイルからできる
- 場所管理の画面 `/locations` は root の Stack の modal。入口は `/groups` モーダルの現在グループ欄にある「保管場所を管理」の行
- 場所の一覧は `GET /v1/locations` を画面の focus ごとに取り直す。在庫一覧・在庫詳細と同じパターン
- rename は行をその場の編集モードに切り替えて `PATCH /v1/locations/:id` に `{ name }` を送る。名前は trim し、空なら保存できない
- delete は確認の `Alert.alert` (destructive) のあと `DELETE /v1/locations/:id` を呼ぶ。参照する stock があると API が 422 `LOCATION_IN_USE` を返すので、API の message に「在庫を別の場所へ移動してから削除してください」を添えて出す。参照数の表示はしない (API が件数を返さず、在庫一覧をクライアントで数えるとサーバの判定と食い違うため)
- soft delete 済みの stock は参照判定に数えない (API 側で `isNull(stocks.deletedAt)` を見ている)
- `sortOrder` は UI に出さない。並びは API が返す順のまま。並べ替えは要望が出てから
- 新規作成のフォームは `/locations` に置かない。`/add/details` のインライン作成と二重になるため。場所 0 件なら「場所がまだありません」とだけ出す
- role はクライアントが持たないので、編集・削除のボタンは常に出す。VIEWER 等の権限不足は API の 403 message をそのまま出す (グループ招待ボタンと同じ既存パターン)

## 画面の組み立て

- `app/locations.tsx`: `/groups` と同じく `useCurrentGroup().status` が `ok` でなければ `/` へ Redirect する独自判定。場所の取得・rename・delete の状態遷移は純関数に寄せ、画面はそれを呼ぶだけにする
- `src/location-manage.ts`: `PATCH` / `DELETE` の呼び出しと失敗時の message を返す純関数。`src/location-create.ts` と同じく描画なしの unit test で固定する
- `/groups` の現在グループ欄 (招待ボタンの下) に「保管場所を管理」の行を足し、`router.push("/locations")` で開く

## 他画面への影響

- `/stocks/[id]` と在庫一覧は focus 時に locations を含めて取り直すので、rename / delete は開き直しで自然に反映される
- モーダルを閉じたとき下の画面に focus イベントが再発火するかは実機で確認する。発火しなくても在庫詳細の場所名が古いまま残るだけで、操作は locationId ベースなので実害は小さい
- `/add/details` は `/locations` へ辿れない (add 配下の Stack に入口が無い) ので、選択中の場所が消える経路は「別端末で削除してから保存」くらいに限られる。開き直せば最新を取る既存挙動に任せ、今回は触らない

## テスト

- unit (`bun test src`): `location-manage.ts` の PATCH / DELETE 呼び出し (成功・API エラー message・通信例外)、422 `LOCATION_IN_USE` への補足 message、rename 反映・delete 除去の一覧更新 (対象が無いときは同じ配列を返す)
- 実機: 場所を rename → 在庫一覧・詳細の場所名が変わる、stock の無い場所を delete → 一覧から消える、stock のある場所を delete → 422 の message が出る
- Maestro の flow 追加はしない (#181 が add 画面側のテスト残件を持っている)
