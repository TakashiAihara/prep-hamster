// supabase.ts は react-native のモジュールを読むので、bun test で読み込まれないよう
// 実体が要る関数の中でだけ動的 import する。
export type SessionGetter = () => Promise<{ access_token: string } | null>

async function loadSession(): Promise<{ access_token: string } | null> {
  const { supabase } = await import("./supabase")
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

// セッションが無いときは空文字を返し、API 側が 401 を返す (呼び出し側で別扱いしない)
export async function getAccessToken(getSession: SessionGetter = loadSession): Promise<string> {
  const session = await getSession()
  return session?.access_token ?? ""
}

export type AuthCallback = { code: string } | { error: string }

export function parseAuthCallback(url: string): AuthCallback {
  const query = url.split("#")[0]?.split("?").slice(1).join("?") ?? ""
  const params = new URLSearchParams(query)
  const error = params.get("error_description") ?? params.get("error")
  if (error) return { error }
  const code = params.get("code")
  if (!code) return { error: "コールバック URL に code がありません" }
  return { code }
}

// 同じ code は 1 回しか交換できない。Android では戻り URL でアプリが前に出て callback 画面も開くので、
// openAuthSessionAsync の結果と callback 画面の両方から同じ code が来る。1 回の交換を共有する。
const exchanges = new Map<string, Promise<void>>()

export function exchangeAuthCodeOnce(
  code: string,
  exchange: (code: string) => Promise<void> = exchangeWithSupabase,
): Promise<void> {
  const running = exchanges.get(code)
  if (running) return running
  const started = exchange(code)
  exchanges.set(code, started)
  return started
}

async function exchangeWithSupabase(code: string): Promise<void> {
  const { supabase } = await import("./supabase")
  const exchanged = await supabase.auth.exchangeCodeForSession(code)
  if (exchanged.error) throw exchanged.error
}

export async function signInWithGoogle(): Promise<void> {
  const { supabase } = await import("./supabase")
  const WebBrowser = await import("expo-web-browser")
  const Linking = await import("expo-linking")

  const redirectTo = Linking.createURL("auth/callback")
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  })
  if (error) throw error

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
  if (result.type !== "success") return

  const callback = parseAuthCallback(result.url)
  if ("error" in callback) throw new Error(callback.error)

  await exchangeAuthCodeOnce(callback.code)
}

export async function signOut(): Promise<void> {
  const { supabase } = await import("./supabase")
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export type AuthStatus = "loading" | "signed-in" | "signed-out"

export type Gate = { render: true } | { render: false; redirect: string | null }

// 画面グループごとの入口の判定。アプリ本体 (タブ) はサインイン済みのときだけ描き、サインイン画面は
// 未サインインのときだけ描く。描かないときは中身をマウントしない (マウントすると API を叩いてしまう)。
export function gateFor(status: AuthStatus, area: "app" | "sign-in"): Gate {
  if (status === "loading") return { render: false, redirect: null }
  if (area === "app")
    return status === "signed-in" ? { render: true } : { render: false, redirect: "/sign-in" }
  return status === "signed-out" ? { render: true } : { render: false, redirect: "/" }
}

// 起動時の状態。保存したセッションが読めない (壊れた・鍵が消えた) ときは、loading のまま止めず
// サインアウト扱いにしてサインイン画面に回す。
export async function initialAuthStatus(
  getSession: SessionGetter = loadSession,
): Promise<"signed-in" | "signed-out"> {
  try {
    return (await getSession()) ? "signed-in" : "signed-out"
  } catch {
    return "signed-out"
  }
}
