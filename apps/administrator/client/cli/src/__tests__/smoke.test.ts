import { test, expect } from "bun:test"
import { main } from "../main"

test("admin main command has expected metadata", async () => {
  const meta = await (typeof main.meta === "function" ? main.meta() : main.meta)
  expect(meta?.name).toBe("prep-hamster-admin")
  expect(meta?.version).toBe("0.0.0")
})
