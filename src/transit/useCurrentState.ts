import { useEffect, useState } from 'react'
import { type FeedStatus, fetchCurrentState } from './currentState.ts'

export type { FeedStatus }

const POLL_MS = 30_000
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const NOT_CONFIGURED = 'not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'

// Reads current_state every 30 s while the tab is visible, and right away
// when it becomes visible again.
export function useCurrentState(): FeedStatus {
  const [status, setStatus] = useState<FeedStatus>({
    state: null,
    error: SUPABASE_URL && ANON_KEY ? null : NOT_CONFIGURED,
    lastAttemptAt: null,
  })

  useEffect(() => {
    const url = SUPABASE_URL
    const key = ANON_KEY
    if (!url || !key) return

    let cancelled = false
    let inFlight = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()

    const tick = async () => {
      clearTimeout(timer)
      if (cancelled || inFlight || document.hidden) return
      inFlight = true
      try {
        const state = await fetchCurrentState(url, key, fetch, controller.signal)
        if (!cancelled) setStatus({ state, error: null, lastAttemptAt: Date.now() })
      } catch (err) {
        if (!cancelled) setStatus((s) => ({ ...s, error: err instanceof Error ? err.message : String(err), lastAttemptAt: Date.now() }))
      } finally {
        inFlight = false
        if (!cancelled) timer = setTimeout(tick, POLL_MS)
      }
    }
    const onVisibility = () => {
      if (!document.hidden) void tick()
    }

    void tick()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return status
}
