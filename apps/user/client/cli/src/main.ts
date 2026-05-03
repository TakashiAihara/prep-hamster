import { defineCommand } from "citty"
import { stockListCommand } from "./commands/stock-list"
import { stockAddCommand } from "./commands/stock-add"

const stockCommand = defineCommand({
  meta: {
    name: "stock",
    description: "Stock operations",
  },
  subCommands: {
    list: stockListCommand,
    add: stockAddCommand,
  },
})

export const main = defineCommand({
  meta: {
    name: "prep-hamster",
    version: "0.0.0",
    description: "備蓄管理アプリのユーザー CLI",
  },
  subCommands: {
    stock: stockCommand,
  },
})
