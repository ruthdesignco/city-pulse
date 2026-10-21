// NWS station observations (api.weather.gov GeoJSON) -> weather_observations
// rows, and the fetch the weather tick makes: KSFO's last hour or so of
// reports, plus KOAK's when KSFO has sent nothing for FALLBACK_AFTER_MS.
//
// NWS asks every client to send a User-Agent naming the app and a way to
// reach its owner; ours is the public repo, so nothing personal is in code.

export const WEATHER_SOURCE = 'nws' // ingest_runs.source for weather ticks
export const PRIMARY_STATION = 'KSFO'
export const FALLBACK_STATION = 'KOAK'
export const USER_AGENT = 'city-pulse (github.com/ruthdesignco/city-pulse)'
export const FALLBACK_AFTER_MS = 90 * 60 * 1000
const OBSERVATIONS = 12 // KSFO reports every 5 minutes: about the last hour
const FETCH_TIMEOUT_MS = 8_000

export interface CloudLayer {
  amount: string // FEW, SCT, BKN, OVC, CLR, SKC, VV (sky hidden: fog)
  base_m: number | null
}

export interface WeatherObservation {
  station: string
  observed_at: string // ISO
  visibility_m: number | null
  cloud_layers: CloudLayer[]
  wind_speed_ms: number | null
  wind_dir_deg: number | null
  wind_gust_ms: number | null
  description: string | null
}

interface Quantity {
  unitCode?: string
  value?: number | null
}

// NWS quantities carry WMO unit codes; anything unexpected is dropped rather
// than guessed at.
function quantity(q: unknown, units: Record<string, number>): number | null {
  const { unitCode, value } = (q ?? {}) as Quantity
  if (typeof value !== 'number' || !Number.isFinite(value) || !unitCode) return null
  const scale = units[unitCode.replace(/^wmoUnit:/, '')]
  return scale === undefined ? null : value * scale
}
const METERS = { m: 1, km: 1000 }
const METERS_PER_SECOND = { 'm_s-1': 1, 'km_h-1': 1 / 3.6, kt: 0.514444 }
const DEGREES = { 'degree_(angle)': 1 }

const AMOUNTS = new Set(['FEW', 'SCT', 'BKN', 'OVC', 'CLR', 'SKC', 'VV'])

export function decodeObservations(body: unknown, station: string): WeatherObservation[] {
  const features = (body as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) throw new Error('NWS: response has no features array')
  const rows: WeatherObservation[] = []
  for (const f of features) {
    const p = (f as { properties?: Record<string, unknown> } | null)?.properties
    const t = typeof p?.timestamp === 'string' ? Date.parse(p.timestamp) : NaN
    if (!p || !Number.isFinite(t)) continue
    const layers: unknown[] = Array.isArray(p.cloudLayers) ? p.cloudLayers : []
    const description = typeof p.textDescription === 'string' ? p.textDescription.trim() : ''
    rows.push({
      station,
      observed_at: new Date(t).toISOString(),
      visibility_m: quantity(p.visibility, METERS),
      cloud_layers: layers
        .map((l) => {
          const layer = (l ?? {}) as { amount?: unknown; base?: unknown }
          return { amount: String(layer.amount ?? ''), base_m: quantity(layer.base, METERS) }
        })
        .filter((l) => AMOUNTS.has(l.amount)),
      wind_speed_ms: quantity(p.windSpeed, METERS_PER_SECOND),
      wind_dir_deg: quantity(p.windDirection, DEGREES),
      wind_gust_ms: quantity(p.windGust, METERS_PER_SECOND),
      description: description || null,
    })
  }
  return rows
}

export interface WeatherFetch {
  rows: WeatherObservation[]
  http_status: number // the primary station's, if it answered
  reports: number // features received, every station
}

async function fetchStation(fetchImpl: typeof fetch, station: string) {
  const res = await fetchImpl(`https://api.weather.gov/stations/${station}/observations?limit=${OBSERVATIONS}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`NWS ${station} HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const body: unknown = await res.json()
  const features = (body as { features?: unknown[] } | null)?.features
  return { status: res.status, rows: decodeObservations(body, station), reports: Array.isArray(features) ? features.length : 0 }
}

// KSFO first; KOAK too only if KSFO failed or has nothing in the last 90
// minutes. Whatever arrived is kept: a stale KSFO plus a failed KOAK still
// records KSFO's reports. Only when nothing arrived does it throw, with
// KSFO's error.
export async function fetchWeather(fetchImpl: typeof fetch, now: Date): Promise<WeatherFetch> {
  let primary: Awaited<ReturnType<typeof fetchStation>> | null = null
  let primaryError: unknown = null
  try {
    primary = await fetchStation(fetchImpl, PRIMARY_STATION)
  } catch (err) {
    primaryError = err
  }
  const newest = Math.max(-Infinity, ...(primary?.rows ?? []).map((r) => Date.parse(r.observed_at)))
  if (primary && now.getTime() - newest <= FALLBACK_AFTER_MS) {
    return { rows: primary.rows, http_status: primary.status, reports: primary.reports }
  }
  let fallback: Awaited<ReturnType<typeof fetchStation>> | null = null
  try {
    fallback = await fetchStation(fetchImpl, FALLBACK_STATION)
  } catch (err) {
    if (!primary) throw primaryError ?? err
    // KSFO answered, if stale: keep what it sent
  }
  return {
    rows: [...(primary?.rows ?? []), ...(fallback?.rows ?? [])],
    http_status: primary?.status ?? fallback!.status,
    reports: (primary?.reports ?? 0) + (fallback?.reports ?? 0),
  }
}
