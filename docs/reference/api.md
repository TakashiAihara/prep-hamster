# API reference

> `apps/core/api` が配信する OpenAPI spec (`/openapi.json`) から `bun run docs:generate` (`apps/core/api/scripts/generate-api-docs.ts`) で自動生成される。手で編集せず、route 定義を変えたら再生成する。
>
> - 起動中の API では `/docs` で対話的なリファレンス (Scalar) を、`/openapi.json` で spec 本体を取得できる。
> - `/v1/*` の全 endpoint は `Authorization: Bearer <Supabase access token>` による認証が必要。

## categories

### `GET /v1/categories`

group 単位で category 一覧

| パラメータ | 場所    | 必須 | 型             | 説明 |
| ---------- | ------- | ---- | -------------- | ---- |
| `groupId`  | `query` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス                   |
| ---------- | ------------------------------------------------------------------------- | ---------------------------- |
| `200`      | 一覧                                                                      | `{ categories: Category[] }` |
| `401`      | 未認証                                                                    | `ApiError`                   |
| `403`      | 未参加                                                                    | `ApiError`                   |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError`                   |
| `422`      | クエリ不正                                                                | `ApiError`                   |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError`                   |

### `POST /v1/categories`

category を作成 (EDITOR 以上)

**リクエストボディ**: `CreateCategoryBody`

| ステータス | 説明                                                                                                    | レスポンス               |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------ |
| `201`      | 作成成功                                                                                                | `{ category: Category }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`               |
| `401`      | 未認証                                                                                                  | `ApiError`               |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`               |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`               |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`               |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`               |
| `422`      | ボディ不正                                                                                              | `ApiError`               |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`               |

### `GET /v1/categories/{id}`

category 単件取得

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス               |
| ---------- | ------------------------------------------------------------------------- | ------------------------ |
| `200`      | 取得成功                                                                  | `{ category: Category }` |
| `401`      | 未認証                                                                    | `ApiError`               |
| `403`      | 未参加                                                                    | `ApiError`               |
| `404`      | 存在しない                                                                | `ApiError`               |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError`               |
| `422`      | パラメータ不正                                                            | `ApiError`               |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError`               |

### `PATCH /v1/categories/{id}`

category を更新 (EDITOR 以上)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

**リクエストボディ**: `UpdateCategoryBody`

| ステータス | 説明                                                                                                    | レスポンス               |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------ |
| `200`      | 更新成功                                                                                                | `{ category: Category }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`               |
| `401`      | 未認証                                                                                                  | `ApiError`               |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`               |
| `404`      | 存在しない                                                                                              | `ApiError`               |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`               |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`               |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`               |
| `422`      | ボディ不正                                                                                              | `ApiError`               |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`               |

### `DELETE /v1/categories/{id}`

category を soft delete (EDITOR 以上)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス |
| ---------- | ------------------------------------------------------------------------- | ---------- |
| `204`      | 削除成功                                                                  | `—`        |
| `401`      | 未認証                                                                    | `ApiError` |
| `403`      | 未参加 / role 不足                                                        | `ApiError` |
| `404`      | 存在しない                                                                | `ApiError` |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError` |
| `422`      | 子 item が参照中                                                          | `ApiError` |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError` |

## groups

### `GET /v1/groups`

current user が所属する group 一覧

| ステータス | 説明                                                                      | レスポンス            |
| ---------- | ------------------------------------------------------------------------- | --------------------- |
| `200`      | 所属 group 一覧                                                           | `{ groups: Group[] }` |
| `401`      | 未認証                                                                    | `ApiError`            |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError`            |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError`            |

### `POST /v1/groups`

group を作成し、作成者を OWNER として membership 追加

**リクエストボディ**: `CreateGroupBody`

| ステータス | 説明                                                                                                    | レスポンス                                 |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `201`      | 作成成功                                                                                                | `{ group: Group, membership: Membership }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`                                 |
| `401`      | 未認証                                                                                                  | `ApiError`                                 |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`                                 |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`                                 |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`                                 |
| `422`      | ボディ不正                                                                                              | `ApiError`                                 |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`                                 |

### `GET /v1/groups/{id}`

group 単件取得（member のみ）

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス         |
| ---------- | ------------------------------------------------------------------------- | ------------------ |
| `200`      | 取得成功                                                                  | `{ group: Group }` |
| `401`      | 未認証                                                                    | `ApiError`         |
| `403`      | 未参加                                                                    | `ApiError`         |
| `404`      | 存在しない                                                                | `ApiError`         |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError`         |
| `422`      | パラメータ不正                                                            | `ApiError`         |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError`         |

### `PATCH /v1/groups/{id}`

group の名前変更（OWNER のみ）

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

**リクエストボディ**: `UpdateGroupBody`

| ステータス | 説明                                                                                                    | レスポンス         |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------ |
| `200`      | 更新成功                                                                                                | `{ group: Group }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`         |
| `401`      | 未認証                                                                                                  | `ApiError`         |
| `403`      | OWNER でない / 未参加                                                                                   | `ApiError`         |
| `404`      | 存在しない                                                                                              | `ApiError`         |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`         |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`         |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`         |
| `422`      | ボディ不正                                                                                              | `ApiError`         |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`         |

