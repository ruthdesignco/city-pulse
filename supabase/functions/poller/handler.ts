// One poller tick. pg_cron calls this every 20 s; most ticks are logged as
// skipped and only one every 75+ s actually calls 511.
//
//   1. reject anything without the scheduler's secret (not logged); the
//      expected value comes from Vault via secret.ts
//   2. open an ingest_runs row
//   3. gate on poll_budget, then claim the slot by compare-and-swap
//   4. fetch 511 Vehicle Positions (agency=SF), decode, clip to the bake area
//   5. write observations, close the run
//
// The 511 key only ever appears in the request URL. Every error is passed
// through redact() before it reaches ingest_runs, the function log, or the
// response (which pg_net keeps in net._http_response).

import { inBakeArea } from '../_shared/area.ts'
import { redact } from '../_shared/redact.ts'
import { type AuthResult, SECRET_HEADER, checkSecret } from './auth.ts'
import { type VehicleObservation, VEHICLE_SOURCE, decodeVehicles } from './decode.ts'
import { type BudgetClaim, type BudgetRow, decide } from './gate.ts'
import type { SecretCache } from './secret.ts'

export const BUDGET_SOURCE = 'sf511' // one budget per 511 key, shared by every endpoint
const ENDPOINT = 'https://api.511.org/transit/vehiclepositions'
const FETCH_TIMEOUT_MS = 10_000
const MAX_ERROR_CHARS = 500

export type RunStatus = 'ok' | 'skipped_interval' | 'skipped_budget' | 'error'

export interface RunFields {
  status: RunStatus
  finished_at: string
  http_status?: number
  feed_entities?: number
  in_area?: number
  rows_written?: number
  error?: string
}

export interface Db {
  startRun(source: string): Promise<number>
  finishRun(id: number, fields: RunFields): Promise<void>
  readBudget(source: string): Promise<BudgetRow>
  // false when another tick changed the row first (version mismatch)
  claimBudget(source: string, expectedVersion: number, next: BudgetClaim): Promise<boolean>
  recordObservations(rows: VehicleObservation[]): Promise<number>
  // Vault's poller_secret, or null if it doesn't exist
  pollerSecret(): Promise<string | null>
}

export interface Deps {
  db: Db
  secret: SecretCache
  fetch: typeof fetch
  now(): Date
  env: { TRANSIT_511_API_KEY?: string }
  log?(message: string): void
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = err.cause instanceof Error ? `: ${err.cause.message}` : ''
  return `${err.message}${cause}`
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const key = deps.env.TRANSIT_511_API_KEY?.trim() || undefined
  const scrub = (err: unknown) => redact(describeError(err), key).slice(0, MAX_ERROR_CHARS)

  // A bare call never reaches the database.
  const provided = req.headers.get(SECRET_HEADER)
  if (!provided?.trim()) return json(401, { status: 'unauthorized' })
  let auth: AuthResult
  try {
    auth = await checkSecret(provided, (await deps.secret.current()) ?? undefined)
    // A mismatch may mean the secret was rotated after this isolate cached it.
    if (auth !== 'ok') auth = await checkSecret(provided, (await deps.secret.reloaded()) ?? undefined)
  } catch (err) {
    deps.log?.(`poller: could not read the poller secret: ${scrub(err)}`)
    return json(500, { status: 'misconfigured' })
  }
  if (auth === 'misconfigured') return json(500, { status: 'misconfigured' })
  if (auth !== 'ok') return json(401, { status: 'unauthorized' })
  if (req.method !== 'POST') return json(405, { status: 'method_not_allowed' })

  let runId: number
  try {
    runId = await deps.db.startRun(VEHICLE_SOURCE)
  } catch (err) {
    deps.log?.(`poller: could not open ingest_runs row: ${scrub(err)}`)
    return json(500, { status: 'error' })
  }
  const finish = (fields: Omit<RunFields, 'finished_at'>) =>
    deps.db.finishRun(runId, { ...fields, finished_at: deps.now().toISOString() })

  const stats: Pick<RunFields, 'http_status' | 'feed_entities' | 'in_area' | 'rows_written'> = {}
  try {
    const budget = await deps.db.readBudget(BUDGET_SOURCE)
    const decision = decide(budget, deps.now())
    if (!decision.allow) {
      await finish({ status: decision.reason })
      return json(200, { status: decision.reason })
    }
    // Check before claiming, so a missing key doesn't burn budget.
    if (!key) throw new Error('TRANSIT_511_API_KEY is not set')
    if (!(await deps.db.claimBudget(BUDGET_SOURCE, budget.version, decision.next))) {
      await finish({ status: 'skipped_interval' }) // an overlapping tick took this slot
      return json(200, { status: 'skipped_interval' })
    }

    const url = `${ENDPOINT}?${new URLSearchParams({ api_key: key, agency: 'SF' })}`
    const res = await deps.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    stats.http_status = res.status
    if (!res.ok) throw new Error(`511 HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)

    const { entities, vehicles } = decodeVehicles(new Uint8Array(await res.arrayBuffer()))
    stats.feed_entities = entities
    const inArea = vehicles.filter((v) => inBakeArea(v.lat, v.lng))
    stats.in_area = inArea.length
    stats.rows_written = inArea.length > 0 ? await deps.db.recordObservations(inArea) : 0

    await finish({ status: 'ok', ...stats })
    return json(200, { status: 'ok', rows_written: stats.rows_written })
  } catch (err) {
    const error = scrub(err)
    deps.log?.(`poller: ${error}`)
    await finish({ status: 'error', ...stats, error }).catch((e: unknown) =>
      deps.log?.(`poller: could not close ingest_runs row: ${scrub(e)}`),
    )
    return json(500, { status: 'error' })
  }
}
