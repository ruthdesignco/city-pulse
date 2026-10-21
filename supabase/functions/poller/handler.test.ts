import GtfsRealtimeBindings from 'gtfs-realtime-bindings'
import { describe, expect, it } from 'vitest'
import type { VehicleObservation } from './decode.ts'
import type { BudgetRow } from './gate.ts'
import type { WeatherObservation } from './nws.ts'
import { type Db, type Deps, type RunFields, handle } from './handler.ts'
import { RELOAD_MS, secretCache } from './secret.ts'

const SECRET = 'synthetic-poller-secret-0123456789'
const KEY = 'synthetic-511-key-abc123'
const NOW = new Date('2026-10-18T20:00:00.000Z')
const T = Math.floor(NOW.getTime() / 1000)
const { FeedMessage } = GtfsRealtimeBindings.transit_realtime

const MISSION_16TH = { latitude: 37.765, longitude: -122.4195 }
const GOLDEN_GATE_PARK = { latitude: 37.7694, longitude: -122.4862 }

function feedBytes(positions = [MISSION_16TH, GOLDEN_GATE_PARK]) {
  return FeedMessage.encode(
    FeedMessage.fromObject({
      header: { gtfsRealtimeVersion: '2.0', timestamp: T },
      entity: positions.map((position, i) => ({
        id: `e${i}`,
        vehicle: { vehicle: { id: `bus${i}` }, trip: { routeId: '14', directionId: 0 }, position, timestamp: T - 20 },
      })),
    }),
  ).finish()
}

function setup(
  opts: {
    budget?: Partial<BudgetRow>
    env?: Deps['env']
    // Vault's poller_secret; null when it doesn't exist
    vault?: string | null
    vaultFails?: boolean
    fetch?: typeof fetch
    startRunFails?: boolean
    // Hold readBudget until this many ticks have read, forcing them to race on the claim.
    readBarrier?: number
  } = {},
) {
  let readers = 0
  let releaseReaders = () => {}
  const allRead = new Promise<void>((resolve) => (releaseReaders = resolve))
  const state = {
    budget: {
      source: 'sf511',
      last_call_at: new Date(NOW.getTime() - 80_000).toISOString(),
      window_started_at: new Date(NOW.getTime() - 600_000).toISOString(),
      calls_in_window: 3,
      version: 10,
      ...opts.budget,
    } as BudgetRow,
    runs: new Map<number, { source: string; fields?: RunFields }>(),
    observations: [] as VehicleObservation[],
    weather: [] as WeatherObservation[],
    calls: [] as string[],
    urls: [] as string[],
    logs: [] as string[],
    vault: opts.vault === undefined ? SECRET : opts.vault,
    vaultReads: 0,
    clockMs: NOW.getTime(), // the secret cache's clock; deps.now stays fixed
  }
  let nextId = 1
  const db: Db = {
    async startRun(source) {
      state.calls.push('startRun')
      if (opts.startRunFails) throw new Error(`db down; request was ?api_key=${KEY}`)
      const id = nextId++
      state.runs.set(id, { source })
      return id
    },
    async finishRun(id, fields) {
      state.calls.push('finishRun')
      state.runs.get(id)!.fields = fields
    },
    async readBudget() {
      state.calls.push('readBudget')
      const snapshot = { ...state.budget }
      if (opts.readBarrier) {
        if (++readers >= opts.readBarrier) releaseReaders()
        await allRead
      }
      return snapshot
    },
    async claimBudget(_source, expectedVersion, next) {
      state.calls.push('claimBudget')
      if (expectedVersion !== state.budget.version) return false
      state.budget = { ...state.budget, ...next }
      return true
    },
    async recordObservations(rows) {
      state.calls.push('recordObservations')
      state.observations.push(...rows)
      return rows.length
    },
    async recordWeather(rows) {
      state.calls.push('recordWeather')
      state.weather.push(...rows)
      return rows.length
    },
    async pollerSecret() {
      state.vaultReads++
      if (opts.vaultFails) throw new Error(`vault read failed; request was ?api_key=${KEY}`)
      return state.vault
    },
  }
  const fetchImpl: typeof fetch = async (input, init) => {
    state.urls.push(String(input))
    return (opts.fetch ?? (async () => new Response(feedBytes())))(input, init)
  }
  const deps: Deps = {
    db,
    secret: secretCache(() => db.pollerSecret(), () => state.clockMs),
    fetch: fetchImpl,
    now: () => NOW,
    env: opts.env ?? { TRANSIT_511_API_KEY: KEY },
    log: (m) => state.logs.push(m),
  }
  return { deps, state }
}

