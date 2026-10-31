// Maestro の flow が Google の画面を通らずにサインイン済みで始めるための、dev build だけの受け口
// (判断キュー D-12)。session は scripts/dev-session.ts が Supabase の Admin API で発行する。

export type DevSession = { accessToken: string; refreshToken: string }

export function devSessionFromParams(params: {
  access_token?: string | string[]
  refresh_token?: string | string[]
}): DevSession | null {
  const access = typeof params.access_token === "string" ? params.access_token : ""
  const refresh = typeof params.refresh_token === "string" ? params.refresh_token : ""
  if (!access || !refresh) return null
  return { accessToken: access, refreshToken: refresh }
}

// 本番の build (__DEV__ が false) では、届いた token を使わない。
export function acceptsDevSession(isDev: boolean): boolean {
  return isDev
}
