import { expect, test } from "bun:test"
import { formatDeadline } from "./expiry-notify"

test("shows a deadline in the send year as MM/DD", () => {
  expect(formatDeadline("2026-10-25", "2026-10-25")).toBe("10/25")
  expect(formatDeadline("2026-12-31", "2026-01-01")).toBe("12/31")
})

test("shows a deadline in a different year as YYYY/MM/DD", () => {
  expect(formatDeadline("2027-01-03", "2026-12-28")).toBe("2027/01/03")
  expect(formatDeadline("2025-12-31", "2026-01-01")).toBe("2025/12/31")
})
