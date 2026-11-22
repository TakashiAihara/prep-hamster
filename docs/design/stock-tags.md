# Tags as a second axis to categories (#210)

Status: proposal. Names of tables, columns, routes, request keys and error codes below are proposals; each is listed under "Open decisions" and none is final.

## To-Be

- A user can attach several tags to a product (item) in addition to its one category
- Tags are shared inside a group: a tag created once can be applied to any other item of the same group
- Operations the user performs:
  1. Open a stock detail, tap the tag row of the item, type a tag name and confirm. If the name already exists the existing tag is reused, otherwise a new tag is created and applied
  2. Tap an applied tag to remove it from the item
  3. On the stock list, choose a tag in the filter row. The list shows only the stocks whose item carries that tag
  4. Open the tag manager (reached from the groups modal, next to the location manager) to see all tags ordered by how many items use them, most used first
  5. Delete a tag in the tag manager. A confirmation dialog states how many items lose the tag. After confirming, the tag disappears from every item
- What the user sees:
  - Tag chips on the stock detail and on stock list rows
  - The tag filter row above the stock list
  - A usage count next to each tag in the tag manager
- Not in scope: tag colors, tag hierarchy, tag-based notification rules, per-stock tags (see decision on the attach target)

## Why a second axis

- The old requirement (preppin requirement 6, copied into #210) asks for several tags per product, search by tag, tag creation reusable by other products, delete with confirmation that also detaches, and usage-frequency ordering
- A category is a single nullable `items.category_id`. It cannot express "water" and "for the baby" and "rolling stock" at once
- Finding on the current code: the mobile app has no category UI at all (no mention of category under `apps/user/client/mobile`). The API supports `categoryId` on items and a `categoryId` stock filter, but the user cannot set or filter by it. The tag filter row proposed here is the first filter row on the stock list, so it should be built so that the category filter can reuse it later

## Data model changes

Proposed (names pending, see decisions):

| Table     | Columns                                                                                                                    | Notes                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| tags      | id uuid pk, group_id uuid fk groups, name text not null, normalized_name text not null, created_at, updated_at, deleted_at | the common `timestamps` helper; `name` is kept as typed, `normalized_name` is computed by the API (see below) and carries the unique index |
| item_tags | item_id uuid fk items, tag_id uuid fk tags, created_at                                                                     | primary key (item_id, tag_id); no deleted_at                                                                                               |

- `tags.normalized_name` is a plain `text not null` column that the API computes (one shared helper used by POST, PATCH rename, and the client's find-or-create match). It is not a generated column: Postgres has no NFKC normalization, `lower()` is not Unicode case folding, and a generated column needs an `IMMUTABLE` expression, so the normalization has to live in application code
- Unique index on tags `(group_id, normalized_name)` where `deleted_at IS NULL`. Same shape as `items_group_barcode_idx`, which is a partial unique index. The index enforces whatever the helper produced, so every write path must go through the helper (a test pins POST and PATCH producing the same value for the same input)
- `item_tags` rows are physically deleted. The join row has no history value, and a soft-deleted join row would make "tag removed" and "tag never applied" indistinguishable for no benefit
- A tag is soft-deleted (consistent with locations and categories and with the 90 day policy in `docs/stock/operational-policy.md` section 1.1), and its `item_tags` rows are deleted in the same transaction
- No stored usage counter. Usage frequency is computed on read with a join and `count(*)`. A counter would be a second source of truth that drifts under concurrent attach and detach
- `itemCount` and the "N items lose the tag" number in the delete dialog count only active items: the query joins `items` with `items.deleted_at IS NULL`. Item soft delete also deletes that item's `item_tags` rows in the same transaction (a change to the item delete route), so dead items do not hold tags. The `tagId` filters on `/stocks` and `/items` rely on the existing `deleted_at IS NULL` filters of those routes plus the same join; a test pins both
- `item_tags` has no `group_id`. Group consistency (item and tag in the same group) is checked in the API like `CATEGORY_GROUP_MISMATCH` does today
- Drizzle: add `tags`, `itemTags`, relations on `items` (`tags: many(itemTags)`) and `groups`; add zod schemas in `packages/db/src/zod-schemas.ts` following the existing refine pattern (uuid columns use `guid()` per the zod 4 pitfall memory)

## API changes

Proposed routes (names pending). All under `/v1`, group access checked with `checkGroupAccess` (VIEWER for reads, EDITOR for writes), errors in the existing `{ error: { code, message } }` shape.

| Method and path        | Purpose                                                                  | Success               |
| ---------------------- | ------------------------------------------------------------------------ | --------------------- |
| GET `/tags?groupId=`   | list active tags with `itemCount`, ordered by `itemCount` desc then name | 200 `{ tags: [...] }` |
| POST `/tags`           | create `{ groupId, name }`                                               | 201 `{ tag }`         |
| PATCH `/tags/{id}`     | rename `{ name }`                                                        | 200 `{ tag }`         |
| DELETE `/tags/{id}`    | soft delete and detach                                                   | 204                   |
| PUT `/items/{id}/tags` | replace the item's tag set with `{ tagIds: [...] }`                      | 200 `{ item, tags }`  |
| GET `/stocks?tagId=`   | additional filter, via items like `categoryId`                           | 200                   |
| GET `/items?tagId=`    | same for items                                                           | 200                   |

- PUT with a full set (not add and remove endpoints) keeps the mobile call to one request and makes retries idempotent
- `tagIds` is a set: the API removes duplicate ids before anything else, so `[a, a]` is the same request as `[a]` (inserting both would violate the primary key of `item_tags`). The zod schema bounds the array only by a sanity limit (proposal: 100 ids) and does not carry the per-item cap, because a cap in the schema would turn every over-cap request into VALIDATION_ERROR and leave TAG_LIMIT_EXCEEDED unreachable. The cap is checked after deduplication, inside the transaction
- `itemDtoSchema` gains `tagIds: string[]` so that the list screens do not need one request per item. `GET /items` already returns every item of a group, so the join is one extra query
- Errors, following the 422 convention (validation and business-rule failures are 422, see `project_v1_1_0_decisions`):

| Status | Code (proposed)    | When                                                                                                                                                                                                                                                                                          |
| ------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 404    | NOT_FOUND          | the item (PUT) or the tag (PATCH, DELETE) named in the URL is missing or soft deleted                                                                                                                                                                                                         |
| 422    | VALIDATION_ERROR   | body fails the zod schema (name empty or over the length cap, more tag ids than the sanity bound, non-guid id)                                                                                                                                                                                |
| 422    | TAG_NAME_DUPLICATE | another active tag in the group has the same normalized name (mirrors `ITEM_BARCODE_DUPLICATE`, raised from the unique violation)                                                                                                                                                             |
| 422    | TAG_GROUP_MISMATCH | a tag id in the request body is missing, deleted, or belongs to another group: one code and one message for all three, so the answer does not reveal whether a UUID exists in another group (mirrors `CATEGORY_GROUP_MISMATCH`). A tag deleted concurrently with the PUT gets the same answer |
| 422    | TAG_LIMIT_EXCEEDED | the resulting set would exceed the per-item cap                                                                                                                                                                                                                                               |

- POST `/tags` is find-or-create from the user's point of view in the mobile flow: the client first matches the typed name against the loaded tag list, and only calls POST when there is no match. A race that creates the same name twice is resolved by the unique index (the loser gets 422 TAG_NAME_DUPLICATE and re-reads the list)

## Mobile screens touched

- `app/stocks/[id].tsx`: tag row under the item name, add and remove. Logic in a new pure module (`src/tag-manage.ts`) tested without rendering, same split as `location-manage.ts`
- `app/(tabs)/index.tsx` (stock list): tag filter row; `use-stocks` passes `tagId`
- New `app/tags.tsx` modal reached from `app/groups.tsx`, same entry pattern as `app/locations.tsx` (#171)
- Tag name input follows `parseReason`-style trimming; empty after trim cannot be saved

## Migration and RLS

- One new drizzle migration creates both tables and runs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for each in the same migration. Migration 0003 enabled RLS with a loop over the tables that existed at that time, so tables added later get nothing automatically
- No policies are created. The API connects as the table owner and is not subject to RLS; anon and authenticated stay locked out. Grants are already revoked by 0003 default privileges for the migration role
- The existing e2e check in `apps/core/api/e2e/validation.test.ts` ("every public table has RLS") fails if either table is missed. It proves the flag is set, not that access is denied, so a separate denial test is added (see Tests)
- Existing data: no backfill, tags start empty

## Concurrency

Follows the pattern of #192 and PR #219 (rows are locked inside the transaction and the decision is made on the locked values; lock order is fixed to avoid deadlock).

- Lock order shared by the four designs (item, stock, location, photo and tag rows): item rows (ascending id), then stock rows, then location rows, then photo rows, then tag rows (ascending id). A transaction takes only the kinds it needs, in this order, and never returns to an earlier kind. Several rows of one kind are locked with one `SELECT ... FOR ...` statement per row after sorting the ids in application code. The one exception is a single `UPDATE` that touches many rows of one kind (merge's repoint of stocks and of photos). It is safe because no other transaction locks more than one row of that kind at a time (consume, discard, move, split and photo delete each lock one row), and two merges that could touch the same rows are serialized by the item locks. Writing to an item row that the transaction already holds the lock on is not a new lock.
- Acquiring several rows in id order is done with one `SELECT ... FOR ...` statement per row, after sorting the ids in application code. The Postgres documentation (SELECT, "The Locking Clause", Caution) says that with `ORDER BY` and a locking clause "ORDER BY is applied first" and the command "might then block trying to obtain a lock on one or more of the rows", and it does not state the order in which rows are locked. Sorting in the application and locking one row per statement does not depend on that unstated behavior, and the cost is at most tens of statements (bounded by the caps)
- PUT `/items/{id}/tags`: one transaction. Lock the item row with `FOR NO KEY UPDATE`; 0 rows (deleted meanwhile) means 404. Lock each requested tag row `FOR SHARE` in ascending id order and re-check `deleted_at IS NULL` and group; delete the item's current `item_tags`, insert the deduplicated set. The cap is counted on the locked item, so two concurrent PUTs for one item serialize
- DELETE `/tags/{id}`: lock the tag row `FOR NO KEY UPDATE`, soft delete, delete its `item_tags`. `FOR SHARE` from a concurrent PUT conflicts with this lock (Postgres, Explicit Locking, Table 13.3: FOR SHARE conflicts with FOR NO KEY UPDATE), so a PUT either finishes first (its rows are then deleted by the tag delete) or sees the tag as deleted and returns 422 TAG_GROUP_MISMATCH. No cycle: tag delete takes no item lock
- PATCH `/tags/{id}` (rename): one transaction. Lock the tag row `FOR NO KEY UPDATE`; no row or `deleted_at` set means 404. Compute `normalized_name` with the shared helper and update `name`, `normalized_name` and `updated_at`; a unique violation on the partial index is 422 TAG_NAME_DUPLICATE. It serializes with DELETE on the tag row (the loser sees the tag as deleted and answers 404) and two renames of one tag apply one after the other, last write wins
- Item merge (#212) also writes `item_tags`; it follows the same order (items, then tags `FOR SHARE`) and skips deleted tags, so a tag delete cannot leave an `item_tags` row for a deleted tag (see `item-merge.md`)
- Every reader of `item_tags` joins `tags.deleted_at IS NULL` as a second line of defense, so a stray row for a deleted tag would not be counted or shown
- Create duplicates are decided by the unique index, not by a read-then-insert (the exact race class that #220 reports for location delete)

## Tests

- API e2e (`apps/core/api/e2e/tags.test.ts`, concurrency in a `tags-concurrency.test.ts` using `lock-helper.ts`):
  1. create, rename, duplicate name 422, cross-group tag 422; POST and PATCH produce the same normalized name for the same input
  2. list ordered by usage: fixtures give four tags counts 3, 1, 1 and 0 with names in the opposite alphabetical order of the counts, so a missing `ORDER BY count DESC` fails and the two tags tied at 1 are listed in name order, so a missing secondary sort fails; `itemCount` excludes soft-deleted items
  3. PUT replaces the set; a second PUT with fewer tags removes the others; `[a, a]` equals `[a]`; over the cap returns 422 with code TAG_LIMIT_EXCEEDED (the test asserts the code, not only the status, so a schema-level VALIDATION_ERROR does not satisfy it)
  4. delete detaches from every item and the filters no longer return them; item soft delete removes its `item_tags`
  5. race: PUT against tag delete (no `item_tags` row for a deleted tag remains); two PUTs against one item at the cap; rename against delete (the rename answers 404 or the tag is renamed and then deleted, never a revived tag); two renames to the same name (one succeeds, one 422 TAG_NAME_DUPLICATE); a PUT whose body names a deleted tag, a foreign-group tag and a nonexistent tag gets byte-identical 422 bodies
  6. stock and item list filter by `tagId`
- RLS: the existing every-table-has-RLS check covers the new tables. A denial test connects as the `anon` and `authenticated` roles and expects `permission denied` on each new table. It needs a database that has those roles (the local Supabase DB does; plain Postgres does not). When the roles are missing the test reports an explicit skip, never a silent pass
- Unit (`bun test src`): `tag-manage.ts` name matching and trimming, usage ordering of the list
- Maestro: `tag-attach-filter.yaml` (add a tag on the stock detail, go back, filter the list by it, see the row; remove the tag)
- Negative control on each new branch (duplicate, group mismatch, cap) before review, as for other API changes

## Dependencies

- #212 (merge items): merged items must union their tags; overlapping tags are deduplicated (insert with conflict ignore), and the per-item cap applies to the union (see D-merge-caps in `item-merge.md`)
- No dependency on #186 (quantities)

## Open decisions

### D-tag-target. Which row carries the tags

- Question: do tags attach to the item (product) or to the individual stock (lot)?
- Options:
  1. Item. Same level as `category_id`, so the tag is a true second axis. A new purchase of the same item is already tagged. Split (#211) and merge (#212) need no tag handling for stocks
  2. Stock. Matches the issue title "tags on stocks". Tags like "opened" or "for the trip" are lot-level. Every purchase and every split needs retagging
- Recommendation: item
- Reason: the issue body says "second axis to categories" and the old requirement says "tag a product". Categories live on items. Lot-level state is better served by existing fields (`opened_at`, `note`). The issue title wording differs, so this needs the user's confirmation

### D-tag-scope. Whether to build tags before the category UI

- Question: should tags be built now even though the mobile app has no category UI?
- Options:
  1. Build tags now (and the filter row), category UI later reuses the row
  2. Build the category UI first and see whether categories alone suffice, as the issue asks ("decide whether categories are enough")
- Recommendation: build tags now
- Reason: the issue question cannot be answered from use, because categories are not usable in the app today; a single-valued axis is known to be insufficient for the old requirement 1

### D-tag-table-names. Table names

- Question: what are the table names?
- Options: `tags` and `item_tags`; `labels` and `item_labels`; `item_tag_assignments`
- Recommendation: `tags` and `item_tags`
- Reason: the requirement and the issue use the word tag, and the join name states what it joins

### D-tag-route-names. Route and field names

- Question: what are the route paths and the request and response keys?
- Options: `/tags` with `PUT /items/{id}/tags` and `tagIds`; `/tags` with add and remove sub-routes (`POST` and `DELETE /items/{id}/tags/{tagId}`)
- Recommendation: the first (full-set replace, key `tagIds`)
- Reason: idempotent retries and one request from mobile

### D-tag-error-codes. Error code names

- Question: what are the new error codes?
- Options: `TAG_NAME_DUPLICATE`, `TAG_GROUP_MISMATCH`, `TAG_LIMIT_EXCEEDED`; or reuse `ITEM_BARCODE_DUPLICATE`-style naming with a `_CONFLICT` suffix
- Recommendation: the first set
- Reason: it mirrors the existing `ITEM_BARCODE_DUPLICATE` and `CATEGORY_GROUP_MISMATCH`

### D-tag-uniqueness. What counts as the same tag name

- Question: how are tag names compared for uniqueness?
- Options: exact string; trimmed and case-insensitive; trimmed, NFKC-normalized and lower-cased in application code (stored in a plain `normalized_name` column, name kept as typed)
- Recommendation: trimmed, NFKC-normalized, lower-cased in application code
- Reason: Japanese input mixes full-width and half-width forms, so "ＰＥＴ" and "pet" would otherwise be two tags. Full Unicode case folding is not required for a household tag list; Postgres cannot do NFKC, so the helper lives in the API (changed from the first revision, which proposed a generated column)

### D-tag-delete. Delete semantics

- Question: how is a tag deleted?
- Options: soft-delete the tag and physically delete its `item_tags` rows; physically delete both; soft-delete the tag and keep `item_tags` rows hidden by the join
- Recommendation: soft-delete the tag, physically delete the join rows
- Reason: consistent with the 90 day policy for entities, and a restored tag (future trash UI) starts empty, matching "also removes the tag from related products"

### D-tag-filter. Match rule for several selected tags

- Question: when the user selects several tags in the filter, does a stock need any of them or all of them?
- Options: any (OR); all (AND); both with a switch
- Recommendation: any (OR), single-select in the first version
- Reason: single select satisfies the old requirement 2 and avoids a UI switch; multi-select can be added without an API break if `tagId` becomes repeatable

### D-tag-caps. Length and count caps

- Question: what are the caps for tag name length and tags per item?
- Options: 50 characters and 20 tags; 100 characters (same as location and category names) and 10 tags; no tag cap
- Recommendation: 50 characters and 20 tags
- Reason: tags are chip labels; location and category names allow 100 but are single labels, and a cap keeps `tagIds` in `itemDtoSchema` small

### D-tag-order. Usage-frequency computation

- Question: is usage frequency computed on read or stored?
- Options: computed with a join on each list; stored counter column on `tags`
- Recommendation: computed on read
- Reason: a counter drifts under concurrent PUT and delete; a group has tens of tags, not thousands