## invitations

### `POST /v1/groups/{groupId}/invitations`

招待トークンを発行 (OWNER のみ)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `groupId`  | `path` | yes  | `string(uuid)` | —    |

**リクエストボディ**: `CreateInvitationBody`

| ステータス | 説明                                                                                                    | レスポンス                   |
| ---------- | ------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `201`      | 発行成功                                                                                                | `{ invitation: Invitation }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`                   |
| `401`      | 未認証                                                                                                  | `ApiError`                   |
| `403`      | OWNER でない / 未参加                                                                                   | `ApiError`                   |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`                   |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`                   |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`                   |
| `422`      | ボディ不正                                                                                              | `ApiError`                   |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`                   |

### `POST /v1/invitations/{token}/accept`

招待トークンで group に参加

| パラメータ | 場所   | 必須 | 型       | 説明 |
| ---------- | ------ | ---- | -------- | ---- |
| `token`    | `path` | yes  | `string` | —    |

| ステータス | 説明                                                                                                | レスポンス                   |
| ---------- | --------------------------------------------------------------------------------------------------- | ---------------------------- |
| `201`      | 参加成功 (新規 membership)                                                                          | `{ membership: Membership }` |
| `401`      | 未認証                                                                                              | `ApiError`                   |
| `404`      | token が存在しない                                                                                  | `ApiError`                   |
| `409`      | token 使用済み / 既に当該 group の member / 同じメールアドレスのアカウントが別にある (EMAIL_IN_USE) | `ApiError`                   |
| `422`      | token 期限切れ                                                                                      | `ApiError`                   |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                        | `ApiError`                   |

## items

### `GET /v1/items`

group 単位で item 一覧 (categoryId / tagId / barcode 絞り込み可)

| パラメータ   | 場所    | 必須 | 型             | 説明 |
| ------------ | ------- | ---- | -------------- | ---- |
| `groupId`    | `query` | yes  | `string(uuid)` | —    |
| `categoryId` | `query` | no   | `string(uuid)` | —    |
| `tagId`      | `query` | no   | `string(uuid)` | —    |
| `barcode`    | `query` | no   | `string`       | —    |

| ステータス | 説明                                                                      | レスポンス          |
| ---------- | ------------------------------------------------------------------------- | ------------------- |
| `200`      | 一覧                                                                      | `{ items: Item[] }` |
| `401`      | 未認証                                                                    | `ApiError`          |
| `403`      | 未参加                                                                    | `ApiError`          |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError`          |
| `422`      | クエリ不正                                                                | `ApiError`          |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError`          |

### `POST /v1/items`

item を手動作成 (EDITOR 以上)

**リクエストボディ**: `CreateItemBody`

| ステータス | 説明                                                                                                    | レスポンス       |
| ---------- | ------------------------------------------------------------------------------------------------------- | ---------------- |
| `201`      | 作成成功                                                                                                | `{ item: Item }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`       |
| `401`      | 未認証                                                                                                  | `ApiError`       |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`       |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`       |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`       |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`       |
| `422`      | ボディ不正 / barcode 重複 / category 不整合                                                             | `ApiError`       |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`       |

### `GET /v1/items/{id}`

item 単件取得

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス       |
| ---------- | ------------------------------------------------------------------------- | ---------------- |
| `200`      | 取得成功                                                                  | `{ item: Item }` |
| `401`      | 未認証                                                                    | `ApiError`       |
| `403`      | 未参加                                                                    | `ApiError`       |
| `404`      | 存在しない                                                                | `ApiError`       |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError`       |
| `422`      | パラメータ不正                                                            | `ApiError`       |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError`       |

### `PATCH /v1/items/{id}`

item を更新 (EDITOR 以上)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

**リクエストボディ**: `UpdateItemBody`

| ステータス | 説明                                                                                                    | レスポンス       |
| ---------- | ------------------------------------------------------------------------------------------------------- | ---------------- |
| `200`      | 更新成功                                                                                                | `{ item: Item }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`       |
| `401`      | 未認証                                                                                                  | `ApiError`       |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`       |
| `404`      | 存在しない                                                                                              | `ApiError`       |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`       |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`       |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`       |
| `422`      | ボディ不正 / barcode 重複 / category 不整合                                                             | `ApiError`       |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`       |

### `DELETE /v1/items/{id}`

item を soft delete (EDITOR 以上)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス |
| ---------- | ------------------------------------------------------------------------- | ---------- |
| `204`      | 削除成功                                                                  | `—`        |
| `401`      | 未認証                                                                    | `ApiError` |
| `403`      | 未参加 / role 不足                                                        | `ApiError` |
| `404`      | 存在しない                                                                | `ApiError` |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError` |
| `422`      | active stock が参照中                                                     | `ApiError` |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError` |

### `PUT /v1/items/{id}/tags`

item の tag 集合を丸ごと置き換える (EDITOR 以上。最後の PUT が勝つ)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

**リクエストボディ**: `PutItemTagsBody`

