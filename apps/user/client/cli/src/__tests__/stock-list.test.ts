import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"

// --include-empty が API の includeEmpty クエリに届くことを、スタブサーバが受けた実リクエストで確かめる。
// PREP_HAMSTER_ACCESS_TOKEN があれば makeClient はセッションを読まずに client を返すので、
// ローカルの HTTP スタブに向けて CLI を子プロセスで起動する (client-gate.test.ts と同じ形)。
let server: ReturnType<typeof Bun.serve> | undefined
afterEach(() => {
  server?.stop(true)
  server = undefined
})

const GROUP_ID = "00000000-0000-4000-8000-000000000001"

async function runStockList(argv: string[]) {
  const requests: URL[] = []
  server = Bun.serve({
    port: 0,
    fetch(req) {
      requests.push(new URL(req.url))
      return Response.json({ stocks: [] })
    },
  })
  const proc = Bun.spawn(
    ["bun", "run", join(import.meta.dir, "..", "index.ts"), "stock", "list", ...argv],
    {
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: process.env["HOME"] ?? "",
        PREP_HAMSTER_ACCESS_TOKEN: "tok",
        PREP_HAMSTER_API_URL: `http://127.0.0.1:${server.port}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
  return { requests, stderr, code }
}

test("stock list --include-empty sends includeEmpty=true", async () => {
  const { requests, code } = await runStockList(["--groupId", GROUP_ID, "--include-empty"])

  expect(code).toBe(0)
  expect(requests).toHaveLength(1)
  expect(requests[0]?.searchParams.get("includeEmpty")).toBe("true")
}, 30000)

test("stock list without --include-empty sends includeEmpty=false", async () => {
  const { requests, code } = await runStockList(["--groupId", GROUP_ID])

  expect(code).toBe(0)
  expect(requests).toHaveLength(1)
  expect(requests[0]?.searchParams.get("includeEmpty")).toBe("false")
}, 30000)
