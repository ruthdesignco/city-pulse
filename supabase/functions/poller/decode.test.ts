import GtfsRealtimeBindings from 'gtfs-realtime-bindings'
import { describe, expect, it } from 'vitest'
import { decodeVehicles } from './decode.ts'

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime
const T = 1_792_368_000 // 2026-10-18T00:00:00Z, seconds

function feed(entities: object[], headerTs: number | null = T) {
  const header: Record<string, unknown> = { gtfsRealtimeVersion: '2.0' }
  if (headerTs !== null) header.timestamp = headerTs
  return FeedMessage.encode(FeedMessage.fromObject({ header, entity: entities })).finish()
}

const bus = (id: string, over: Record<string, unknown> = {}) => ({
  id: `e-${id}`,
  vehicle: {
    vehicle: { id },
    trip: { tripId: `trip-${id}`, routeId: '14', directionId: 1 },
    position: { latitude: 37.765, longitude: -122.4195, bearing: 180, speed: 6.5 },
    timestamp: T - 30,
    ...over,
  },
})

describe('decodeVehicles', () => {
  it('maps a vehicle to an observation row', () => {
    const { entities, vehicles } = decodeVehicles(feed([bus('8812')]))
    expect(entities).toBe(1)
    expect(vehicles).toHaveLength(1)
    const v = vehicles[0]
    expect(v).toMatchObject({
      source: 'sf511-muni',
      upstream_id: '8812',
      feed_timestamp: new Date(T * 1000).toISOString(), // the header's time, not the vehicle's own (T - 30)
      route_id: '14',
      trip_id: 'trip-8812',
      direction_id: 1,
      bearing: 180,
    })
    expect(v.lat).toBeCloseTo(37.765, 5)
    expect(v.lng).toBeCloseTo(-122.4195, 5)
    expect(v.speed).toBeCloseTo(6.5, 5)
  })

  it('keys feed_timestamp on the header, not the vehicle, even when the vehicle sends its own', () => {
    const { vehicles } = decodeVehicles(feed([bus('11', { timestamp: T - 9_000 }), bus('12', { timestamp: T + 9_000 })]))
    expect(vehicles.map((v) => v.feed_timestamp)).toEqual([new Date(T * 1000).toISOString(), new Date(T * 1000).toISOString()])
  })

  it('falls back to the feed header timestamp, and to the entity id', () => {
    const { vehicles } = decodeVehicles(feed([{ id: 'e-77', vehicle: { position: { latitude: 37.77, longitude: -122.41 } } }]))
    expect(vehicles[0].upstream_id).toBe('e-77')
    expect(vehicles[0].feed_timestamp).toBe(new Date(T * 1000).toISOString())
    expect(vehicles[0]).toMatchObject({ route_id: null, trip_id: null, direction_id: null, bearing: null, speed: null })
  })

  it('reports unsent direction, bearing and speed as null, not the proto default 0', () => {
    const { vehicles } = decodeVehicles(
      feed([bus('9', { trip: { tripId: 't', routeId: '49' }, position: { latitude: 37.77, longitude: -122.41 } })]),
    )
    expect(vehicles[0]).toMatchObject({ route_id: '49', direction_id: null, bearing: null, speed: null })
  })

  it('keeps an explicitly sent direction 0 and bearing 0', () => {
    const { vehicles } = decodeVehicles(
      feed([bus('10', { trip: { routeId: '49', directionId: 0 }, position: { latitude: 37.77, longitude: -122.41, bearing: 0 } })]),
    )
    expect(vehicles[0]).toMatchObject({ direction_id: 0, bearing: 0 })
  })

  it('drops entities with no position, no fix, or no timestamp at all', () => {
    const { entities, vehicles } = decodeVehicles(
      feed(
        [
          { id: 'trip-update-only', tripUpdate: { trip: { tripId: 'x' } } },
          bus('nopos', { position: null }),
          bus('island', { position: { latitude: 0, longitude: 0 } }),
          bus('nots', { timestamp: 0 }),
        ],
        null,
      ),
    )
    expect(entities).toBe(4)
    expect(vehicles).toEqual([])
  })

  it('keeps the newest report when a vehicle appears twice, by the vehicle timestamp', () => {
    const { vehicles } = decodeVehicles(
      feed([
        bus('5', { timestamp: T - 90, position: { latitude: 37.1, longitude: -122.1 } }),
        bus('5', { timestamp: T - 10, position: { latitude: 37.3, longitude: -122.3 } }),
        bus('5', { timestamp: T - 50, position: { latitude: 37.2, longitude: -122.2 } }),
      ]),
    )
    expect(vehicles).toHaveLength(1)
    expect(vehicles[0].feed_timestamp).toBe(new Date(T * 1000).toISOString()) // the header, not any vehicle's own time
    expect(vehicles[0].lat).toBeCloseTo(37.3, 5) // the T-10 report: newest by vehicle timestamp
  })

  it('handles an empty feed', () => {
    expect(decodeVehicles(feed([]))).toEqual({ entities: 0, vehicles: [] })
  })

  it('throws on bytes that are not a feed', () => {
    expect(() => decodeVehicles(new TextEncoder().encode('<html>rate limited</html>'))).toThrow()
  })
})
