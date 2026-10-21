import { useEffect, useState } from 'react'
import type { CurrentState } from '../transit/currentState.ts'
import { type WeatherPreset, describeWeather } from './weather.ts'

// "Weather · updated 12 min ago", beside the Muni pill, ticking every
// second: the age of the NWS report the fog and clouds come from, on the
// database clock. Says "recorded" during a replay, "stale" or "unavailable"
// when the report is old, and "set to …" under ?weather=.
export function WeatherLabel({
  state,
  recorded,
  preset,
}: {
  state: CurrentState | null
  recorded: boolean
  preset: WeatherPreset | null
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  // Nothing to say before the first read; the Muni pill covers "connecting".
  if (!state && !preset) return null
  const view = describeWeather(state?.weather ?? null, state?.weatherFreshness ?? null, now + (state?.serverOffsetMs ?? 0), {
    recorded,
    preset,
  })
  return (
    <div className={`freshness freshness--${view.level}`} title={view.note ?? undefined}>
      <span className="freshness__dot" aria-hidden="true" />
      <span>{view.text}</span>
      {view.note && <span className="freshness__note">{view.note}</span>}
    </div>
  )
}
