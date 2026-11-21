import { router } from "expo-router"
import * as Notifications from "expo-notifications"
import { useEffect, useRef } from "react"
import { Platform } from "react-native"
import { useAuthStatus } from "./auth-status"
import { notificationTarget, registerDevicePushToken } from "./push"

// push 通知の token 登録と、通知タップでの画面遷移 (issue #128)。
// expo-notifications は web で getLastNotificationResponse が UnavailabilityError を
// 投げるので、web ではマウントしない (import 自体は web stub で安全)。
export function PushNotifications() {
  if (Platform.OS === "web") return null
  return <PushNotificationsNative />
}

function PushNotificationsNative() {
  const status = useAuthStatus()
  const lastResponse = Notifications.useLastNotificationResponse()
  const registered = useRef(false)

  // サインイン中に 1 回 token を登録する。サインアウトで状態が戻ると ref が折れ、
  // 次のサインイン (共有端末の別ユーザーを含む) で登録し直す。
  useEffect(() => {
    if (status !== "signed-in") {
      registered.current = false
      return
    }
    if (registered.current) return
    registered.current = true
    registerDevicePushToken().catch((err: unknown) => {
      console.error("[push] push token の登録に失敗しました", err)
    })
  }, [status])

  // useLastNotificationResponse は cold start (起動時に既に response がある) と
  // 実行中のタップの両方を拾う。処理した response は消して、remount で二度開かないようにする。
  useEffect(() => {
    if (!lastResponse) return
    if (lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return
    const target = notificationTarget(lastResponse.notification.request.content.data)
    if (target.kind === "stock") {
      router.push({ pathname: "/stocks/[id]", params: { id: target.stockId } })
    } else {
      router.push("/")
    }
    Notifications.clearLastNotificationResponse()
  }, [lastResponse])

  return null
}
