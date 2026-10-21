import { describe, expect, it } from 'vitest'
import {
  CLEAR_WEATHER,
  WEATHER_EXPIRED_MS,
  type WeatherFreshness,
  type WeatherReport,
  describeWeather,
  fogDensity,
  parseWeatherParam,
  weatherFromReport,
  weatherToShow,
} from './weather.ts'

const NOW = Date.parse('2026-10-20T19:00:00Z')
const report = (over: Partial<WeatherReport> = {}): WeatherReport => ({
  station: 'KSFO',
  observedAt: NOW - 12 * 60_000,
  visibilityM: 16093,
  cloudLayers: [],
  windSpeedMs: null,
  windDirDeg: null,
  windObservedAt: null,
  ...over,
})
const fresh: WeatherFreshness = { lastSuccessAt: NOW, lastPollAt: NOW, lastPollOk: true, newestObservedAt: NOW, station: 'KSFO' }

describe('weather from a report', () => {
  it('takes cloud cover from the densest layer', () => {
    expect(weatherFromReport(report()).cloud).toBe(0)
    expect(weatherFromReport(report({ cloudLayers: [{ amount: 'FEW', baseM: 1800 }] })).cloud).toBe(0.2)
    expect(weatherFromReport(report({ cloudLayers: [{ amount: 'SCT', baseM: 900 }, { amount: 'OVC', baseM: 2500 }] })).cloud).toBe(1)
    expect(weatherFromReport(report({ cloudLayers: [{ amount: 'CLR', baseM: null }] })).cloud).toBe(0)
  })

  it("doesn't count the fog itself as cloud above it", () => {
    // Fog at the airport: the sky hidden (VV), or an overcast at 60 m that is the layer itself.
    const foggy = report({ visibilityM: 400, cloudLayers: [{ amount: 'VV', baseM: 60 }] })
    expect(weatherFromReport(foggy).cloud).toBe(0)
    expect(weatherFromReport({ ...foggy, cloudLayers: [{ amount: 'OVC', baseM: 60 }] }).cloud).toBe(0)
    // A deck well above the fog still counts.
    expect(weatherFromReport({ ...foggy, cloudLayers: [{ amount: 'BKN', baseM: 900 }] }).cloud).toBe(0.75)
    // With good visibility a low overcast is a cloud deck, not fog.
    expect(weatherFromReport(report({ cloudLayers: [{ amount: 'OVC', baseM: 150 }] })).cloud).toBe(1)
  })

  it('turns visibility into fog density: none at 10 km and over, thicker the lower it is', () => {
    expect(fogDensity(null)).toBe(0)
    expect(fogDensity(16093)).toBe(0)
    expect(fogDensity(10_000)).toBe(0)
    expect(fogDensity(5000)).toBeGreaterThan(0)
    expect(fogDensity(800)).toBeGreaterThan(fogDensity(3000))
    expect(fogDensity(800)).toBeCloseTo(3.912 / 800 - 3.912 / 10_000, 9)
    expect(fogDensity(50)).toBe(fogDensity(200)) // floored
  })

  it('shows clear with no report, and once a report has expired', () => {
    expect(weatherToShow(null, NOW)).toEqual(CLEAR_WEATHER)
    const foggy = report({ visibilityM: 400 })
    expect(weatherToShow(foggy, NOW).visibilityM).toBe(400)
    expect(weatherToShow({ ...foggy, observedAt: NOW - WEATHER_EXPIRED_MS - 1 }, NOW)).toEqual(CLEAR_WEATHER)
  })

  it('accepts only the three presets', () => {
    expect(parseWeatherParam('fog')).toBe('fog')
    expect(parseWeatherParam('overcast')).toBe('overcast')
    expect(parseWeatherParam('clear')).toBe('clear')
    expect(parseWeatherParam('rain')).toBeNull()
    expect(parseWeatherParam(null)).toBeNull()
  })
})

describe('the weather label', () => {
  it('says how old the report is, from the observation time', () => {
    expect(describeWeather(report(), fresh, NOW)).toEqual({ level: 'live', text: 'Weather · updated 12 min ago', note: null })
  })

  it('says stale past 90 minutes and unavailable past 6 hours', () => {
    expect(describeWeather(report({ observedAt: NOW - 2 * 3600_000 }), fresh, NOW)).toMatchObject({
      level: 'stale',
      text: 'Weather · stale · last report 2 h ago',
    })
    expect(describeWeather(report({ observedAt: NOW - 7 * 3600_000 }), fresh, NOW)).toMatchObject({
      level: 'stale',
      text: 'Weather · unavailable · last report 7 h ago',
    })
  })

  it('names the fallback station and failing polls', () => {
    expect(describeWeather(report({ station: 'KOAK' }), { ...fresh, lastPollOk: false }, NOW).note).toBe('Oakland airport · feed errors')
  })

  it('says recorded during a replay, and when a recording has no weather', () => {
    expect(describeWeather(report(), fresh, NOW, { recorded: true }).text).toBe('Weather · recorded · updated 12 min ago')
    expect(describeWeather(null, null, NOW, { recorded: true }).text).toBe('Weather · not recorded')
    expect(describeWeather(null, fresh, NOW).text).toBe('Weather · waiting for the first report')
  })

  it('says when ?weather= set it, whatever the report says', () => {
    expect(describeWeather(report(), fresh, NOW, { preset: 'fog' })).toEqual({ level: 'set', text: 'Weather · set to fog', note: null })
  })
})
