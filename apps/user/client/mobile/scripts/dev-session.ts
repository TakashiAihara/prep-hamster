#!/usr/bin/env bun
// Maestro の flow 用に、テスト用ユーザーの session を発行して dev build の受け口の deep link を出す
// (判断キュー D-12)。Google の画面は自動では通れないので、Supabase の Admin API で発行する。
//
// env:
//   SUPABASE_URL         Supabase の project の URL
//   SUPABASE_SECRET_KEY  Supabase の secret key (Admin API 用。端末やアプリには入れない)
//   DEV_SESSION_EMAIL    テスト用ユーザー (既定 maestro@example.test)
//   DEV_SESSION_BASE     deep link の先頭 (既定 prep-hamster://。Expo Go なら exp://<host>:8081/--/)
//
// 使い方: bun run scripts/dev-session.ts  → 1 行目に deep link を出す

const base = (process.env["SUPABASE_URL"] ?? "").replace(/\/+$/, "")
const key = (process.env["SUPABASE_SECRET_KEY"] ?? "").trim()
const email = process.env["DEV_SESSION_EMAIL"] ?? "maestro@example.test"
const linkBase = process.env["DEV_SESSION_BASE"] ?? "prep-hamster://"

if (!base || !key) {
  console.error("[dev-session] SUPABASE_URL と SUPABASE_SECRET_KEY が要ります")
  process.exit(2)
}

const auth = `${base}/auth/v1`
const adminHeaders = {
  apikey: key,
  authorization: `Bearer ${key}`,
  "content-type": "application/json",
}

// 既にいれば 422 が返る。それ以外の失敗は止める。
const created = await fetch(`${auth}/admin/users`, {
  method: "POST",
  headers: adminHeaders,
  body: JSON.stringify({ email, email_confirm: true }),
})
if (!created.ok && created.status !== 422) {
  console.error(`[dev-session] テスト用ユーザーを作れません: ${created.status}`)
  process.exit(1)
}

// Email provider を無効にしていても、Admin API の magic link は session に交換できる (2026-10-31 実測)。
const link = await fetch(`${auth}/admin/generate_link`, {
  method: "POST",
  headers: adminHeaders,
  body: JSON.stringify({ type: "magiclink", email }),
})
const linkBody = (await link.json().catch(() => ({}))) as { hashed_token?: string }
if (!link.ok || !linkBody.hashed_token) {
  console.error(`[dev-session] magic link を発行できません: ${link.status}`)
  process.exit(1)
}

const verified = await fetch(`${auth}/verify`, {
  method: "POST",
  headers: { apikey: key, "content-type": "application/json" },
  body: JSON.stringify({ type: "magiclink", token_hash: linkBody.hashed_token }),
})
const session = (await verified.json().catch(() => ({}))) as {
  access_token?: string
  refresh_token?: string
}
if (!verified.ok || !session.access_token || !session.refresh_token) {
  console.error(`[dev-session] session に交換できません: ${verified.status}`)
  process.exit(1)
}

const query = new URLSearchParams({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
})
console.log(`${linkBase}auth/dev-session?${query.toString()}`)