const post = (headers: Record<string, string> = { 'x-poller-secret': SECRET }, method = 'POST', body?: string) =>
  new Request('https://example.test/functions/v1/poller', { method, headers, body })

async function run(s: ReturnType<typeof setup>, req = post()) {
  const res = await handle(req, s.deps)
  const text = await res.text()
  // Nothing the function emits may carry the key.
  for (const out of [text, ...s.state.logs, JSON.stringify([...s.state.runs.values()])]) {
    expect(out).not.toContain(KEY)
  }
  return { status: res.status, body: JSON.parse(text) as Record<string, unknown> }
}

const onlyRun = (s: ReturnType<typeof setup>) => {
  expect(s.state.runs.size).toBe(1)
  return [...s.state.runs.values()][0]
}

describe('secret header', () => {
  it('rejects a missing header with 401 and touches nothing, not even Vault', async () => {
    const s = setup()
    expect((await run(s, post({}))).status).toBe(401)
    expect((await run(s, post({ 'x-poller-secret': '  ' }))).status).toBe(401)
    expect(s.state.calls).toEqual([])
    expect(s.state.vaultReads).toBe(0)
    expect(s.state.urls).toEqual([])
  })

  it('rejects a wrong secret with 401, reading Vault at most once per reload interval', async () => {
    const s = setup()
    for (let i = 0; i < 5; i++) expect((await run(s, post({ 'x-poller-secret': `${SECRET}x` }))).status).toBe(401)
    expect(s.state.calls).toEqual([])
    expect(s.state.vaultReads).toBe(1)
  })

  it('accepts the Vault secret and caches it across ticks', async () => {
    const s = setup({ budget: { last_call_at: new Date(NOW.getTime() - 30_000).toISOString() } })
    expect((await run(s)).status).toBe(200)
    expect((await run(s)).status).toBe(200)
    expect(s.state.vaultReads).toBe(1)
  })

  it('picks up a rotated secret on the first tick after the reload interval', async () => {
    const s = setup({ budget: { last_call_at: new Date(NOW.getTime() - 30_000).toISOString() } })
    expect((await run(s)).status).toBe(200)
    const ROTATED = 'synthetic-rotated-secret-9876543210'
    s.state.vault = ROTATED // pg_cron sends the new value from the next tick on
    s.state.clockMs += RELOAD_MS
    expect((await run(s, post({ 'x-poller-secret': ROTATED }))).status).toBe(200)
    expect((await run(s)).status).toBe(401) // the leaked value is dead
    expect(s.state.vaultReads).toBe(2)
  })

  it('fails closed with 500 when Vault has no poller_secret', async () => {
    const s = setup({ vault: null })
    const r = await run(s)
    expect(r.status).toBe(500)
    expect(r.body.status).toBe('misconfigured')
    expect(s.state.calls).toEqual([])
  })

  it('fails closed with 500 when Vault cannot be read, and logs it redacted', async () => {
    const s = setup({ vaultFails: true })
    const r = await run(s)
    expect(r).toEqual({ status: 500, body: { status: 'misconfigured' } })
    expect(s.state.calls).toEqual([])
    expect(s.state.logs).toEqual(['poller: could not read the poller secret: vault read failed; request was ?api_key=[redacted]'])
  })

  it('only accepts POST, after authenticating', async () => {
    const s = setup()
    expect((await run(s, post({ 'x-poller-secret': SECRET }, 'GET'))).status).toBe(405)
    expect(s.state.calls).toEqual([])
  })
})

