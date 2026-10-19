// GTFS-RT Vehicle Positions (protobuf) -> vehicle_observations rows.

import GtfsRealtimeBindings from 'gtfs-realtime-bindings'

export const VEHICLE_SOURCE = 'sf511-muni'

export interface VehicleObservation {
  source: string
  upstream_id: string
  feed_timestamp: string // ISO; the feed header's snapshot time, not the vehicle's own
  route_id: string | null
  trip_id: string | null
  direction_id: 0 | 1 | null
  lat: number
  lng: number
  bearing: number | null
  speed: number | null
}

// protobufjs hands uint64 fields back as Long objects when `long` is
// installed, plain numbers otherwise.
function num(v: unknown): number {
  if (typeof v === 'number') return v
  if (v && typeof (v as { toNumber?: unknown }).toNumber === 'function') return (v as { toNumber(): number }).toNumber()
  return Number(v)
}

// Unset optional fields read back as their proto default (0, '') from the
// prototype; only own properties were actually on the wire. Without this a
// missing bearing reads as due north and a missing direction as 0.
function sent<T extends object, K extends keyof T>(msg: T | null | undefined, key: K): T[K] | null {
  return msg && Object.hasOwn(msg, key) ? msg[key] : null
}

const finiteOrNull = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v))
const textOrNull = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

// Entities without an id, a position or any timestamp are dropped: without
// those a row can't be keyed or placed. A vehicle listed twice keeps its
// newest report.
export function decodeVehicles(bytes: Uint8Array): { entities: number; vehicles: VehicleObservation[] } {
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes)
  const headerTs = num(feed.header?.timestamp)
  const byId = new Map<string, VehicleObservation>()
  const orderById = new Map<string, number>() // vehicle's own timestamp, to pick the newest duplicate

  for (const e of feed.entity) {
    const v = e.vehicle
    const pos = v?.position
    if (!v || !pos) continue
    const lat = pos.latitude
    const lng = pos.longitude
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
    if (lat === 0 && lng === 0) continue // "null island": no fix
    const id = textOrNull(v.vehicle?.id) ?? textOrNull(e.id)
    if (!id) continue
    const vehicleTs = num(v.timestamp)
    const order = vehicleTs || headerTs
    // feed_timestamp is the snapshot the view keys on (Blocker 3): the header
    // wins whenever it's sent, so every vehicle in a poll lands in the same
    // snapshot even if 511 starts filling in per-vehicle timestamps too. The
    // vehicle's own timestamp, when sent, only breaks ties between duplicate
    // entities for the same vehicle; it's never stored.
    const ts = headerTs > 0 ? headerTs : vehicleTs
    if (!(ts > 0)) continue

    const dir = sent(v.trip, 'directionId')
    const obs: VehicleObservation = {
      source: VEHICLE_SOURCE,
      upstream_id: id,
      feed_timestamp: new Date(ts * 1000).toISOString(),
      route_id: textOrNull(v.trip?.routeId),
      trip_id: textOrNull(v.trip?.tripId),
      direction_id: dir === 0 || dir === 1 ? dir : null,
      lat,
      lng,
      bearing: finiteOrNull(sent(pos, 'bearing')),
      speed: finiteOrNull(sent(pos, 'speed')),
    }
    const prevOrder = orderById.get(id)
    if (prevOrder === undefined || prevOrder <= order) {
      byId.set(id, obs)
      orderById.set(id, order)
    }
  }

  return { entities: feed.entity.length, vehicles: [...byId.values()] }
}
