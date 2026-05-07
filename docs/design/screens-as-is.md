# As-Is Screen Catalog

> このファイルは `bun run --filter @prep-hamster/mobile capture` で生成される。
> 手動編集する場合は再生成で上書きされる前提。

## 画面遷移 (現状)

```mermaid
graph LR
  Home[在庫一覧]
  Add[追加エントリ]
  Scan[カメラスキャン]
  Manual[手動入力]
  Details[詳細・保存]
  Home -- 追加 tab --> Add
  Add -- カメラで読み取る --> Scan
  Add -- 手動で barcode --> Manual
  Scan -- 読取成功 --> Details
  Manual -- 送信 --> Details
  Details -- 保存 --> Home
```

## キャプチャ

### add-manual-after-submit

![add-manual-after-submit](./screens-as-is/add-manual-after-submit.png)

### add-manual-input-filled

![add-manual-input-filled](./screens-as-is/add-manual-input-filled.png)

### add-manual-input

![add-manual-input](./screens-as-is/add-manual-input.png)

### add-scan-permission-or-camera

![add-scan-permission-or-camera](./screens-as-is/add-scan-permission-or-camera.png)

### home-add-entry

![home-add-entry](./screens-as-is/home-add-entry.png)

### home-stocks-list

![home-stocks-list](./screens-as-is/home-stocks-list.png)

## 実行手順

1. Android emulator を起動 (Android Studio / `emulator -avd <name>`)
2. `bun run --filter @prep-hamster/mobile android` で app をビルド & インストール
3. `bun run --filter @prep-hamster/mobile capture` で flow 実行 + キャプチャ取得
