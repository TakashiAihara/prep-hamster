import { describe, expect, test } from "bun:test"
import { alreadyMemberGroupId, apiErrorMessage, apiErrorMessageFromBody } from "../api-error"

const GROUP_ID = "22222222-2222-4222-8222-222222222222"

describe("apiErrorMessageFromBody", () => {
  test("returns the API error message", () => {
    expect(
      apiErrorMessageFromBody(
        { error: { code: "INVITATION_USED", message: "招待トークンは使用済みです" } },
        "fallback",
      ),
    ).toBe("招待トークンは使用済みです")
  })

  test("falls back when the body has no usable message", () => {
    expect(apiErrorMessageFromBody({ error: { code: "X" } }, "fallback")).toBe("fallback")
    expect(apiErrorMessageFromBody({ error: { message: "" } }, "fallback")).toBe("fallback")
    expect(apiErrorMessageFromBody("<html>proxy error</html>", "fallback")).toBe("fallback")
    expect(apiErrorMessageFromBody(null, "fallback")).toBe("fallback")
  })
})

describe("apiErrorMessage", () => {
  test("reads the body once and returns its message", async () => {
    const res = {
      json: async () => ({ error: { code: "X", message: "だめでした" } }),
    }
    expect(await apiErrorMessage(res, "fallback")).toBe("だめでした")
  })

  test("falls back when json() throws", async () => {
    const res = {
      json: async () => {
        throw new Error("not json")
      },
    }
    expect(await apiErrorMessage(res, "fallback")).toBe("fallback")
  })
})

describe("alreadyMemberGroupId", () => {
  test("returns details.groupId for ALREADY_MEMBER", () => {
    const body = {
      error: {
        code: "ALREADY_MEMBER",
        message: "既に当該 group の member です",
        details: { groupId: GROUP_ID },
      },
    }
    expect(alreadyMemberGroupId(body)).toBe(GROUP_ID)
  })

  test("returns null for other error codes even with details.groupId", () => {
    const body = {
      error: { code: "INVITATION_USED", message: "x", details: { groupId: GROUP_ID } },
    }
    expect(alreadyMemberGroupId(body)).toBeNull()
  })

  test("returns null when ALREADY_MEMBER lacks a usable groupId", () => {
    expect(alreadyMemberGroupId({ error: { code: "ALREADY_MEMBER", message: "x" } })).toBeNull()
    expect(
      alreadyMemberGroupId({
        error: { code: "ALREADY_MEMBER", message: "x", details: { groupId: 123 } },
      }),
    ).toBeNull()
    expect(
      alreadyMemberGroupId({ error: { code: "ALREADY_MEMBER", message: "x", details: "g" } }),
    ).toBeNull()
  })

  test("returns null for bodies that are not the API error shape", () => {
    expect(alreadyMemberGroupId("<html>proxy error</html>")).toBeNull()
    expect(alreadyMemberGroupId(null)).toBeNull()
    expect(alreadyMemberGroupId({ error: "ALREADY_MEMBER" })).toBeNull()
  })
})