| ステータス | 説明                                                                                                    | レスポンス                    |
| ---------- | ------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `200`      | 置き換え成功                                                                                            | `{ item: Item, tags: Tag[] }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`                    |
| `401`      | 未認証                                                                                                  | `ApiError`                    |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`                    |
| `404`      | item が存在しない                                                                                       | `ApiError`                    |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`                    |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`                    |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`                    |
| `422`      | ボディ不正 / tag の group 不整合 / 1 item あたりの上限超過                                              | `ApiError`                    |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`                    |

### `POST /v1/items/by-barcode`

barcode から item を find-or-create (EDITOR 以上)

**リクエストボディ**: `ItemByBarcodeBody`

| ステータス | 説明                                                                                                    | レスポンス              |
| ---------- | ------------------------------------------------------------------------------------------------------- | ----------------------- |
| `200`      | 既存 item を返却                                                                                        | `ItemByBarcodeResponse` |
| `201`      | 外部 lookup hit / miss いずれかで新規作成                                                               | `ItemByBarcodeResponse` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`              |
| `401`      | 未認証                                                                                                  | `ApiError`              |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`              |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`              |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`              |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`              |
| `422`      | ボディ不正                                                                                              | `ApiError`              |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`              |

## locations

### `GET /v1/locations`

group 単位で location 一覧

| パラメータ | 場所    | 必須 | 型             | 説明 |
| ---------- | ------- | ---- | -------------- | ---- |
| `groupId`  | `query` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス                  |
| ---------- | ------------------------------------------------------------------------- | --------------------------- |
| `200`      | 一覧                                                                      | `{ locations: Location[] }` |
| `401`      | 未認証                                                                    | `ApiError`                  |
| `403`      | 未参加                                                                    | `ApiError`                  |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError`                  |
| `422`      | クエリ不正                                                                | `ApiError`                  |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError`                  |

### `POST /v1/locations`

location を作成 (EDITOR 以上)

**リクエストボディ**: `CreateLocationBody`

| ステータス | 説明                                                                                                    | レスポンス               |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------ |
| `201`      | 作成成功                                                                                                | `{ location: Location }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`               |
| `401`      | 未認証                                                                                                  | `ApiError`               |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`               |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`               |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`               |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`               |
| `422`      | ボディ不正                                                                                              | `ApiError`               |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`               |

### `GET /v1/locations/{id}`

location 単件取得

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス               |
| ---------- | ------------------------------------------------------------------------- | ------------------------ |
| `200`      | 取得成功                                                                  | `{ location: Location }` |
| `401`      | 未認証                                                                    | `ApiError`               |
| `403`      | 未参加                                                                    | `ApiError`               |
| `404`      | 存在しない                                                                | `ApiError`               |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError`               |
| `422`      | パラメータ不正                                                            | `ApiError`               |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError`               |

### `PATCH /v1/locations/{id}`

location を更新 (EDITOR 以上)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

**リクエストボディ**: `UpdateLocationBody`

