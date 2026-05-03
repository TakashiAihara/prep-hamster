import { defineCommand } from "citty"

export const main = defineCommand({
  meta: {
    name: "prep-hamster-admin",
    version: "0.0.0",
    description: "備蓄管理アプリの管理者 CLI（雛形）",
  },
  run() {
    console.log(
      "prep-hamster-admin: subcommands are not implemented yet. Run with --help.",
    )
  },
})
