import { defineConfig } from "drizzle-kit"

const DEFAULT_LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? DEFAULT_LOCAL_URL,
  },
  strict: true,
  verbose: true,
})
