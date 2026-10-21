// The wind the scene shows: from the NWS report in current_state (the shown
// station's newest report that has wind; KSFO's 5-minute reports usually
// leave it out, supabase/migrations/*_wind_observed_at.sql), or a ?wind=
// preset. Calm when there's no wind on file under 90 minutes old. Pure, so
// it's tested directly. windClock.ts eases the scene toward it; the Bay's
// ripples (BayWater.tsx) and the trees' sway (Trees.tsx) follow.

import { formatAge } from '../transit/freshness.ts'
import type { WeatherReport } from './weather.ts'

export interface Wind {
  speedMs: number
  dirDeg: number // where it blows from, degrees clockwise from north
}

// When a report has speed but no direction (NWS leaves it out for variable
// wind), the prevailing westerly.
const PREVAILING_FROM_DEG = 270
export const CALM_WIND: Wind = { speedMs: 0, dirDeg: PREVAILING_FROM_DEG }

export type WindPreset = 'calm' | 'breezy' | 'strong'
export const WIND_PRESETS: Record<WindPreset, Wind> = {
  calm: CALM_WIND,
  breezy: { speedMs: 5, dirDeg: 270 },
  strong: { speedMs: 12, dirDeg: 290 },
}

export function parseWindParam(v: string | null): WindPreset | null {
  return v === 'calm' || v === 'breezy' || v === 'strong' ? v : null
}

// Wind older than this is dropped: calm instead.
export const WIND_MAX_AGE_MS = 90 * 60 * 1000

// The report's wind while it's under 90 minutes old (on the database
// clock), else calm.
export function windToShow(report: WeatherReport | null, nowMs: number): Wind {
  if (!report || report.windSpeedMs === null || report.windObservedAt === null) return CALM_WIND
  if (nowMs - report.windObservedAt > WIND_MAX_AGE_MS) return CALM_WIND
  return { speedMs: Math.max(0, report.windSpeedMs), dirDeg: report.windDirDeg ?? PREVAILING_FROM_DEG }
}

// 0 for 1 m/s or less (glassy water, still trees) to 1 at 12 m/s or more.
export const WIND_CALM_MS = 1
export const WIND_STRONG_MS = 12
export function windStrength(speedMs: number): number {
  return Math.min(1, Math.max(0, (speedMs - WIND_CALM_MS) / (WIND_STRONG_MS - WIND_CALM_MS)))
}

// Unit vector, in scene x (east) and z (south), that the wind blows toward.
export function downwind(dirDeg: number): [number, number] {
  const to = ((dirDeg + 180) * Math.PI) / 180
  return [Math.sin(to), -Math.cos(to)]
}

// prettier-ignore
const COMPASS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast',
  'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest']
export function compassName(dirDeg: number): string {
  return COMPASS[Math.round((((dirDeg % 360) + 360) % 360) / 22.5) % 16]
}

const STATION_NAMES: Record<string, string> = { KOAK: 'Oakland airport (KOAK)' }

// The wind line in "About this view": where it comes from and how old it is.
export function describeWind(report: WeatherReport | null, nowMs: number, preset: WindPreset | null = null): string {
  if (preset) return `Wind: set to ${preset} (${WIND_PRESETS[preset].speedMs} m/s).`
  const wind = windToShow(report, nowMs)
  if (!report || report.windObservedAt === null || wind === CALM_WIND) return 'Wind: calm (no wind reported in the last 90 minutes).'
  const age = formatAge(Math.max(0, nowMs - report.windObservedAt))
  const station = STATION_NAMES[report.station] ?? report.station
  if (wind.speedMs < WIND_CALM_MS) return `Wind: calm, from the ${station} report ${age}.`
  const from = report.windDirDeg === null ? 'variable' : `from the ${compassName(wind.dirDeg)}`
  return `Wind: ${Math.round(wind.speedMs)} m/s ${from}, from the ${station} report ${age}.`
}
