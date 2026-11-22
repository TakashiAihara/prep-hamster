import type { ApiClient } from "@prep-hamster/api-client"
import { apiErrorMessage } from "./api-error"
import { getApiClient } from "./api"

// push 通知の token 登録・解除と、通知 data からの遷移先決定。
// expo-notifications / expo-device / react-native は bun test で読み込めないので、
// 実体が要る関数の中でだけ動的 import する (auth.ts と同じ方針)。

export type NotificationTarget = { kind: "stock"; stockId: string } | { kind: "home" }

// expiry-notify ジョブは data: { type: "expiring_stocks", stockIds, more } を送る。
// Expo push service 経由なら stockIds は配列のまま届く (Android は dataString を JSON.parse したもの)。
// type が違う・stockIds が空・先頭が空でない文字列でないときは在庫一覧 (/(tabs)) に留める。
export function notificationTarget(data: unknown): NotificationTarget {
  if (typeof data !== "object" || data === null) return { kind: "home" }
  const d = data as Record<string, unknown>
  if (d["type"] !== "expiring_stocks") return { kind: "home" }
  const ids = d["stockIds"]
  if (!Array.isArray(ids)) return { kind: "home" }
  const first: unknown = ids[0]
  if (typeof first !== "string" || first === "") return { kind: "home" }
  return { kind: "stock", stockId: first }
}

export async function registerPushToken(client: ApiClient, token: string): Promise<void> {
  const res = await client.v1["push-tokens"].$post({ json: { token } })
  if (!res.ok) throw new Error(await apiErrorMessage(res, `HTTP ${res.status}`))
}

export async function unregisterPushToken(client: ApiClient, token: string): Promise<void> {
  const res = await client.v1["push-tokens"].$delete({ json: { token } })
  if (!res.ok) throw new Error(await apiErrorMessage(res, `HTTP ${res.status}`))
}

const ANDROID_CHANNEL_ID = "default"
const NO_EXPERIENCE_ID = "ERR_NOTIFICATIONS_NO_EXPERIENCE_ID"

function isMissingProjectId(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: unknown }).code === NO_EXPERIENCE_ID
  )
}

// web と simulator/emulator では push token を取れないのでここで弾く。
// Expo Go の実機はここを通る (projectId 未設定などは後段で個別に弾く)。
async function pushRuntime() {
  const Device = await import("expo-device")
  const { Platform } = await import("react-native")
  if (Platform.OS === "web" || Device.isDevice !== true) return null
  const Notifications = await import("expo-notifications")
  return { Notifications, platform: Platform.OS }
}

async function ensureNotificationPermission(
  Notifications: typeof import("expo-notifications"),
): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync()
  if (current.granted) return true
  const requested = await Notifications.requestPermissionsAsync()
  return requested.granted
}

// FCMv1 の通知は channelId が無いとマニフェストの default_channel_id (app.json の
// expo-notifications plugin の defaultChannel) に流れる。JS 側で同じ id の channel を
// 作っておかないと、Android 8+ では通知が channel 不在で表示されない。
async function ensureAndroidChannel(
  Notifications: typeof import("expo-notifications"),
): Promise<void> {
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "通知",
    importance: Notifications.AndroidImportance.HIGH,
  })
}

// このセッションで最後に得た端末 token。サインアウト時の DELETE は body に token が
// 要るので、Expo 側から取り直せない (オフライン等) ときの fallback にする。
let lastDeviceToken: string | null = null

// サインイン後・起動時に 1 回呼ぶ。token が取れない環境 (simulator / web / 権限なし /
// projectId 未設定) では何もせず戻る。API の失敗は投げるので呼び出し側で記録する。
export async function registerDevicePushToken(): Promise<void> {
  const rt = await pushRuntime()
  if (!rt) return
  // Android の token 取得に通知権限は要らない (権限が要るのは通知の表示側)。
  // サインイン直後の権限ダイアログは E2E の操作を遮るので Android では要求しない。
  // iOS は APNs token に権限が要るので従来どおり要求する。
  if (rt.platform === "ios" && !(await ensureNotificationPermission(rt.Notifications))) return
  if (rt.platform === "android") await ensureAndroidChannel(rt.Notifications)

  let token: string
  try {
    token = (await rt.Notifications.getExpoPushTokenAsync()).data
  } catch (err) {
    // EAS projectId が無いと token は原理的に取れない。remote push を使うには
    // app.json の extra.eas.projectId が要る (EAS project の作成は別途)。
    if (isMissingProjectId(err)) {
      console.warn("[push] Expo push token を取得できません: extra.eas.projectId が未設定です")
      return
    }
    throw err
  }
  lastDeviceToken = token
  await registerPushToken(getApiClient(), token)
}

// サインアウト時にセッションを消す前に呼ぶ。DELETE は token 単位なので、
// いまの端末 token (取れなければ登録時のもの) を送る。
export async function unregisterDevicePushToken(): Promise<void> {
  let token: string | null = null
  const rt = await pushRuntime()
  if (rt) {
    try {
      token = (await rt.Notifications.getExpoPushTokenAsync()).data
    } catch {
      // 取り直せなくても、登録時に覚えた token があればそれで消しにいく
    }
  }
  token ??= lastDeviceToken
  lastDeviceToken = null
  if (!token) return
  await unregisterPushToken(getApiClient(), token)
}
