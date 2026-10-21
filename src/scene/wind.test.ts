import { describe, expect, it } from 'vitest'
import type { WeatherReport } from './weather.ts'
import { CALM_WIND, WIND_PRESETS, compassName, describeWind, downwind, parseWindParam, windStrength, windToShow } from './wind.ts'

const NOW = Date.parse('2026-10-21T15:00:00Z')
const MIN = 60_000
const report = (over: Partial<WeatherReport> = {}): WeatherReport => ({
  station: 'KSFO',
  observedAt: NOW - 5 * MIN,
  visibilityM: 16093,
  cloudLayers: [],
  windSpeedMs: 5.1,
  windDirDeg: 290,
  windObservedAt: NOW - 34 * MIN,
  ...over,
})

describe('wind to show', () => {
  it("takes the report's wind while it's under 90 minutes old", () => {
    expect(windToShow(report(), NOW)).toEqual({ speedMs: 5.1, dirDeg: 290 })
    expect(windToShow(report({ windObservedAt: NOW - 89 * MIN }), NOW).speedMs).toBe(5.1)
  })

  it('is calm with no report, no wind on file, wind over 90 minutes old, or no wind time', () => {
    expect(windToShow(null, NOW)).toBe(CALM_WIND)
    expect(windToShow(report({ windSpeedMs: null, windDirDeg: null, windObservedAt: null }), NOW)).toBe(CALM_WIND)
    expect(windToShow(report({ windObservedAt: NOW - 91 * MIN }), NOW)).toBe(CALM_WIND)
    // Before the wind_observed_at migration: speed, but no time to age it by.
    expect(windToShow(report({ windObservedAt: null }), NOW)).toBe(CALM_WIND)
  })

  it('blows from the prevailing west when the direction is variable', () => {
    expect(windToShow(report({ windDirDeg: null }), NOW).dirDeg).toBe(270)
  })
})

describe('wind strength and direction', () => {
  it('runs from 0 at 1 m/s to 1 at 12 m/s', () => {
    expect(windStrength(0)).toBe(0)
    expect(windStrength(1)).toBe(0)
    expect(windStrength(WIND_PRESETS.breezy.speedMs)).toBeCloseTo(4 / 11, 6)
    expect(windStrength(WIND_PRESETS.strong.speedMs)).toBe(1)
    expect(windStrength(30)).toBe(1)
  })

  it('points downwind in scene x (east) and z (south)', () => {
    // A west wind blows toward the east.
    const [x, z] = downwind(270)
    expect(x).toBeCloseTo(1, 6)
    expect(z).toBeCloseTo(0, 6)
    // A north wind blows south: +z.
    expect(downwind(0)[1]).toBeCloseTo(1, 6)
  })

  it('names compass points', () => {
    expect(compassName(290)).toBe('west-northwest')
    expect(compassName(0)).toBe('north')
    expect(compassName(359)).toBe('north')
    expect(compassName(-90)).toBe('west')
  })
})

describe('wind params and the About line', () => {
  it('reads the presets', () => {
    expect(parseWindParam('strong')).toBe('strong')
    for (const v of [null, '', 'gale', 'Calm']) expect(parseWindParam(v)).toBeNull()
    expect([WIND_PRESETS.calm.speedMs, WIND_PRESETS.breezy.speedMs, WIND_PRESETS.strong.speedMs]).toEqual([0, 5, 12])
  })

  it('says where the wind comes from and how old it is', () => {
    expect(describeWind(report(), NOW)).toBe('Wind: 5 m/s from the west-northwest, from the KSFO report 34 min ago.')
    expect(describeWind(report({ station: 'KOAK' }), NOW)).toBe('Wind: 5 m/s from the west-northwest, from the Oakland airport (KOAK) report 34 min ago.')
    expect(describeWind(report({ windDirDeg: null }), NOW)).toBe('Wind: 5 m/s variable, from the KSFO report 34 min ago.')
    expect(describeWind(report({ windSpeedMs: 0, windDirDeg: 0 }), NOW)).toBe('Wind: calm, from the KSFO report 34 min ago.')
    expect(describeWind(report({ windObservedAt: NOW - 2 * 60 * MIN }), NOW)).toBe('Wind: calm (no wind reported in the last 90 minutes).')
    expect(describeWind(null, NOW)).toBe('Wind: calm (no wind reported in the last 90 minutes).')
    expect(describeWind(report(), NOW, 'strong')).toBe('Wind: set to strong (12 m/s).')
  })
})
