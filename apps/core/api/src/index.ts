import { createDb } from "@prep-hamster/db"
import { createApp } from "./app"

const DEFAULT_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

const db = createDb(process.env["DATABASE_URL"] ?? DEFAULT_DB_URL)
const app = createApp({ db })

const port = Number(process.env["PORT"] ?? 3000)

console.log(`[api] listening on http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch,
}
