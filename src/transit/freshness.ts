// How fresh the Muni layer is, for the corner indicator and for dimming.
// Interpolation keeps buses moving even when the feed is dead, so the scene
// has to say so: buses dim as their data passes ~3 minutes, and the
// indicator always shows the age of the newest data we hold.

import { STALE_MS } from './motion.ts'
import type { FeedStatus } from './currentState.ts'

const DIM_RAMP_MS = 20_000

// 0 while fresh, rising smoothly to 1 at STALE_MS, so buses don't blink.
export function staleDim(ageMs: number): number {
  const x = Math.min(1, Math.max(0, (ageMs - (STALE_MS - DIM_RAMP_MS)) / DIM_RAMP_MS))
  return x * x * (3 - 2 * x)
}

// 'recorded' replaces 'live' while a recording plays (?replay=): a replay
// is never described as live, however recent its data.
export type FreshnessLevel = 'live' | 'recorded' | 'stale' | 'waiting' | 'offline' | 'clock-error'

// Beyond this far ahead of the server clock, a feed timestamp isn't "live ·
// 0 s ago" anymore, it's broken: either the feed froze on a header that's
// ahead of now, or a clock somewhere is wrong.
const CLOCK_ERROR_MS = 60_000

export interface FreshnessView {
  level: FreshnessLevel
  text: string
  note: string | null
}

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)} h ago`
}

export function describeFreshness(feed: FeedStatus, nowMs: number, recorded = false): FreshnessView {
  const { state, error } = feed
  if (!state) {
    if (error) return { level: 'offline', text: 'Muni · offline', note: error }
    return { level: 'waiting', text: 'Muni · connecting…', note: null }
  }
  const unreachable = error ? "can't reach the server" : null
  const newest = state.muni.newestFeedAt
  if (newest === null) return { level: 'waiting', text: 'Muni · waiting for the first update', note: unreachable }

  const age = nowMs + state.serverOffsetMs - newest
  const pollFailing = state.muni.lastPollOk === false ? 'feed errors' : null
  const note = [unreachable, pollFailing].filter(Boolean).join(' · ') || null
  if (age < -CLOCK_ERROR_MS) return { level: 'clock-error', text: 'Muni · clock error', note }
  if (recorded) {
    if (age <= STALE_MS) return { level: 'recorded', text: `Muni · recorded · updated ${formatAge(age)}`, note }
    return { level: 'stale', text: `Muni · recorded · stale · last update ${formatAge(age)}`, note }
  }
  if (age <= STALE_MS) return { level: 'live', text: `Muni · live · updated ${formatAge(age)}`, note }
  return { level: 'stale', text: `Muni · stale · last update ${formatAge(age)}`, note }
}
