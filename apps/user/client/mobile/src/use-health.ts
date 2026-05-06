import { useEffect, useState } from "react"
import { getApiClient } from "./api"

// /v1/health (実際は /health) を叩いて API への到達確認。
// v1.0.0 bootstrap の動作確認用。実装が増えるに連れて削除予定。

export type HealthState =
  | { status: "loading" }
  | { status: "ok"; httpStatus: number }
  | { status: "error"; message: string }

export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ status: "loading" })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const client = getApiClient()
        const res = await client.health.$get()
        if (cancelled) return
        if (res.ok) {
          setState({ status: "ok", httpStatus: res.status })
        } else {
          setState({ status: "error", message: `HTTP ${res.status}` })
        }
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : "unknown"
        setState({ status: "error", message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
