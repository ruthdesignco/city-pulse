import { useEffect, useState } from 'react'
import { describeFreshness } from './freshness.ts'
import type { FeedStatus } from './useCurrentState.ts'

// The corner indicator: how old the newest Muni data is, ticking every second.
// `recorded` while a replay plays: the pill then says "recorded", never "live".
export function Freshness({ feed, recorded = false }: { feed: FeedStatus; recorded?: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const view = describeFreshness(feed, now, recorded)
  return (
    <div className={`freshness freshness--${view.level}`} title={view.note ?? undefined}>
      <span className="freshness__dot" aria-hidden="true" />
      <span>{view.text}</span>
      {view.note && <span className="freshness__note">{view.note}</span>}
    </div>
  )
}
