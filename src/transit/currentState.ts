// The one thing the browser reads: the current_state view (see
// supabase/migrations/*_ingest_schema.sql), fetched from PostgREST with the
// public anon key. Never 511 directly.

import { toScene } from '../geo/projection.ts'
import type { Fix, VehicleReport } from './motion.ts'

export interface LayerFreshness {
  lastSuccessAt: number | null // ms; last poll that wrote data
  lastPollAt: number | null // ms; last poll that called upstream, ok or not
  lastPollOk: boolean | null
  newestFeedAt: number | null // ms; newest vehicle timestamp we hold
}

export interface CurrentState {
  generatedAt: number // ms, database clock
  serverOffsetMs: number // add to Date.now() to get the database clock
  muni: LayerFreshness
  vehicles: VehicleReport[]
}

const ms = (v: unknown): number | null => {
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

function toFix(raw: unknown): Fix | null {
  if (!raw || typeof raw !== 'object') return null
  const { t, lat, lng } = raw as Record<string, unknown>
  const time = ms(t)
  if (time === null || typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng))
    return null
  const { x, z } = toScene(lat, lng)
  return { t: time, x, z }
}

export function parseCurrentState(row: unknown, receivedAt: number): CurrentState {
  if (!row || typeof row !== 'object') throw new Error('current_state: empty response')
  const r = row as Record<string, unknown>
  const generatedAt = ms(r.generated_at)
  if (generatedAt === null) throw new Error('current_state: missing generated_at')

  const f = ((r.freshness as Record<string, unknown> | null)?.muni ?? {}) as Record<string, unknown>
  const muni: LayerFreshness = {
    lastSuccessAt: ms(f.last_success_at),
    lastPollAt: ms(f.last_poll_at),
    lastPollOk: typeof f.last_poll_ok === 'boolean' ? f.last_poll_ok : null,
    newestFeedAt: ms(f.newest_feed_timestamp),
  }

  const vehicles: VehicleReport[] = []
  for (const v of Array.isArray(r.vehicles) ? r.vehicles : []) {
    const raw = v as Record<string, unknown>
    const latest = toFix(raw.latest)
    if (typeof raw.id !== 'string' || !latest) continue
    const previous = toFix(raw.previous)
    vehicles.push({
      id: raw.id,
      routeId: typeof raw.route_id === 'string' ? raw.route_id : null,
      directionId: raw.direction_id === 0 || raw.direction_id === 1 ? raw.direction_id : null,
      latest,
      previous: previous && previous.t < latest.t ? previous : null,
    })
  }

  return { generatedAt, serverOffsetMs: generatedAt - receivedAt, muni, vehicles }
}

export async function fetchCurrentState(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<CurrentState> {
  const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/rest/v1/current_state?select=*`, {
    headers: { apikey: apiKey, accept: 'application/vnd.pgrst.object+json' },
    signal,
  })
  if (!res.ok) throw new Error(`current_state: HTTP ${res.status}`)
  return parseCurrentState(await res.json(), Date.now())
}
