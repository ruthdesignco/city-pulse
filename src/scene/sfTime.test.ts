import { describe, expect, it } from 'vitest'
import { parseDayParam, parseTimeParam, sfClockLabel, sfDateAt, sfHour, sfIsWeekend } from './sfTime.ts'

describe('parseTimeParam', () => {
  it('reads HH:MM as a fixed San Francisco time, anything else as live', () => {
    expect(parseTimeParam('18:30')).toEqual({ mode: 'fixed', minutes: 1110, label: '18:30' })
    expect(parseTimeParam('8:05')).toEqual({ mode: 'fixed', minutes: 485, label: '08:05' })
    for (const v of [null, 'live', '', '24:00', '12:60', 'noon', '1830']) expect(parseTimeParam(v)).toEqual({ mode: 'live' })
  })
})

describe('parseDayParam', () => {
  it('reads weekday or weekend, anything else as today', () => {
    expect(parseDayParam('weekday')).toBe('weekday')
    expect(parseDayParam('weekend')).toBe('weekend')
    for (const v of [null, '', 'saturday', 'Weekend']) expect(parseDayParam(v)).toBeNull()
  })
})

describe('San Francisco clock', () => {
  it('knows the weekend on the San Francisco calendar', () => {
    expect(sfIsWeekend(new Date('2026-10-21T19:00:00Z'))).toBe(false) // Wed
    expect(sfIsWeekend(new Date('2026-10-24T19:00:00Z'))).toBe(true) // Sat
    expect(sfIsWeekend(new Date('2026-10-25T19:00:00Z'))).toBe(true) // Sun
    // 03:00 UTC Saturday is still Friday evening in San Francisco; Monday
    // 03:00 UTC is still Sunday.
    expect(sfIsWeekend(new Date('2026-10-24T03:00:00Z'))).toBe(false)
    expect(sfIsWeekend(new Date('2026-10-26T03:00:00Z'))).toBe(true)
  })

  it('reads the local hour across daylight saving', () => {
    expect(sfHour(new Date('2026-10-20T19:00:00Z'))).toBeCloseTo(12, 6) // PDT, UTC-7
    expect(sfHour(new Date('2026-12-20T20:00:00Z'))).toBeCloseTo(12, 6) // PST, UTC-8
    expect(sfClockLabel(new Date('2026-10-21T05:00:00Z'))).toBe('22:00')
  })

  it('pins a time of day to today in San Francisco', () => {
    const now = new Date('2026-10-20T16:45:00Z') // 09:45 PDT
    expect(sfDateAt(18 * 60 + 30, now).toISOString()).toBe('2026-10-21T01:30:00.000Z')
    expect(sfDateAt(0, now).toISOString()).toBe('2026-10-20T07:00:00.000Z')
    // 01:00 UTC on Oct 21 is still Oct 20 in San Francisco.
    expect(sfDateAt(8 * 60, new Date('2026-10-21T01:00:00Z')).toISOString()).toBe('2026-10-20T15:00:00.000Z')
    expect(sfDateAt(12 * 60, new Date('2026-12-20T20:00:00Z')).toISOString()).toBe('2026-12-20T20:00:00.000Z')
  })
})
