import { Hono } from "hono"

const app = new Hono()

app.get("/health", (c) => c.json({ ok: true }))

export type AppType = typeof app
export default app
