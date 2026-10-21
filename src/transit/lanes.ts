// Which lane a vehicle drives in: the right-hand one for its direction of
// travel, off the street's centerline (the bake snapped route shapes onto
// it, scripts/lib/snapRoute.ts). Buses keep to the curb lane, which on a
// two-way street is the outer lane on their own side and on a one-way
// street the right-hand one, so the same offset serves both and buses in
// opposite directions never share a lane. Rail and cable cars run on
// tracks either side of the middle of the street.
//
// Scaled up with distance (lod.ts), a vehicle comes in from the curb so its
// body stays on the asphalt: the scale-up never pushes it onto a sidewalk.
// Off the drawn streets there's no curb, and a fixed offset either side.

import { ROAD_CLASS } from '../city/roads.ts'
import { MODEL_WIDTH_M, type VehicleKind } from './fleet.ts'
import type { Motion } from './motion.ts'
import { lanePoint } from './shapes.ts'
import type { Pose } from './spacing.ts'

export const OFF_STREET = 3
// routes.json lanes code: in a Muni Metro tunnel (scripts/lib/tunnels.ts).
export const SUBWAY = 4
// Track centers either side of a double track's middle (Muni's are ~3.8 m apart).
export const TRACK_OFFSET_M = 1.9
// Between the vehicle's side and the curb, at least.
export const CURB_CLEARANCE_M = 0.3
// Off the drawn streets (tunnels, rights-of-way, beyond the city's edge)
// both directions follow the same GTFS line: buses keep this far right of
// it, rail and cable cars to their tracks, so they still pass clear.
export const OFF_STREET_OFFSET_M = 2

// The curb lane's center, from the centerline (m): half the street less half a lane.
export function curbLaneOffset(cls: number): number {
  const road = ROAD_CLASS[cls]
  if (!road) return 0
  const laneM = road.asphaltM / Math.max(2, road.lanes)
  return road.asphaltM / 2 - laneM / 2
}

// Meters right of the centerline to draw `kind` on a street of class `cls`
// at `scale` times its true size.
export function laneOffset(kind: VehicleKind, cls: number, scale = 1): number {
  const road = ROAD_CLASS[cls]
  if (cls === OFF_STREET || !road) return kind === 'rail' || kind === 'cable' ? TRACK_OFFSET_M : OFF_STREET_OFFSET_M
  const want = kind === 'rail' || kind === 'cable' ? Math.min(TRACK_OFFSET_M, curbLaneOffset(cls)) : curbLaneOffset(cls)
  const fits = road.asphaltM / 2 - (MODEL_WIDTH_M[kind] * scale) / 2 - CURB_CLEARANCE_M
  return Math.max(0, Math.min(want, fits))
}

// Where a vehicle is drawn: `back` meters behind its estimated position on
// its route (negative: ahead; spacing.ts), in its lane; off route, where
// it's reported. Past either end of its route line it carries on straight,
// so a bus laying over at a terminal, right at the start of its line, can
// still be held back behind the one in front. `left` moves it toward the
// middle of the street, overtaking.
export function vehiclePose(m: Motion, kind: VehicleKind, scale: number, back = 0, left = 0): Pose {
  if (!m.line) return { x: m.x, z: m.z, hx: m.hx, hz: m.hz }
  const s = m.s - back
  const clamped = Math.min(m.line.length, Math.max(0, s))
  const p = lanePoint(m.line, clamped, (cls) => laneOffset(kind, cls, scale))
  p.x += p.hx * (s - clamped) + p.hz * left
  p.z += p.hz * (s - clamped) - p.hx * left
  return p
}