| ステータス | 説明                                                                                                    | レスポンス               |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------ |
| `200`      | 更新成功                                                                                                | `{ location: Location }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`               |
| `401`      | 未認証                                                                                                  | `ApiError`               |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`               |
| `404`      | 存在しない                                                                                              | `ApiError`               |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`               |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`               |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`               |
| `422`      | ボディ不正                                                                                              | `ApiError`               |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`               |

### `DELETE /v1/locations/{id}`

location を soft delete (EDITOR 以上)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス |
| ---------- | ------------------------------------------------------------------------- | ---------- |
| `204`      | 削除成功                                                                  | `—`        |
| `401`      | 未認証                                                                    | `ApiError` |
| `403`      | 未参加 / role 不足                                                        | `ApiError` |
| `404`      | 存在しない                                                                | `ApiError` |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError` |
| `422`      | 子 stock が参照中                                                         | `ApiError` |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError` |

## memberships

### `GET /v1/groups/{groupId}/memberships`

group の member 一覧 (member 全員に open)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `groupId`  | `path` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス                      |
| ---------- | ------------------------------------------------------------------------- | ------------------------------- |
| `200`      | member 一覧                                                               | `{ memberships: Membership[] }` |
| `401`      | 未認証                                                                    | `ApiError`                      |
| `403`      | 未参加                                                                    | `ApiError`                      |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError`                      |
| `422`      | パラメータ不正                                                            | `ApiError`                      |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError`                      |

### `PATCH /v1/groups/{groupId}/memberships/{userId}`

メンバーの role を変更 (OWNER のみ、自分の OWNER 剥奪不可)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `groupId`  | `path` | yes  | `string(uuid)` | —    |
| `userId`   | `path` | yes  | `string(uuid)` | —    |

**リクエストボディ**: `UpdateMembershipRoleBody`

| ステータス | 説明                                                                                                    | レスポンス                   |
| ---------- | ------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `200`      | 更新成功                                                                                                | `{ membership: Membership }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`                   |
| `401`      | 未認証                                                                                                  | `ApiError`                   |
| `403`      | OWNER でない / 未参加                                                                                   | `ApiError`                   |
| `404`      | 対象メンバーが存在しない                                                                                | `ApiError`                   |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`                   |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`                   |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`                   |
| `422`      | ボディ不正 / 自分の OWNER 剥奪を試行                                                                    | `ApiError`                   |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`                   |

### `DELETE /v1/groups/{groupId}/memberships/{userId}`

メンバーを削除 (OWNER のみ、最後の OWNER は削除不可)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `groupId`  | `path` | yes  | `string(uuid)` | —    |
| `userId`   | `path` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス |
| ---------- | ------------------------------------------------------------------------- | ---------- |
| `204`      | 削除成功                                                                  | `—`        |
| `401`      | 未認証                                                                    | `ApiError` |
| `403`      | OWNER でない / 未参加                                                     | `ApiError` |
| `404`      | 対象メンバーが存在しない                                                  | `ApiError` |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError` |
| `422`      | 最後の OWNER の削除試行                                                   | `ApiError` |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError` |

## push-tokens

### `POST /v1/push-tokens`

端末の Expo push token を登録 (同じ token は current user に付け替え)

クライアントの契約: サインアウト時に必ず DELETE /v1/push-tokens で自分の token を消すこと。消さないと、その端末に前のユーザーの在庫通知が次の登録まで届く。他のユーザーが持っている token を登録すると、その token は呼び出したユーザーに付け替わる (共有端末で別ユーザーがログインする場合の想定)。1 ユーザーあたり最大 10 件で、11 件目を登録すると updated_at が最も古い token が削除される。

**リクエストボディ**: `{ token: string }`

| ステータス | 説明                                                                                                    | レスポンス                         |
| ---------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `200`      | 登録成功                                                                                                | `{ pushToken: { token: string } }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`                         |
| `401`      | 未認証                                                                                                  | `ApiError`                         |
| `404`      | user が存在しない (論理削除済みを含む)                                                                  | `ApiError`                         |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`                         |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`                         |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`                         |
| `422`      | token の形式不正                                                                                        | `ApiError`                         |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`                         |

### `DELETE /v1/push-tokens`

current user の push token を削除 (無ければ何もしない)

**リクエストボディ**: `{ token: string }`

| ステータス | 説明                                                                                                    | レスポンス |
| ---------- | ------------------------------------------------------------------------------------------------------- | ---------- |
| `204`      | 削除済み                                                                                                | `—`        |
| `400`      | JSON として読めないボディ                                                                               | `ApiError` |
| `401`      | 未認証                                                                                                  | `ApiError` |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError` |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError` |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError` |
| `422`      | token の形式不正                                                                                        | `ApiError` |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError` |

## stocks

### `GET /v1/stocks`

在庫一覧を取得 (categoryId / tagId / locationId / 期限で絞り込み可。使い切った在庫は includeEmpty=true のときだけ含む)

| パラメータ       | 場所    | 必須 | 型             | 説明                                                                        |
| ---------------- | ------- | ---- | -------------- | --------------------------------------------------------------------------- |
| `groupId`        | `query` | yes  | `string(uuid)` | —                                                                           |
| `categoryId`     | `query` | no   | `string(uuid)` | —                                                                           |
| `tagId`          | `query` | no   | `string(uuid)` | —                                                                           |
| `locationId`     | `query` | no   | `string(uuid)` | —                                                                           |
| `expiringBefore` | `query` | no   | `string(date)` | —                                                                           |
| `includeExpired` | `query` | no   | `boolean`      | —                                                                           |
| `includeEmpty`   | `query` | no   | `boolean`      | true で使い切った在庫 (小数第 6 位で丸めて 0 以下) も含める。既定は含めない |

| ステータス | 説明                                                                      | レスポンス            |
| ---------- | ------------------------------------------------------------------------- | --------------------- |
| `200`      | 在庫一覧 (useByDate ASC NULLS LAST, bestBeforeDate ASC NULLS LAST)        | `{ stocks: Stock[] }` |
| `401`      | 未認証                                                                    | `ApiError`            |
| `403`      | 未参加                                                                    | `ApiError`            |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError`            |
| `422`      | クエリ不正                                                                | `ApiError`            |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError`            |

### `POST /v1/stocks`

在庫を 1 件作成

**リクエストボディ**: `CreateStockBody`

| ステータス | 説明                                                                                                    | レスポンス         |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------ |
| `201`      | 作成成功                                                                                                | `{ stock: Stock }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`         |
| `401`      | 未認証                                                                                                  | `ApiError`         |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`         |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`         |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`         |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`         |
| `422`      | ボディ不正 / itemId・locationId が別 group (ITEM_GROUP_MISMATCH / LOCATION_GROUP_MISMATCH)              | `ApiError`         |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`         |

### `GET /v1/stocks/{id}`

在庫を 1 件取得

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス         |
| ---------- | ------------------------------------------------------------------------- | ------------------ |
| `200`      | 取得成功                                                                  | `{ stock: Stock }` |
| `401`      | 未認証                                                                    | `ApiError`         |
| `403`      | 未参加                                                                    | `ApiError`         |
| `404`      | 存在しない                                                                | `ApiError`         |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError`         |
| `422`      | パラメータ不正                                                            | `ApiError`         |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError`         |

### `PATCH /v1/stocks/{id}`

在庫の属性を部分更新 (EDITOR 以上、quantity は対象外)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

**リクエストボディ**: `UpdateStockBody`

