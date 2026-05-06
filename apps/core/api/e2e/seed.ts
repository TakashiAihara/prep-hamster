import { groups, items, locations, memberships, users } from "@prep-hamster/db"
import { testDb } from "./setup"

export type SeedFixture = {
  userId: string
  groupId: string
  itemId: string
  locationId: string
}

export async function seedUser(displayName = "E2E User"): Promise<string> {
  const userId = crypto.randomUUID()
  await testDb.insert(users).values({
    id: userId,
    email: `e2e-${userId}@example.test`,
    displayName,
    locale: "ja-JP",
  })
  return userId
}

export async function seedGroupWithMembership(
  ownerUserId: string,
  name = "E2E Group",
): Promise<string> {
  const groupId = crypto.randomUUID()
  await testDb.insert(groups).values({
    id: groupId,
    name,
    createdBy: ownerUserId,
  })
  await testDb.insert(memberships).values({
    id: crypto.randomUUID(),
    userId: ownerUserId,
    groupId,
    role: "OWNER",
    joinedAt: new Date(),
  })
  return groupId
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
