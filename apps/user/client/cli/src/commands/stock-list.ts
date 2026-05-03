import { defineCommand } from "citty"
import { makeClient } from "../client"

export const stockListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List stocks in a group",
  },
  args: {
    groupId: {
      type: "string",
      required: true,
      description: "Group UUID",
    },
  },
  async run({ args }) {
    const client = makeClient()
    const res = await client.v1.stocks.$get({
      query: { groupId: args.groupId },
    })
    if (!res.ok) {
      console.error(`Error: ${res.status} ${await res.text()}`)
      process.exit(1)
    }
    const data = await res.json()
    console.log(JSON.stringify(data, null, 2))
  },
})
