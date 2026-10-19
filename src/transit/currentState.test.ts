import { describe, expect, it } from 'vitest'
import { toScene } from '../geo/projection.ts'
import { fetchCurrentState, parseCurrentState } from './currentState.ts'

// Shaped like the view's output: timestamptz columns come back from PostgREST
// with microseconds; inside jsonb they come back as +00:00 strings.
const row = {
  generated_at: '2026-10-18T20:00:05.123456+00:00',
  freshness: {
    muni: {
      last_success_at: '2026-10-18T19:59:40.5+00:00',
      last_poll_at: '2026-10-18T19:59:40.5+00:00',
      last_poll_ok: true,
      newest_feed_timestamp: '2026-10-18T19:59:20+00:00',
    },
  },
  vehicles: [
    {
      id: '8812',
      route_id: '14',
      direction_id: 1,
      latest: { t: '2026-10-18T19:59:20+00:00', lat: 37.765, lng: -122.4195 },
      previous: { t: '2026-10-18T19:58:05+00:00', lat: 37.7641, lng: -122.4193 },
    },
    { id: '9001', route_id: null, direction_id: null, latest: { t: '2026-10-18T19:59:00+00:00', lat: 37.77, lng: -122.41 }, previous: null },
    { id: 'bad', route_id: '14', direction_id: 0, latest: { t: 'nope', lat: 37.77, lng: -122.41 }, previous: null },
    { id: 'swapped', route_id: '14', direction_id: 7, latest: { t: '2026-10-18T19:58:00+00:00', lat: 37.77, lng: -122.41 }, previous: { t: '2026-10-18T19:59:00+00:00', lat: 37.77, lng: -122.41 } },
  ],
}

describe('parseCurrentState', () => {
  const receivedAt = Date.parse('2026-10-18T20:00:07.123Z')
  const s = parseCurrentState(row, receivedAt)

  it('reads the database clock and the offset to the browser clock', () => {
    expect(s.generatedAt).toBe(Date.parse('2026-10-18T20:00:05.123Z'))
    expect(s.serverOffsetMs).toBe(-2000)
  })

  it('reads per-layer freshness in ms', () => {
    expect(s.muni).toEqual({
      lastSuccessAt: Date.parse('2026-10-18T19:59:40.500Z'),
      lastPollAt: Date.parse('2026-10-18T19:59:40.500Z'),
      lastPollOk: true,
      newestFeedAt: Date.parse('2026-10-18T19:59:20Z'),
    })
  })

  it('projects vehicles into scene meters with ms timestamps', () => {
    const v = s.vehicles.find((x) => x.id === '8812')!
    const p = toScene(37.765, -122.4195)
    expect(v).toMatchObject({ routeId: '14', directionId: 1 })
    expect(v.latest).toEqual({ t: Date.parse('2026-10-18T19:59:20Z'), x: p.x, z: p.z })
    expect(v.previous!.t).toBe(Date.parse('2026-10-18T19:58:05Z'))
  })

  it('keeps vehicles without a route or previous point', () => {
    expect(s.vehicles.find((x) => x.id === '9001')).toMatchObject({ routeId: null, directionId: null, previous: null })
  })

  it('drops unreadable vehicles, invalid directions, and a previous point that is not earlier', () => {
    expect(s.vehicles.map((v) => v.id)).toEqual(['8812', '9001', 'swapped'])
    expect(s.vehicles[2]).toMatchObject({ directionId: null, previous: null })
  })

  it('handles an empty feed', () => {
    const empty = parseCurrentState({ generated_at: row.generated_at, freshness: { muni: {} }, vehicles: [] }, receivedAt)
    expect(empty.vehicles).toEqual([])
    expect(empty.muni).toEqual({ lastSuccessAt: null, lastPollAt: null, lastPollOk: null, newestFeedAt: null })
  })

  it('rejects a response without generated_at', () => {
    expect(() => parseCurrentState({}, receivedAt)).toThrow(/generated_at/)
    expect(() => parseCurrentState(null, receivedAt)).toThrow()
  })
})

describe('fetchCurrentState', () => {
  it('asks PostgREST for the single current_state row with the anon key', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined
    const state = await fetchCurrentState('https://ref.supabase.co/', 'anon-key', async (url, init) => {
      seen = { url: String(url), headers: init!.headers as Record<string, string> }
      return new Response(JSON.stringify(row))
    })
    expect(seen).toEqual({
      url: 'https://ref.supabase.co/rest/v1/current_state?select=*',
      headers: { apikey: 'anon-key', accept: 'application/vnd.pgrst.object+json' },
    })
    expect(state.vehicles).toHaveLength(3)
  })

  it('throws on an HTTP error', async () => {
    await expect(fetchCurrentState('https://x', 'k', async () => new Response('', { status: 401 }))).rejects.toThrow('HTTP 401')
  })
})
