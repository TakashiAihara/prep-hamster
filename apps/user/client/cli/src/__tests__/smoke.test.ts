import { test, expect } from "bun:test"
import { main } from "../main"

async function resolveMeta(cmd: typeof main) {
  return await (typeof cmd.meta === "function" ? cmd.meta() : cmd.meta)
}

async function resolveSubCommands(cmd: typeof main) {
  return await (typeof cmd.subCommands === "function" ? cmd.subCommands() : cmd.subCommands)
}

test("main command has expected metadata", async () => {
  const meta = await resolveMeta(main)
  expect(meta?.name).toBe("prep-hamster")
  expect(meta?.version).toBe("0.0.0")
})

test("main command exposes stock subcommand", async () => {
  const subs = await resolveSubCommands(main)
  expect(subs?.["stock"]).toBeDefined()
})

test("stock subcommand exposes list and add", async () => {
  const subs = await resolveSubCommands(main)
  const stock = await subs?.["stock"]
  if (!stock || typeof stock !== "object") {
    throw new Error("stock subcommand missing")
  }
  const stockSubs = await (typeof stock.subCommands === "function"
    ? stock.subCommands()
    : stock.subCommands)
  expect(stockSubs?.["list"]).toBeDefined()
  expect(stockSubs?.["add"]).toBeDefined()
})
