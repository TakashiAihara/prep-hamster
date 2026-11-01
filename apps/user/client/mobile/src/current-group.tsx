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
import { useAuthStatus } from "./auth-status"
import { pickCurrentGroup } from "./current-group-pick"

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
  reload: () => void
}

const CurrentGroupContext = createContext<CurrentGroup>({
  status: "loading",
  group: null,
  groups: [],
  select: () => {},
  create: () => Promise.reject(new Error("CurrentGroupProvider の外では使えません")),
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

  const value = useMemo<CurrentGroup>(() => {
    if (fetched.status !== "ok") {
      return {
        status: fetched.status,
        ...(fetched.status === "error" ? { message: fetched.message } : {}),
        group: null,
        groups: [],
        select,
        create,
        reload,
      }
    }
    return {
      status: "ok",
      group: pickCurrentGroup(fetched.groups, fetched.storedId),
      groups: fetched.groups,
      select,
      create,
      reload,
    }
  }, [fetched, select, create, reload])

  return <CurrentGroupContext.Provider value={value}>{children}</CurrentGroupContext.Provider>
}

export const useCurrentGroup = () => useContext(CurrentGroupContext)