| ステータス | 説明                                                                                                    | レスポンス         |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------ |
| `200`      | 更新成功                                                                                                | `{ stock: Stock }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`         |
| `401`      | 未認証                                                                                                  | `ApiError`         |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`         |
| `404`      | 存在しない                                                                                              | `ApiError`         |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`         |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`         |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`         |
| `422`      | ボディ不正 (quantity を含む / 移動先 location が group 外)                                              | `ApiError`         |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`         |

### `DELETE /v1/stocks/{id}`

在庫を soft delete (EDITOR 以上)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス |
| ---------- | ------------------------------------------------------------------------- | ---------- |
| `204`      | 削除成功                                                                  | `—`        |
| `401`      | 未認証                                                                    | `ApiError` |
| `403`      | 未参加 / role 不足                                                        | `ApiError` |
| `404`      | 存在しない                                                                | `ApiError` |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError` |
| `422`      | パラメータ不正                                                            | `ApiError` |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError` |

### `POST /v1/stocks/{id}/consume`

在庫を消費 (EDITOR 以上)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

**リクエストボディ**: `StockQuantityDeltaBody`

| ステータス | 説明                                                                                                    | レスポンス                            |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `200`      | 消費成功                                                                                                | `{ stock: Stock, event: StockEvent }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`                            |
| `401`      | 未認証                                                                                                  | `ApiError`                            |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`                            |
| `404`      | 存在しない                                                                                              | `ApiError`                            |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`                            |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`                            |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`                            |
| `422`      | 数量不正 (delta 負 / 結果が負) / eventId が別内容で再利用 (IDEMPOTENCY_KEY_REUSED)                      | `ApiError`                            |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`                            |

### `POST /v1/stocks/{id}/discard`

在庫を廃棄 (EDITOR 以上)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

**リクエストボディ**: `StockQuantityDeltaBody`

| ステータス | 説明                                                                                                    | レスポンス                            |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `200`      | 廃棄成功                                                                                                | `{ stock: Stock, event: StockEvent }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`                            |
| `401`      | 未認証                                                                                                  | `ApiError`                            |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`                            |
| `404`      | 存在しない                                                                                              | `ApiError`                            |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`                            |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`                            |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`                            |
| `422`      | 数量不正 / eventId が別内容で再利用 (IDEMPOTENCY_KEY_REUSED)                                            | `ApiError`                            |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`                            |

### `POST /v1/stocks/{id}/move`

在庫の保管場所を移動 (EDITOR 以上)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

**リクエストボディ**: `StockMoveBody`

| ステータス | 説明                                                                                                    | レスポンス                            |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `200`      | 移動成功                                                                                                | `{ stock: Stock, event: StockEvent }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`                            |
| `401`      | 未認証                                                                                                  | `ApiError`                            |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`                            |
| `404`      | 存在しない                                                                                              | `ApiError`                            |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`                            |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`                            |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`                            |
| `422`      | toLocationId が同じ group ではない / 同 location への移動                                               | `ApiError`                            |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`                            |

## tags

### `GET /v1/tags`

group 単位で tag 一覧 (使われている item が多い順)

| パラメータ | 場所    | 必須 | 型             | 説明 |
| ---------- | ------- | ---- | -------------- | ---- |
| `groupId`  | `query` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス        |
| ---------- | ------------------------------------------------------------------------- | ----------------- |
| `200`      | 一覧                                                                      | `{ tags: Tag[] }` |
| `401`      | 未認証                                                                    | `ApiError`        |
| `403`      | 未参加                                                                    | `ApiError`        |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError`        |
| `422`      | クエリ不正                                                                | `ApiError`        |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError`        |

### `POST /v1/tags`

tag を作成 (EDITOR 以上)

**リクエストボディ**: `CreateTagBody`

