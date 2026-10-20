import { describe, expect, it } from 'vitest'
import type { CurrentState } from './currentState.ts'
import { describeFreshness, formatAge, staleDim } from './freshness.ts'
import { STALE_MS } from './motion.ts'
import type { FeedStatus } from './useCurrentState.ts'

const NOW = 1_792_368_000_000

const state = (over: Partial<CurrentState['muni']> = {}, serverOffsetMs = 0): CurrentState => ({
  generatedAt: NOW,
  serverOffsetMs,
  muni: { lastSuccessAt: NOW - 30_000, lastPollAt: NOW - 30_000, lastPollOk: true, newestFeedAt: NOW - 42_000, ...over },
  vehicles: [],
})
const feed = (s: CurrentState | null, error: string | null = null): FeedStatus => ({ state: s, error, lastAttemptAt: NOW })

describe('staleDim', () => {
  it('is 0 while fresh, 1 from 3 minutes, and smooth between', () => {
    expect(staleDim(0)).toBe(0)
    expect(staleDim(STALE_MS - 20_000)).toBe(0)
    expect(staleDim(STALE_MS - 10_000)).toBeCloseTo(0.5, 9)
    expect(staleDim(STALE_MS)).toBe(1)
    expect(staleDim(STALE_MS * 10)).toBe(1)
  })
})

describe('formatAge', () => {
  it.each([
    [0, '0 s ago'],
    [42_400, '42 s ago'],
    [60_000, '1 min ago'],
    [6 * 60_000 + 59_000, '6 min ago'],
    [3 * 3600_000, '3 h ago'],
    [-5000, '0 s ago'],
  ])('%i ms -> %s', (ms, text) => expect(formatAge(ms)).toBe(text))
})

describe('describeFreshness', () => {
  it('live, with the age of the newest data', () => {
    expect(describeFreshness(feed(state()), NOW)).toEqual({ level: 'live', text: 'Muni · live · updated 42 s ago', note: null })
  })

  it('says recorded, never live, while a recording plays', () => {
    expect(describeFreshness(feed(state()), NOW, true)).toEqual({ level: 'recorded', text: 'Muni · recorded · updated 42 s ago', note: null })
    const stale = describeFreshness(feed(state({ newestFeedAt: NOW - STALE_MS - 60_000 })), NOW, true)
    expect(stale.level).toBe('stale')
    expect(stale.text).toBe('Muni · recorded · stale · last update 4 min ago')
    for (const ageMs of [0, 30_000, STALE_MS, STALE_MS + 1, 3_600_000])
      expect(describeFreshness(feed(state({ newestFeedAt: NOW - ageMs })), NOW, true).text).not.toMatch(/live/)
  })

  it('measures age on the database clock, not the viewer clock', () => {
    // The viewer's clock runs 5 min fast: offset -5 min brings it back.
    expect(describeFreshness(feed(state({}, -300_000)), NOW + 300_000).text).toBe('Muni · live · updated 42 s ago')
  })

  it('is a clock error, not "live · 0 s ago", when the newest data is from the future', () => {
    expect(describeFreshness(feed(state({ newestFeedAt: NOW + 61_000 })), NOW)).toMatchObject({
      level: 'clock-error',
      text: 'Muni · clock error',
    })
    // 60 s ahead is still within clock-skew tolerance: stays "live".
    expect(describeFreshness(feed(state({ newestFeedAt: NOW + 60_000 })), NOW).level).toBe('live')
  })

  it('stale past 3 minutes', () => {
    expect(describeFreshness(feed(state({ newestFeedAt: NOW - 6 * 60_000 })), NOW)).toMatchObject({
      level: 'stale',
      text: 'Muni · stale · last update 6 min ago',
    })
  })

  it('notes failing polls and an unreachable server', () => {
    expect(describeFreshness(feed(state({ lastPollOk: false })), NOW).note).toBe('feed errors')
    expect(describeFreshness(feed(state({ lastPollOk: false }), 'current_state: HTTP 503'), NOW).note).toBe(
      "can't reach the server · feed errors",
    )
  })

  it('waiting before any data exists', () => {
    expect(describeFreshness(feed(null), NOW)).toEqual({ level: 'waiting', text: 'Muni · connecting…', note: null })
    expect(describeFreshness(feed(state({ newestFeedAt: null })), NOW).level).toBe('waiting')
  })

  it('offline when nothing could be read', () => {
    expect(describeFreshness(feed(null, 'not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'), NOW)).toMatchObject({
      level: 'offline',
      text: 'Muni · offline',
    })
  })
})
