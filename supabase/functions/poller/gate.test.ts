import { describe, expect, it } from 'vitest'
import { type BudgetRow, MAX_CALLS_PER_WINDOW, MIN_INTERVAL_MS, WINDOW_MS, decide } from './gate.ts'

const NOW = new Date('2026-10-18T20:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

const row = (over: Partial<BudgetRow> = {}): BudgetRow => ({
  source: 'sf511',
  last_call_at: ago(MIN_INTERVAL_MS),
  window_started_at: ago(10 * 60_000),
  calls_in_window: 5,
  version: 7,
  ...over,
})

describe('decide (budget gate)', () => {
  it('allows the first call ever and opens a window', () => {
    const d = decide(row({ last_call_at: null, window_started_at: null, calls_in_window: 0, version: 0 }), NOW)
    expect(d).toEqual({
      allow: true,
      next: { last_call_at: NOW.toISOString(), window_started_at: NOW.toISOString(), calls_in_window: 1, version: 1 },
    })
  })

  it('skips when the last call was under 75 s ago', () => {
    expect(decide(row({ last_call_at: ago(MIN_INTERVAL_MS - 1) }), NOW)).toEqual({ allow: false, reason: 'skipped_interval' })
    expect(decide(row({ last_call_at: ago(20_000) }), NOW)).toEqual({ allow: false, reason: 'skipped_interval' })
  })

  it('allows at exactly 75 s, counting the call and bumping the version', () => {
    const d = decide(row(), NOW)
    expect(d.allow).toBe(true)
    if (!d.allow) return
    expect(d.next.calls_in_window).toBe(6)
    expect(d.next.version).toBe(8)
    expect(d.next.last_call_at).toBe(NOW.toISOString())
    expect(d.next.window_started_at).toBe(ago(10 * 60_000)) // same window
  })

  it('allows the 60th call of a window, then blocks', () => {
    const d = decide(row({ calls_in_window: MAX_CALLS_PER_WINDOW - 1 }), NOW)
    expect(d.allow && d.next.calls_in_window).toBe(60)
    expect(decide(row({ calls_in_window: MAX_CALLS_PER_WINDOW }), NOW)).toEqual({ allow: false, reason: 'skipped_budget' })
  })

  it('interval wins over budget when both would skip', () => {
    expect(decide(row({ last_call_at: ago(1000), calls_in_window: 60 }), NOW)).toEqual({ allow: false, reason: 'skipped_interval' })
  })

  it('resets the count once the window is an hour old', () => {
    const d = decide(row({ window_started_at: ago(WINDOW_MS), calls_in_window: 60 }), NOW)
    expect(d).toEqual({
      allow: true,
      next: { last_call_at: NOW.toISOString(), window_started_at: NOW.toISOString(), calls_in_window: 1, version: 8 },
    })
  })

  it('keeps the window one millisecond before it expires', () => {
    expect(decide(row({ window_started_at: ago(WINDOW_MS - 1), calls_in_window: 60 }), NOW)).toEqual({
      allow: false,
      reason: 'skipped_budget',
    })
  })

  it('skips when the clock went backward (last call in the future)', () => {
    expect(decide(row({ last_call_at: ago(-5 * 60_000) }), NOW)).toEqual({ allow: false, reason: 'skipped_interval' })
  })

  it('a window that opened in the future keeps its count (fails closed)', () => {
    expect(decide(row({ window_started_at: ago(-60_000), calls_in_window: 60 }), NOW)).toEqual({
      allow: false,
      reason: 'skipped_budget',
    })
  })

  it('treats an unparseable window start as a fresh window', () => {
    const d = decide(row({ window_started_at: 'garbage', calls_in_window: 60 }), NOW)
    expect(d.allow && d.next.calls_in_window).toBe(1)
  })
})