| ステータス | 説明                                                                                                    | レスポンス     |
| ---------- | ------------------------------------------------------------------------------------------------------- | -------------- |
| `201`      | 作成成功                                                                                                | `{ tag: Tag }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`     |
| `401`      | 未認証                                                                                                  | `ApiError`     |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`     |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`     |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`     |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`     |
| `422`      | ボディ不正 / 同名の tag が存在する                                                                      | `ApiError`     |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`     |

### `PATCH /v1/tags/{id}`

tag を rename (EDITOR 以上)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

**リクエストボディ**: `UpdateTagBody`

| ステータス | 説明                                                                                                    | レスポンス     |
| ---------- | ------------------------------------------------------------------------------------------------------- | -------------- |
| `200`      | 更新成功                                                                                                | `{ tag: Tag }` |
| `400`      | JSON として読めないボディ                                                                               | `ApiError`     |
| `401`      | 未認証                                                                                                  | `ApiError`     |
| `403`      | 未参加 / role 不足                                                                                      | `ApiError`     |
| `404`      | 存在しない                                                                                              | `ApiError`     |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)                               | `ApiError`     |
| `413`      | ボディが上限 (1 MiB) を超過                                                                             | `ApiError`     |
| `415`      | JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり | `ApiError`     |
| `422`      | ボディ不正 / 同名の tag が存在する                                                                      | `ApiError`     |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                                                            | `ApiError`     |

### `DELETE /v1/tags/{id}`

tag を soft delete し全 item から外す (EDITOR 以上)

| パラメータ | 場所   | 必須 | 型             | 説明 |
| ---------- | ------ | ---- | -------------- | ---- |
| `id`       | `path` | yes  | `string(uuid)` | —    |

| ステータス | 説明                                                                      | レスポンス |
| ---------- | ------------------------------------------------------------------------- | ---------- |
| `204`      | 削除成功                                                                  | `—`        |
| `401`      | 未認証                                                                    | `ApiError` |
| `403`      | 未参加 / role 不足                                                        | `ApiError` |
| `404`      | 存在しない                                                                | `ApiError` |
| `409`      | 同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト) | `ApiError` |
| `422`      | パラメータ不正                                                            | `ApiError` |
| `503`      | 認証サーバ (Supabase) の署名鍵を取得できない                              | `ApiError` |

## スキーマ

### `ApiError`

| フィールド | 型                                                             | 必須 | 説明 |
| ---------- | -------------------------------------------------------------- | ---- | ---- |
| `error`    | `{ code: string, message: string, details?: unknown \| null }` | yes  | —    |

### `Category`

| フィールド  | 型                          | 必須 | 説明 |
| ----------- | --------------------------- | ---- | ---- |
| `id`        | `string(uuid)`              | yes  | —    |
| `groupId`   | `string(uuid)`              | yes  | —    |
| `name`      | `string`                    | yes  | —    |
| `sortOrder` | `integer \| null`           | yes  | —    |
| `createdAt` | `string(date-time)`         | yes  | —    |
| `updatedAt` | `string(date-time)`         | yes  | —    |
| `deletedAt` | `string(date-time) \| null` | yes  | —    |

### `CreateCategoryBody`

| フィールド  | 型                | 必須 | 説明 |
| ----------- | ----------------- | ---- | ---- |
| `groupId`   | `string(uuid)`    | yes  | —    |
| `name`      | `string`          | yes  | —    |
| `sortOrder` | `integer \| null` | no   | —    |

### `CreateGroupBody`

| フィールド | 型       | 必須 | 説明 |
| ---------- | -------- | ---- | ---- |
| `name`     | `string` | yes  | —    |

### `CreateInvitationBody`

| フィールド      | 型           | 必須 | 説明 |
| --------------- | ------------ | ---- | ---- |
| `role`          | `InviteRole` | yes  | —    |
| `expiresInDays` | `integer`    | no   | —    |

### `CreateItemBody`

| フィールド     | 型                     | 必須 | 説明 |
| -------------- | ---------------------- | ---- | ---- |
| `groupId`      | `string(uuid)`         | yes  | —    |
| `name`         | `string`               | yes  | —    |
| `categoryId`   | `string(uuid) \| null` | no   | —    |
| `defaultUnit`  | `string \| null`       | no   | —    |
| `manufacturer` | `string \| null`       | no   | —    |
| `memo`         | `string \| null`       | no   | —    |
| `barcode`      | `string \| null`       | no   | —    |

### `CreateLocationBody`

| フィールド  | 型                | 必須 | 説明 |
| ----------- | ----------------- | ---- | ---- |
| `groupId`   | `string(uuid)`    | yes  | —    |
| `name`      | `string`          | yes  | —    |
| `sortOrder` | `integer \| null` | no   | —    |

### `CreateStockBody`

| フィールド       | 型                     | 必須 | 説明 |
| ---------------- | ---------------------- | ---- | ---- |
| `groupId`        | `string(uuid)`         | yes  | —    |
| `itemId`         | `string(uuid)`         | yes  | —    |
| `locationId`     | `string(uuid)`         | yes  | —    |
| `quantity`       | `number`               | yes  | —    |
| `unit`           | `string`               | yes  | —    |
| `useByDate`      | `string(date) \| null` | yes  | —    |
| `bestBeforeDate` | `string(date) \| null` | yes  | —    |
| `openedAt`       | `string(date) \| null` | yes  | —    |
| `note`           | `string \| null`       | yes  | —    |

### `CreateTagBody`

| フィールド | 型             | 必須 | 説明 |
| ---------- | -------------- | ---- | ---- |
| `groupId`  | `string(uuid)` | yes  | —    |
| `name`     | `string`       | yes  | —    |

### `Group`

| フィールド  | 型                          | 必須 | 説明 |
| ----------- | --------------------------- | ---- | ---- |
| `id`        | `string(uuid)`              | yes  | —    |
| `name`      | `string`                    | yes  | —    |
| `createdBy` | `string(uuid)`              | yes  | —    |
| `createdAt` | `string(date-time)`         | yes  | —    |
| `updatedAt` | `string(date-time)`         | yes  | —    |
| `deletedAt` | `string(date-time) \| null` | yes  | —    |

### `Invitation`

| フィールド  | 型                          | 必須 | 説明 |
| ----------- | --------------------------- | ---- | ---- |
| `id`        | `string(uuid)`              | yes  | —    |
| `groupId`   | `string(uuid)`              | yes  | —    |
| `inviterId` | `string(uuid)`              | yes  | —    |
| `role`      | `Role`                      | yes  | —    |
| `token`     | `string`                    | yes  | —    |
| `expiresAt` | `string(date-time)`         | yes  | —    |
| `usedAt`    | `string(date-time) \| null` | yes  | —    |
| `usedBy`    | `string(uuid) \| null`      | yes  | —    |
| `createdAt` | `string(date-time)`         | yes  | —    |
| `updatedAt` | `string(date-time)`         | yes  | —    |
| `deletedAt` | `string(date-time) \| null` | yes  | —    |

### `InviteRole`

`enum("EDITOR", "VIEWER")`

### `Item`

| フィールド        | 型                          | 必須 | 説明 |
| ----------------- | --------------------------- | ---- | ---- |
| `id`              | `string(uuid)`              | yes  | —    |
| `groupId`         | `string(uuid)`              | yes  | —    |
| `productMasterId` | `string(uuid) \| null`      | yes  | —    |
| `name`            | `string`                    | yes  | —    |
| `barcode`         | `string \| null`            | yes  | —    |
| `categoryId`      | `string(uuid) \| null`      | yes  | —    |
| `tagIds`          | `Array<string(uuid)>`       | yes  | —    |
| `defaultUnit`     | `string \| null`            | yes  | —    |
| `manufacturer`    | `string \| null`            | yes  | —    |
| `memo`            | `string \| null`            | yes  | —    |
| `createdAt`       | `string(date-time)`         | yes  | —    |
| `updatedAt`       | `string(date-time)`         | yes  | —    |
| `deletedAt`       | `string(date-time) \| null` | yes  | —    |

### `ItemByBarcodeBody`

| フィールド | 型             | 必須 | 説明 |
| ---------- | -------------- | ---- | ---- |
| `groupId`  | `string(uuid)` | yes  | —    |
| `barcode`  | `string`       | yes  | —    |

### `ItemByBarcodeResponse`

| フィールド      | 型                                | 必須 | 説明 |
| --------------- | --------------------------------- | ---- | ---- |
| `item`          | `Item`                            | yes  | —    |
| `productMaster` | `ProductMaster`                   | yes  | —    |
| `productLookup` | `enum("existing", "hit", "miss")` | yes  | —    |

### `Location`

| フィールド  | 型                          | 必須 | 説明 |
| ----------- | --------------------------- | ---- | ---- |
| `id`        | `string(uuid)`              | yes  | —    |
| `groupId`   | `string(uuid)`              | yes  | —    |
| `name`      | `string`                    | yes  | —    |
| `sortOrder` | `integer \| null`           | yes  | —    |
| `createdAt` | `string(date-time)`         | yes  | —    |
| `updatedAt` | `string(date-time)`         | yes  | —    |
| `deletedAt` | `string(date-time) \| null` | yes  | —    |

### `Membership`

| フィールド  | 型                          | 必須 | 説明 |
| ----------- | --------------------------- | ---- | ---- |
| `id`        | `string(uuid)`              | yes  | —    |
| `userId`    | `string(uuid)`              | yes  | —    |
| `groupId`   | `string(uuid)`              | yes  | —    |
| `role`      | `Role`                      | yes  | —    |
| `joinedAt`  | `string(date-time)`         | yes  | —    |
| `createdAt` | `string(date-time)`         | yes  | —    |
| `updatedAt` | `string(date-time)`         | yes  | —    |
| `deletedAt` | `string(date-time) \| null` | yes  | —    |

### `ProductMaster`

| フィールド      | 型                                                                                 | 必須 | 説明 |
| --------------- | ---------------------------------------------------------------------------------- | ---- | ---- |
| `id`            | `string(uuid)`                                                                     | yes  | —    |
| `jan`           | `string`                                                                           | yes  | —    |
| `name`          | `string`                                                                           | yes  | —    |
| `manufacturer`  | `string \| null`                                                                   | yes  | —    |
| `brand`         | `string \| null`                                                                   | yes  | —    |
| `contentAmount` | `number \| null`                                                                   | yes  | —    |
| `contentUnit`   | `string \| null`                                                                   | yes  | —    |
| `categoryHint`  | `string \| null`                                                                   | yes  | —    |
| `imageUrl`      | `string \| null`                                                                   | yes  | —    |
| `source`        | `enum("YAHOO_SHOPPING", "RAKUTEN_ICHIBA", "JANCODE_LOOKUP", "GS1_JICFS", "OTHER")` | yes  | —    |
| `confidence`    | `enum("HIGH", "MEDIUM", "LOW", null) \| null`                                      | yes  | —    |
| `fetchedAt`     | `string(date-time)`                                                                | yes  | —    |
| `createdAt`     | `string(date-time)`                                                                | yes  | —    |
| `updatedAt`     | `string(date-time)`                                                                | yes  | —    |
| `deletedAt`     | `string(date-time) \| null`                                                        | yes  | —    |

### `PutItemTagsBody`

| フィールド | 型                    | 必須 | 説明 |
| ---------- | --------------------- | ---- | ---- |
| `tagIds`   | `Array<string(uuid)>` | yes  | —    |

### `Role`

`enum("OWNER", "EDITOR", "VIEWER")`

### `Stock`

| フィールド       | 型                          | 必須 | 説明 |
| ---------------- | --------------------------- | ---- | ---- |
| `id`             | `string(uuid)`              | yes  | —    |
| `groupId`        | `string(uuid)`              | yes  | —    |
| `itemId`         | `string(uuid)`              | yes  | —    |
| `locationId`     | `string(uuid)`              | yes  | —    |
| `quantity`       | `number`                    | yes  | —    |
| `unit`           | `string`                    | yes  | —    |
| `useByDate`      | `string(date) \| null`      | yes  | —    |
| `bestBeforeDate` | `string(date) \| null`      | yes  | —    |
| `openedAt`       | `string(date) \| null`      | yes  | —    |
| `note`           | `string \| null`            | yes  | —    |
| `createdAt`      | `string(date-time)`         | yes  | —    |
| `updatedAt`      | `string(date-time)`         | yes  | —    |
| `deletedAt`      | `string(date-time) \| null` | yes  | —    |

### `StockEvent`

| フィールド       | 型                                                  | 必須 | 説明 |
| ---------------- | --------------------------------------------------- | ---- | ---- |
| `id`             | `string(uuid)`                                      | yes  | —    |
| `groupId`        | `string(uuid)`                                      | yes  | —    |
| `stockId`        | `string(uuid)`                                      | yes  | —    |
| `eventType`      | `enum("ADD", "CONSUME", "DISCARD", "MOVE", "EDIT")` | yes  | —    |
| `quantityDelta`  | `number`                                            | yes  | —    |
| `fromLocationId` | `string(uuid) \| null`                              | yes  | —    |
| `toLocationId`   | `string(uuid) \| null`                              | yes  | —    |
| `occurredAt`     | `string(date-time)`                                 | yes  | —    |
| `actorUserId`    | `string(uuid) \| null`                              | yes  | —    |
| `reason`         | `string \| null`                                    | yes  | —    |
| `createdAt`      | `string(date-time)`                                 | yes  | —    |

### `StockMoveBody`

| フィールド     | 型               | 必須 | 説明 |
| -------------- | ---------------- | ---- | ---- |
| `toLocationId` | `string(uuid)`   | yes  | —    |
| `reason`       | `string \| null` | no   | —    |

### `StockQuantityDeltaBody`

| フィールド      | 型               | 必須 | 説明 |
| --------------- | ---------------- | ---- | ---- |
| `quantityDelta` | `number`         | yes  | —    |
| `reason`        | `string \| null` | no   | —    |
| `eventId`       | `string(uuid)`   | no   | —    |

### `Tag`

| フィールド  | 型                          | 必須 | 説明 |
| ----------- | --------------------------- | ---- | ---- |
| `id`        | `string(uuid)`              | yes  | —    |
| `groupId`   | `string(uuid)`              | yes  | —    |
| `name`      | `string`                    | yes  | —    |
| `itemCount` | `integer`                   | yes  | —    |
| `createdAt` | `string(date-time)`         | yes  | —    |
| `updatedAt` | `string(date-time)`         | yes  | —    |
| `deletedAt` | `string(date-time) \| null` | yes  | —    |

### `UpdateCategoryBody`

`minProperties: 1`

| フィールド  | 型                | 必須 | 説明 |
| ----------- | ----------------- | ---- | ---- |
| `name`      | `string`          | no   | —    |
| `sortOrder` | `integer \| null` | no   | —    |

### `UpdateGroupBody`

| フィールド | 型       | 必須 | 説明 |
| ---------- | -------- | ---- | ---- |
| `name`     | `string` | yes  | —    |

### `UpdateItemBody`

`minProperties: 1`

| フィールド     | 型                     | 必須 | 説明 |
| -------------- | ---------------------- | ---- | ---- |
| `name`         | `string`               | no   | —    |
| `categoryId`   | `string(uuid) \| null` | no   | —    |
| `defaultUnit`  | `string \| null`       | no   | —    |
| `manufacturer` | `string \| null`       | no   | —    |
| `memo`         | `string \| null`       | no   | —    |
| `barcode`      | `string \| null`       | no   | —    |

### `UpdateLocationBody`

`minProperties: 1`

| フィールド  | 型                | 必須 | 説明 |
| ----------- | ----------------- | ---- | ---- |
| `name`      | `string`          | no   | —    |
| `sortOrder` | `integer \| null` | no   | —    |

### `UpdateMembershipRoleBody`

| フィールド | 型     | 必須 | 説明 |
| ---------- | ------ | ---- | ---- |
| `role`     | `Role` | yes  | —    |

### `UpdateStockBody`

`additionalProperties: false`, `minProperties: 1`

| フィールド       | 型                     | 必須 | 説明 |
| ---------------- | ---------------------- | ---- | ---- |
| `locationId`     | `string(uuid)`         | no   | —    |
| `unit`           | `string`               | no   | —    |
| `useByDate`      | `string(date) \| null` | no   | —    |
| `bestBeforeDate` | `string(date) \| null` | no   | —    |
| `openedAt`       | `string(date) \| null` | no   | —    |
| `note`           | `string \| null`       | no   | —    |

### `UpdateTagBody`

| フィールド | 型       | 必須 | 説明 |
| ---------- | -------- | ---- | ---- |
| `name`     | `string` | yes  | —    |
