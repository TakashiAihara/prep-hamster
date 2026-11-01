import AsyncStorage from "@react-native-async-storage/async-storage"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { getApiClient } from "./api"
import { apiErrorMessage } from "./api-error"
import { useAuthStatus } from "./auth-status"
import { pickCurrentGroup } from "./current-group-pick"
import { parseInviteCode } from "./invite-code"

// 秘密ではないので secure-store ではなく AsyncStorage に置く
const STORED_ID_KEY = "prep-hamster.current-group-id"

export type CurrentGroupGroup = { id: string; name: string; createdAt: string }

type Fetched =
  | { status: "loading" }
  | { status: "ok"; groups: CurrentGroupGroup[]; storedId: string | null }
  | { status: "error"; message: string }

export type CurrentGroup = {
  status: "loading" | "ok" | "error"
  message?: string
  group: CurrentGroupGroup | null
  groups: CurrentGroupGroup[]
  select: (id: string) => void
  create: (name: string) => Promise<void>
  join: (text: string) => Promise<void>
  reload: () => void
}

const CurrentGroupContext = createContext<CurrentGroup>({
  status: "loading",
  group: null,
  groups: [],
  select: () => {},
  create: () => Promise.reject(new Error("CurrentGroupProvider の外では使えません")),
  join: () => Promise.reject(new Error("CurrentGroupProvider の外では使えません")),
  reload: () => {},
})

export function CurrentGroupProvider({ children }: { children: ReactNode }) {
  const auth = useAuthStatus()
  const [fetched, setFetched] = useState<Fetched>({ status: "loading" })
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((n) => n + 1), [])
  // サインアウトのたびに進める。作成の応答が別のセッションに届いたかをこれで見分ける
  const session = useRef(0)

  useEffect(() => {
    // サインアウトしたら、次にサインインするユーザーへ前のユーザーのグループを見せないよう捨てる
    if (auth !== "signed-in") {
      session.current += 1
      setFetched({ status: "loading" })
      return
    }
    let cancelled = false
    void (async () => {
      try {
        setFetched({ status: "loading" })
        const [res, storedId] = await Promise.all([
          getApiClient().v1.groups.$get(),
          AsyncStorage.getItem(STORED_ID_KEY),
        ])
        if (cancelled) return
        if (!res.ok) {
          setFetched({ status: "error", message: `groups HTTP ${res.status}` })
          return
        }
        const groups = (await res.json()).groups
        if (cancelled) return
        setFetched({ status: "ok", groups, storedId })
      } catch (err) {
        if (cancelled) return
        setFetched({ status: "error", message: err instanceof Error ? err.message : "unknown" })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [auth, reloadKey])

  const select = useCallback((id: string) => {
    setFetched((prev) => (prev.status === "ok" ? { ...prev, storedId: id } : prev))
    // 残せなくても今のセッションでは選べているので、失敗は握る
    AsyncStorage.setItem(STORED_ID_KEY, id).catch(() => {})
  }, [])

  const create = useCallback(
    async (name: string) => {
      const startedIn = session.current
      const res = await getApiClient().v1.groups.$post({ json: { name } })
      if (!res.ok) throw new Error(`グループを作れませんでした (HTTP ${res.status})`)
      const created = (await res.json()).group
      // 待つ間にサインアウトしていたら、次のユーザーの一覧や端末の選択に混ぜない
      if (startedIn !== session.current) return
      setFetched((prev) =>
        prev.status === "ok" ? { ...prev, groups: [...prev.groups, created] } : prev,
      )
      select(created.id)
    },
    [select],
  )

  const join = useCallback(
    async (text: string) => {
      const token = parseInviteCode(text)
      if (!token) throw new Error("招待コードが見つかりません")
      const startedIn = session.current
      const res = await getApiClient().v1.invitations[":token"].accept.$post({ param: { token } })
      if (!res.ok) {
        throw new Error(await apiErrorMessage(res, `参加できませんでした (HTTP ${res.status})`))
      }
      const { membership } = await res.json()
      // 待つ間にサインアウトしていたら、次のユーザーの端末の選択に混ぜない
      if (startedIn !== session.current) return
      // reload() は状態を loading に戻し、開いている切替画面を入口へ飛ばしてしまう (onJoined の back と二重になる)。
      // 一覧だけ取り直して、loading を挟まずに参加したグループを選ぶ
      const listRes = await getApiClient().v1.groups.$get()
      if (startedIn !== session.current) return
      if (!listRes.ok) {
        // 参加は済んでいるので、一覧は次の取り直しに任せる
        reload()
        return
      }
      const { groups } = await listRes.json()
      if (startedIn !== session.current) return
      setFetched({ status: "ok", groups, storedId: membership.groupId })
      // 残せなくても今のセッションでは選べているので、失敗は握る
      await AsyncStorage.setItem(STORED_ID_KEY, membership.groupId).catch(() => {})
    },
    [reload],
  )

  const value = useMemo<CurrentGroup>(() => {
    if (fetched.status !== "ok") {
      return {
        status: fetched.status,
        ...(fetched.status === "error" ? { message: fetched.message } : {}),
        group: null,
        groups: [],
        select,
        create,
        join,
        reload,
      }
    }
    return {
      status: "ok",
      group: pickCurrentGroup(fetched.groups, fetched.storedId),
      groups: fetched.groups,
      select,
      create,
      join,
      reload,
    }
  }, [fetched, select, create, join, reload])

  return <CurrentGroupContext.Provider value={value}>{children}</CurrentGroupContext.Provider>
}

export const useCurrentGroup = () => useContext(CurrentGroupContext)