describe('budget gating', () => {
  it('logs a skipped_interval run and never calls 511 when under 75 s', async () => {
    const s = setup({ budget: { last_call_at: new Date(NOW.getTime() - 30_000).toISOString() } })
    const r = await run(s)
    expect(r).toEqual({ status: 200, body: { status: 'skipped_interval' } })
    expect(onlyRun(s).fields).toEqual({ status: 'skipped_interval', finished_at: NOW.toISOString() })
    expect(s.state.urls).toEqual([])
    expect(s.state.budget.version).toBe(10)
  })

  it('logs a skipped_budget run when the hour window is used up', async () => {
    const s = setup({ budget: { calls_in_window: 60 } })
    expect((await run(s)).body.status).toBe('skipped_budget')
    expect(onlyRun(s).fields?.status).toBe('skipped_budget')
    expect(s.state.urls).toEqual([])
  })

  it('makes exactly one 511 call when two ticks overlap', async () => {
    const s = setup({ readBarrier: 2 })
    const [a, b] = await Promise.all([handle(post(), s.deps), handle(post(), s.deps)])
    const statuses = [await a.json(), await b.json()].map((x) => (x as { status: string }).status).sort()
    expect(statuses).toEqual(['ok', 'skipped_interval'])
    // Both read the same budget and tried to claim it: the CAS decided, not the interval check.
    expect(s.state.calls.filter((c) => c === 'claimBudget')).toHaveLength(2)
    expect(s.state.urls).toHaveLength(1)
    expect(s.state.runs.size).toBe(2) // both ticks are logged
    expect(s.state.budget.calls_in_window).toBe(4)
  })

  it('does not burn budget when the 511 key is missing', async () => {
    const s = setup({ env: {} })
    const r = await run(s)
    expect(r.status).toBe(500)
    expect(onlyRun(s).fields).toMatchObject({ status: 'error', error: 'TRANSIT_511_API_KEY is not set' })
    expect(s.state.calls).not.toContain('claimBudget')
    expect(s.state.urls).toEqual([])
  })
})

describe('polling', () => {
  it('fetches agency=SF, clips to the bake area, writes and logs the run', async () => {
    const s = setup()
    const r = await run(s)
    expect(r).toEqual({ status: 200, body: { status: 'ok', rows_written: 1 } })

    const url = new URL(s.state.urls[0])
    expect(url.origin + url.pathname).toBe('https://api.511.org/transit/vehiclepositions')
    expect(url.searchParams.get('agency')).toBe('SF')

    expect(s.state.observations.map((o) => o.upstream_id)).toEqual(['bus0']) // the park bus is clipped
    expect(onlyRun(s).fields).toEqual({
      status: 'ok',
      finished_at: NOW.toISOString(),
      http_status: 200,
      feed_entities: 2,
      in_area: 1,
      rows_written: 1,
    })
    expect(s.state.budget).toMatchObject({ calls_in_window: 4, version: 11, last_call_at: NOW.toISOString() })
  })

  it('skips the write when nothing is in the area', async () => {
    const s = setup({ fetch: async () => new Response(feedBytes([GOLDEN_GATE_PARK])) })
    expect((await run(s)).body).toEqual({ status: 'ok', rows_written: 0 })
    expect(s.state.calls).not.toContain('recordObservations')
    expect(onlyRun(s).fields).toMatchObject({ in_area: 0, rows_written: 0 })
  })
})

describe('errors are logged, redacted, and still count against the budget', () => {
  it('511 returns an error status with the key echoed in the body', async () => {
    const s = setup({ fetch: async () => new Response(`Rate limit exceeded for api_key=${KEY}`, { status: 429 }) })
    const r = await run(s)
    expect(r).toEqual({ status: 500, body: { status: 'error' } })
    const f = onlyRun(s).fields!
    expect(f).toMatchObject({ status: 'error', http_status: 429 })
    expect(f.error).toMatch(/^511 HTTP 429: Rate limit exceeded for api_key=\[redacted\]/)
    expect(s.state.budget.calls_in_window).toBe(4)
  })

  it('the request throws with the full URL in its message and cause', async () => {
    const s = setup({
      fetch: async (input) => {
        throw new TypeError(`fetch failed: ${String(input)}`, { cause: new Error(`ETIMEDOUT ${String(input)}`) })
      },
    })
    await run(s)
    const f = onlyRun(s).fields!
    expect(f.status).toBe('error')
    expect(f.http_status).toBeUndefined()
    expect(f.error).toContain('api_key=[redacted]')
    expect(s.state.logs.join('\n')).toContain('[redacted]')
  })

  it('the body is not a GTFS-RT feed', async () => {
    const s = setup({ fetch: async () => new Response('<html>maintenance</html>') })
    await run(s)
    expect(onlyRun(s).fields).toMatchObject({ status: 'error', http_status: 200 })
  })

  it('the run row cannot be opened', async () => {
    const s = setup({ startRunFails: true })
    const r = await run(s)
    expect(r.status).toBe(500)
    expect(s.state.urls).toEqual([])
    expect(s.state.logs[0]).toContain('api_key=[redacted]')
  })
})

