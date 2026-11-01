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
import {
  afterCreate,
  afterJoin,
  afterListFailed,
  afterListFetched,
  afterSelect,
  afterSignOut,
  type CurrentGroupGroup,
  type Fetched,
} from "./current-group-state"
import { parseInviteCode } from "./invite-code"

// 秘密ではないので secure-store ではなく AsyncStorage に置く
const STORED_ID_KEY = "prep-hamster.current-group-id"

export type { CurrentGroupGroup }

export type CurrentGroup = {
  status: "loading" | "ok" | "error"
  message?: string
  group: CurrentGroupGroup | null
  groups: CurrentGroupGroup[]
  select: (id: string) => void
  create: (name: string) => Promise<"selected" | "added">
  // "recovering" は参加は済んだが一覧を取り直している最中。画面は reload で入口へ戻るので呼び出し側は何もしない
  join: (text: string) => Promise<"joined" | "recovering">
  reload: () => void
  // 作成・参加の応答待ち。その間は切替画面の一覧とフォームを押せなくし、選択どうしの競合を起こさない
  busy: boolean
}

const CurrentGroupContext = createContext<CurrentGroup>({
  status: "loading",
  group: null,
  groups: [],
  select: () => {},
  create: () => Promise.reject(new Error("CurrentGroupProvider の外では使えません")),
  join: () => Promise.reject(new Error("CurrentGroupProvider の外では使えません")),
  reload: () => {},
  busy: false,
})

export function CurrentGroupProvider({ children }: { children: ReactNode }) {
  const auth = useAuthStatus()
  const [fetched, setFetched] = useState<Fetched>({ status: "loading" })
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((n) => n + 1), [])
  // サインアウトのたびに進める。作成の応答が別のセッションに届いたかをこれで見分ける
  const session = useRef(0)
  // select・作成・参加で選ぶたびに進める。作成の応答を待つ間に別の選択があったかをこれで見分ける
  // (画面は busy の間押せないので、ここに来るのはサインアウト直後などの抜け道だけ)
  const selection = useRef(0)
  const [pending, setPending] = useState(0)
  const track = useCallback(<T,>(work: Promise<T>): Promise<T> => {
    setPending((n) => n + 1)
    return work.finally(() => setPending((n) => n - 1))
  }, [])

  useEffect(() => {
    if (auth !== "signed-in") {
      session.current += 1
      setFetched(afterSignOut())
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
          setFetched(afterListFailed(`groups HTTP ${res.status}`))
          return
        }
        const groups = (await res.json()).groups
        if (cancelled) return
        setFetched(afterListFetched(groups, storedId))
      } catch (err) {
        if (cancelled) return
        setFetched(afterListFailed(err instanceof Error ? err.message : "unknown"))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [auth, reloadKey])

  const select = useCallback((id: string) => {
    selection.current += 1
    setFetched((prev) => afterSelect(prev, id))
    // 残せなくても今のセッションでは選べているので、失敗は握る
    AsyncStorage.setItem(STORED_ID_KEY, id).catch(() => {})
  }, [])

  // 作ったグループを選んだら "selected"、待つ間に利用者が選び直していたら一覧に足すだけで "added"。
  // フォームは "selected" のときだけ画面を閉じる (選び直しで既に閉じているので、二度閉じない)
  const create = useCallback(async (name: string): Promise<"selected" | "added"> => {
    const startedIn = session.current
    const selectionAtStart = selection.current
    const res = await getApiClient().v1.groups.$post({ json: { name } })
    if (!res.ok) throw new Error(`グループを作れませんでした (HTTP ${res.status})`)
    const created = (await res.json()).group
    // 待つ間にサインアウトしていたら、次のユーザーの一覧や端末の選択に混ぜない
    if (startedIn !== session.current) return "added"
    const selectedMeanwhile = selection.current !== selectionAtStart
    setFetched((prev) => afterCreate(prev, created, selectedMeanwhile))
    // 待つ間に利用者が選び直していたら、端末の選択も奪わない
    if (selectedMeanwhile) return "added"
    selection.current += 1
    AsyncStorage.setItem(STORED_ID_KEY, created.id).catch(() => {})
    return "selected"
  }, [])

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
      // 待つ間にサインアウトしていたら、次のユーザーの端末の選択に混ぜない。
      // 画面はサインアウトで入口へ戻っているので、呼び出し側には閉じさせない ("recovering")
      if (startedIn !== session.current) return "recovering"
      // 参加も選択の 1 つ。同時に走っている作成に、参加したグループの選択を奪わせない
      selection.current += 1
      // reload() は状態を loading に戻し、開いている切替画面を入口へ飛ばしてしまう (onJoined の back と二重になる)。
      // そこで一覧だけ取り直し、loading を挟まずに参加したグループを選ぶ。
      // 一覧が取れなければ (HTTP の失敗も通信の例外も)、選ぶ id だけ残して reload() に任せ、"recovering" で back を止める
      let groups: CurrentGroupGroup[] | null = null
      try {
        const listRes = await getApiClient().v1.groups.$get()
        if (listRes.ok) groups = (await listRes.json()).groups
      } catch {
        // 通信の例外も HTTP の失敗と同じく、下で取り直しに回す
      }
      if (startedIn !== session.current) return "recovering"
      if (!groups) {
        await AsyncStorage.setItem(STORED_ID_KEY, membership.groupId).catch(() => {})
        reload()
        return "recovering"
      }
      setFetched(afterJoin(groups, membership.groupId))
      // 残せなくても今のセッションでは選べているので、失敗は握る
      await AsyncStorage.setItem(STORED_ID_KEY, membership.groupId).catch(() => {})
      return "joined"
    },
    [reload],
  )

  const trackedCreate = useCallback((name: string) => track(create(name)), [track, create])
  const trackedJoin = useCallback((text: string) => track(join(text)), [track, join])
  const busy = pending > 0

  const value = useMemo<CurrentGroup>(() => {
    if (fetched.status !== "ok") {
      return {
        status: fetched.status,
        ...(fetched.status === "error" ? { message: fetched.message } : {}),
        group: null,
        groups: [],
        select,
        create: trackedCreate,
        join: trackedJoin,
        reload,
        busy,
      }
    }
    return {
      status: "ok",
      group: pickCurrentGroup(fetched.groups, fetched.storedId),
      groups: fetched.groups,
      select,
      create: trackedCreate,
      join: trackedJoin,
      reload,
      busy,
    }
  }, [fetched, select, trackedCreate, trackedJoin, reload, busy])

  return <CurrentGroupContext.Provider value={value}>{children}</CurrentGroupContext.Provider>
}

export const useCurrentGroup = () => useContext(CurrentGroupContext)
