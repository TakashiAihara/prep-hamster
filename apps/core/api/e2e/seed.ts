import { groups, items, locations, memberships, users } from "@prep-hamster/db"
import { testDb } from "./setup"

export type SeedFixture = {
  userId: string
  groupId: string
  itemId: string
  locationId: string
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
