import {
  categories,
  groups,
  itemTags,
  items,
  locations,
  memberships,
  stocks,
  tags,
  users,
} from "@prep-hamster/db"
import { normalizeTagName } from "@prep-hamster/schema"
import { testDb } from "./setup"

export type SeedFixture = {
  userId: string
  groupId: string
  itemId: string
  locationId: string
}

export async function seedUser(
  displayName = "E2E User",
  id = crypto.randomUUID(),
): Promise<string> {
  await testDb.insert(users).values({
    id,
    email: `e2e-${id}@example.test`,
    displayName,
    locale: "ja-JP",
  })
  return id
}

export async function seedGroupWithMembership(
  ownerUserId: string,
  name = "E2E Group",
  id = crypto.randomUUID(),
): Promise<string> {
  await testDb.insert(groups).values({
    id,
    name,
    createdBy: ownerUserId,
  })
  await testDb.insert(memberships).values({
    id: crypto.randomUUID(),
    userId: ownerUserId,
    groupId: id,
    role: "OWNER",
    joinedAt: new Date(),
  })
  return id
}

export async function seedMembership(
  userId: string,
  groupId: string,
  role: "OWNER" | "EDITOR" | "VIEWER",
): Promise<string> {
  const id = crypto.randomUUID()
  await testDb.insert(memberships).values({
    id,
    userId,
    groupId,
    role,
    joinedAt: new Date(),
  })
  return id
}

export async function seedLocation(
  groupId: string,
  name = "Pantry",
  sortOrder: number | null = null,
): Promise<string> {
  const id = crypto.randomUUID()
  await testDb.insert(locations).values({ id, groupId, name, sortOrder })
  return id
}

export async function seedCategory(
  groupId: string,
  name = "Food",
  sortOrder: number | null = null,
): Promise<string> {
  const id = crypto.randomUUID()
  await testDb.insert(categories).values({ id, groupId, name, sortOrder })
  return id
}

export async function seedTag(groupId: string, name: string): Promise<string> {
  const id = crypto.randomUUID()
  await testDb.insert(tags).values({ id, groupId, name, normalizedName: normalizeTagName(name) })
  return id
}

export async function attachTags(itemId: string, tagIds: string[]): Promise<void> {
  if (tagIds.length === 0) return
  await testDb.insert(itemTags).values(tagIds.map((tagId) => ({ itemId, tagId })))
}

export async function seedItem(
  groupId: string,
  name = "Canned Tomato",
  categoryId: string | null = null,
): Promise<string> {
  const id = crypto.randomUUID()
  await testDb.insert(items).values({ id, groupId, name, categoryId })
  return id
}

export async function seedStock(
  groupId: string,
  itemId: string,
  locationId: string,
  quantity = 1,
  dates: { useByDate?: string | null; bestBeforeDate?: string | null } = {},
): Promise<string> {
  const id = crypto.randomUUID()
  await testDb.insert(stocks).values({
    id,
    groupId,
    itemId,
    locationId,
    quantity,
    unit: "個",
    useByDate: dates.useByDate ?? null,
    bestBeforeDate: dates.bestBeforeDate ?? null,
    openedAt: null,
    note: null,
  })
  return id
}

export async function seedBaseFixture(): Promise<SeedFixture> {
  const userId = crypto.randomUUID()
  const groupId = crypto.randomUUID()
  const itemId = crypto.randomUUID()
  const locationId = crypto.randomUUID()

  await testDb.insert(users).values({
    id: userId,
    email: `e2e-${userId}@example.test`,
    displayName: "E2E User",
    locale: "ja-JP",
  })

  await testDb.insert(groups).values({
    id: groupId,
    name: "E2E Group",
    createdBy: userId,
  })

  await testDb.insert(memberships).values({
    id: crypto.randomUUID(),
    userId,
    groupId,
    role: "OWNER",
    joinedAt: new Date(),
  })

  await testDb.insert(locations).values({
    id: locationId,
    groupId,
    name: "Pantry",
  })

  await testDb.insert(items).values({
    id: itemId,
    groupId,
    name: "Canned Tomato",
  })

  return { userId, groupId, itemId, locationId }
}
