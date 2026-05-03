import { defineCommand } from "citty"
import { makeClient } from "../client"

export const stockAddCommand = defineCommand({
  meta: {
    name: "add",
    description: "Add a new stock",
  },
  args: {
    groupId: { type: "string", required: true, description: "Group UUID" },
    itemId: { type: "string", required: true, description: "Item UUID" },
    locationId: { type: "string", required: true, description: "Location UUID" },
    quantity: { type: "string", required: true, description: "Quantity (number)" },
    unit: { type: "string", required: true, description: "Unit (e.g., 個 / 本 / g)" },
    useBy: { type: "string", description: "Use-by date YYYY-MM-DD" },
    bestBefore: { type: "string", description: "Best-before date YYYY-MM-DD" },
    note: { type: "string", description: "Note" },
  },
  async run({ args }) {
    const quantity = Number(args.quantity)
    if (Number.isNaN(quantity) || quantity < 0) {
      console.error(`Error: --quantity must be a non-negative number, got '${args.quantity}'`)
      process.exit(1)
    }

    const client = makeClient()
    const res = await client.v1.stocks.$post({
      json: {
        groupId: args.groupId,
        itemId: args.itemId,
        locationId: args.locationId,
        quantity,
        unit: args.unit,
        useByDate: args.useBy ?? null,
        bestBeforeDate: args.bestBefore ?? null,
        openedAt: null,
        note: args.note ?? null,
      },
    })
    if (!res.ok) {
      console.error(`Error: ${res.status} ${await res.text()}`)
      process.exit(1)
    }
    const data = await res.json()
    console.log(JSON.stringify(data, null, 2))
  },
})