// One NWS observation, shaped like api.weather.gov's GeoJSON.
const nwsReport = (minutesAgo: number, visibility = 800) => ({
  properties: {
    timestamp: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    textDescription: 'Fog',
    visibility: { unitCode: 'wmoUnit:m', value: visibility },
    cloudLayers: [{ amount: 'OVC', base: { unitCode: 'wmoUnit:m', value: 60 } }],
    windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 18 },
    windDirection: { unitCode: 'wmoUnit:degree_(angle)', value: 290 },
    windGust: { unitCode: 'wmoUnit:km_h-1', value: null },
  },
})
const nwsBody = (...minutesAgo: number[]) => JSON.stringify({ features: minutesAgo.map((m) => nwsReport(m)) })
const weatherTick = () => post({ 'x-poller-secret': SECRET, 'content-type': 'application/json' }, 'POST', '{"feed":"nws"}')

describe('weather tick ({"feed":"nws"})', () => {
  it('fetches KSFO with the User-Agent, writes its reports and logs an nws run, without touching the 511 budget', async () => {
    const seen: RequestInit[] = []
    const s = setup({
      fetch: async (_input, init) => {
        seen.push(init ?? {})
        return new Response(nwsBody(5, 10))
      },
    })
    const r = await run(s, weatherTick())
    expect(r).toEqual({ status: 200, body: { status: 'ok', rows_written: 2 } })
    expect(s.state.urls).toEqual(['https://api.weather.gov/stations/KSFO/observations?limit=12'])
    expect(new Headers(seen[0].headers).get('user-agent')).toBe('city-pulse (github.com/ruthdesignco/city-pulse)')
    expect(s.state.calls).not.toContain('readBudget')
    expect(s.state.calls).not.toContain('claimBudget')
    expect(onlyRun(s)).toEqual({
      source: 'nws',
      fields: { status: 'ok', finished_at: NOW.toISOString(), http_status: 200, feed_entities: 2, rows_written: 2 },
    })
    expect(s.state.weather[0]).toEqual({
      station: 'KSFO',
      observed_at: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
      visibility_m: 800,
      cloud_layers: [{ amount: 'OVC', base_m: 60 }],
      wind_speed_ms: 5,
      wind_dir_deg: 290,
      wind_gust_ms: null,
      description: 'Fog',
    })
  })

  it('also fetches KOAK when KSFO has nothing in the last 90 minutes', async () => {
    const s = setup({
      fetch: async (input) => new Response(String(input).includes('KSFO') ? nwsBody(120) : nwsBody(10)),
    })
    expect((await run(s, weatherTick())).body).toEqual({ status: 'ok', rows_written: 2 })
    expect(s.state.urls.map((u) => new URL(u).pathname)).toEqual([
      '/stations/KSFO/observations',
      '/stations/KOAK/observations',
    ])
    expect(s.state.weather.map((w) => w.station)).toEqual(['KSFO', 'KOAK'])
  })

  it('falls back to KOAK when KSFO errors, and keeps a stale KSFO when KOAK errors', async () => {
    const down = setup({
      fetch: async (input) => (String(input).includes('KSFO') ? new Response('busy', { status: 503 }) : new Response(nwsBody(10))),
    })
    expect((await run(down, weatherTick())).body.status).toBe('ok')
    expect(down.state.weather.map((w) => w.station)).toEqual(['KOAK'])

    const stale = setup({
      fetch: async (input) => (String(input).includes('KSFO') ? new Response(nwsBody(200)) : new Response('busy', { status: 503 })),
    })
    expect((await run(stale, weatherTick())).body.status).toBe('ok')
    expect(stale.state.weather.map((w) => w.station)).toEqual(['KSFO'])
  })

  it('logs an error run with KSFO\'s error when neither station answers', async () => {
    const s = setup({ fetch: async (input) => new Response(`down ${new URL(String(input)).pathname}`, { status: 500 }) })
    const r = await run(s, weatherTick())
    expect(r).toEqual({ status: 500, body: { status: 'error' } })
    expect(onlyRun(s).fields).toMatchObject({ status: 'error' })
    expect(onlyRun(s).fields?.error).toMatch(/^NWS KSFO HTTP 500/)
  })

  it('still authenticates first, and rejects an unknown feed', async () => {
    const s = setup()
    expect((await run(s, post({}, 'POST', '{"feed":"nws"}'))).status).toBe(401)
    expect((await run(s, post(undefined, 'POST', '{"feed":"ferries"}'))).body).toEqual({ status: 'unknown_feed' })
    expect(s.state.calls).toEqual([])
    expect(s.state.urls).toEqual([])
  })

  it('treats the existing poll-feeds body ({}) as the 511 tick', async () => {
    const s = setup()
    expect((await run(s, post(undefined, 'POST', '{}'))).body).toEqual({ status: 'ok', rows_written: 1 })
    expect(new URL(s.state.urls[0]).hostname).toBe('api.511.org')
  })
})
