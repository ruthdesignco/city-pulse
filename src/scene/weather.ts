// The weather the scene shows: cloud cover and visibility from the newest NWS
// report in current_state (KSFO, SFO airport, or KOAK when SFO has gone
// quiet; supabase/migrations/*_weather_observations.sql), or a ?weather=
// preset. Pure, so it's tested directly. skyState.ts turns it into light,
// sky and fog.
//
//   cloud        0 clear .. 1 overcast: dims and softens the sun, grays the sky
//   visibilityM  the station's visibility; under ~10 km it becomes height fog
//                (heightFog.ts), denser the lower it is

import { formatAge } from '../transit/freshness.ts'

export interface CloudLayer {
  amount: string // FEW, SCT, BKN, OVC, CLR, SKC, VV (sky hidden by fog)
  baseM: number | null
}

export interface WeatherReport {
  station: string
  observedAt: number // ms
  visibilityM: number | null
  cloudLayers: CloudLayer[]
  windSpeedMs: number | null
  windDirDeg: number | null
}

export interface WeatherFreshness {
  lastSuccessAt: number | null
  lastPollAt: number | null
  lastPollOk: boolean | null
  newestObservedAt: number | null
  station: string | null
}

export interface Weather {
  cloud: number
  visibilityM: number | null
}

export const CLEAR_WEATHER: Weather = { cloud: 0, visibilityM: null }

export type WeatherPreset = 'clear' | 'fog' | 'overcast'
// fog: a thick marine layer under a clear sky, the classic view from above.
export const WEATHER_PRESETS: Record<WeatherPreset, Weather> = {
  clear: CLEAR_WEATHER,
  fog: { cloud: 0, visibilityM: 600 },
  overcast: { cloud: 1, visibilityM: null },
}

export function parseWeatherParam(v: string | null): WeatherPreset | null {
  return v === 'clear' || v === 'fog' || v === 'overcast' ? v : null
}

// The fog layer's shape (heightFog.ts). Not measured: illustrative.
export const FOG_TOP_M = 220
export const FOG_SOFT_M = 120
// From the camera the fog ramps in over this distance, so a camera inside
// the layer still reads the nearby streets (heightFog.ts).
export const FOG_RAMP_M = 1000
// Visibility at or above this is no fog at all; below FOG_MIN_VISIBILITY_M
// it's as thick as it gets.
const CLEAR_VISIBILITY_M = 10_000
const FOG_MIN_VISIBILITY_M = 200
// Below this visibility, low cloud layers are the fog itself, not a deck above it.
const FOGGY_BELOW_M = 5_000

const COVER: Record<string, number> = { FEW: 0.2, SCT: 0.45, BKN: 0.75, OVC: 1 }

export function weatherFromReport(r: WeatherReport): Weather {
  const foggy = r.visibilityM !== null && r.visibilityM < FOGGY_BELOW_M
  let cloud = 0
  for (const l of r.cloudLayers) {
    // VV: the sky is hidden by the fog, which says nothing about what's above it.
    if (l.amount === 'VV') continue
    if (foggy && (l.baseM === null || l.baseM < FOG_TOP_M)) continue
    cloud = Math.max(cloud, COVER[l.amount] ?? 0)
  }
  return { cloud, visibilityM: r.visibilityM }
}

// Extinction per meter (Koschmieder: 3.912 / visibility), less the clear-day
// baseline, so 10 km or more is no fog and the far haze (Atmosphere.tsx)
// stays the only haze.
export function fogDensity(visibilityM: number | null): number {
  if (visibilityM === null || !(visibilityM > 0)) return 0
  return Math.max(0, 3.912 / Math.max(visibilityM, FOG_MIN_VISIBILITY_M) - 3.912 / CLEAR_VISIBILITY_M)
}

// A report this old is labeled stale; this much older, the scene goes back
// to clear and says the weather is unavailable rather than show old fog.
export const WEATHER_STALE_MS = 90 * 60 * 1000
export const WEATHER_EXPIRED_MS = 6 * 60 * 60 * 1000

// What to draw: the report's weather, or clear when there's none or it has expired.
export function weatherToShow(report: WeatherReport | null, nowMs: number): Weather {
  if (!report || nowMs - report.observedAt > WEATHER_EXPIRED_MS) return CLEAR_WEATHER
  return weatherFromReport(report)
}

export type WeatherLevel = 'live' | 'recorded' | 'stale' | 'waiting' | 'set'

export interface WeatherView {
  level: WeatherLevel
  text: string
  note: string | null
}

const STATION_NOTES: Record<string, string> = { KOAK: 'Oakland airport' }

// The label beside the Muni pill. Ages run from the station's own
// observation time, on the database clock (nowMs is already corrected).
export function describeWeather(
  report: WeatherReport | null,
  freshness: WeatherFreshness | null,
  nowMs: number,
  opts: { recorded?: boolean; preset?: WeatherPreset | null } = {},
): WeatherView {
  if (opts.preset) return { level: 'set', text: `Weather · set to ${opts.preset}`, note: null }
  const failing = freshness?.lastPollOk === false ? 'feed errors' : null
  if (!report) {
    if (opts.recorded) return { level: 'waiting', text: 'Weather · not recorded', note: null }
    return { level: 'waiting', text: 'Weather · waiting for the first report', note: failing }
  }
  const age = Math.max(0, nowMs - report.observedAt)
  const note = [STATION_NOTES[report.station] ?? null, failing].filter(Boolean).join(' · ') || null
  if (age > WEATHER_EXPIRED_MS) return { level: 'stale', text: `Weather · unavailable · last report ${formatAge(age)}`, note }
  if (age > WEATHER_STALE_MS) return { level: 'stale', text: `Weather · stale · last report ${formatAge(age)}`, note }
  if (opts.recorded) return { level: 'recorded', text: `Weather · recorded · updated ${formatAge(age)}`, note }
  return { level: 'live', text: `Weather · updated ${formatAge(age)}`, note }
}
