import { test, expect } from "bun:test"
import {
  UserSchema,
  GroupSchema,
  StockSchema,
  StockEventSchema,
  ProductMasterSchema,
  RoleSchema,
} from "../index"

const NOW = "2026-05-03T00:00:00Z"
const UUID = "00000000-0000-0000-0000-000000000000"

test("UserSchema accepts a valid user", () => {
  expect(
    UserSchema.safeParse({
      id: UUID,
      email: "user@example.com",
      displayName: "Test",
      avatarUrl: null,
      locale: "ja-JP",
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    }).success,
  ).toBe(true)
})

test("UserSchema rejects an invalid email", () => {
  expect(
    UserSchema.safeParse({
      id: UUID,
      email: "not-an-email",
      displayName: "Test",
      avatarUrl: null,
      locale: "ja-JP",
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    }).success,
  ).toBe(false)
})

test("GroupSchema accepts a valid group", () => {
  expect(
    GroupSchema.safeParse({
      id: UUID,
      name: "自宅",
      createdBy: UUID,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    }).success,
  ).toBe(true)
})

test("StockSchema accepts a stock with both expiry dates null", () => {
  expect(
    StockSchema.safeParse({
      id: UUID,
      groupId: UUID,
      itemId: UUID,
      locationId: UUID,
      quantity: 3,
      unit: "個",
      useByDate: null,
      bestBeforeDate: null,
      openedAt: null,
      note: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    }).success,
  ).toBe(true)
})

test("StockSchema rejects negative quantity", () => {
  expect(
    StockSchema.safeParse({
      id: UUID,
      groupId: UUID,
      itemId: UUID,
      locationId: UUID,
      quantity: -1,
      unit: "個",
      useByDate: null,
      bestBeforeDate: null,
      openedAt: null,
      note: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    }).success,
  ).toBe(false)
})

test("StockEventSchema accepts an ADD event with positive delta", () => {
  expect(
    StockEventSchema.safeParse({
      id: UUID,
      groupId: UUID,
      stockId: UUID,
      eventType: "ADD",
      quantityDelta: 5,
      fromLocationId: null,
      toLocationId: null,
      occurredAt: NOW,
      actorUserId: UUID,
      reason: null,
      createdAt: NOW,
    }).success,
  ).toBe(true)
})

test("ProductMasterSchema accepts a Yahoo-sourced record", () => {
  expect(
    ProductMasterSchema.safeParse({
      id: UUID,
      jan: "4901234567890",
      name: "コカ・コーラ ペットボトル 500ml",
      manufacturer: "コカ・コーラ ボトラーズジャパン",
      brand: "コカ・コーラ",
      contentAmount: 500,
      contentUnit: "ml",
      categoryHint: "飲料/炭酸",
      imageUrl: "https://example.com/img.jpg",
      source: "YAHOO_SHOPPING",
      sourceRaw: { hits: [{ name: "コカ・コーラ" }] },
      fetchedAt: NOW,
      confidence: "HIGH",
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    }).success,
  ).toBe(true)
})

test("RoleSchema accepts only OWNER / EDITOR / VIEWER", () => {
  expect(RoleSchema.safeParse("OWNER").success).toBe(true)
  expect(RoleSchema.safeParse("EDITOR").success).toBe(true)
  expect(RoleSchema.safeParse("VIEWER").success).toBe(true)
  expect(RoleSchema.safeParse("ADMIN").success).toBe(false)
})
