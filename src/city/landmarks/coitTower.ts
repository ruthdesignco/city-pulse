// Coit Tower (1933, Arthur Brown Jr.), on Telegraph Hill: a fluted
// unpainted-concrete column 64 m (210 ft) tall on a low base, crowned by an
// observation level ringed with arched openings under a projecting cornice.
// Floodlit at night, as it is. Pioneer Park's trees around it are baked
// with the street trees (bake-trees.ts), standing in the park's OSM outline.
//
// Sizes from English Wikipedia (checked 2026-10-21): 64 m tall; the shaft
// ~11 m across. It stands on a low round plinth in the hilltop's paved
// plaza (the parking circle), PLAZA_R in radius, leveled at the ground under
// the tower (registry.ts stand: 'center'), with a stone retaining rim
// where the hill drops away under it.

import type { LandmarkPlacement } from './registry.ts'
import { Glow, ModelBuilder, type V3, ring } from './build.ts'

const CONCRETE = '#efece5'
const PLINTH = '#e7e3da'
const ROOF = '#cfcac0'
const PLAZA = '#8e8a81' // asphalt-gray paving, the parking circle
const RIM = '#767066' // its stone retaining wall
const OPENING = '#33363a'
const BASE_M = 3 // the plinth's top: the shaft rises from here
const PLINTH_R = 7.5
const PLAZA_R = 21
const PLAZA_Y = 0.25 // a little over the ground, which it levels
const RIM_DROP_M = 4 // the retaining rim, down from the plaza's edge
const SHAFT_R = 5.6
const FLUTE_R = 5.2 // the flutes' inner radius
const FLUTES = 16
const CROWN_FROM_M = 54
const CROWN_R = 5.8
const CROWN_SIDES = 16
const CORNICE_FROM_M = 60
const CORNICE_M = 61.2
const CORNICE_R = 6.3
const ROOF_M = 63
const ROOF_R = 5.4
const TOP_M = 64
const LANTERN_R = 2.4
// One arched opening per crown face: its width, sill and the top of its arch.
const OPENING_W = 1.3
const OPENING_FROM_M = 55
const OPENING_TO_M = 58.8

export function buildCoitTower(_at: LandmarkPlacement): ModelBuilder {
  const m = new ModelBuilder()
  // The plaza: a flat paved circle, its rim walled down where the hill falls away.
  m.cap(ring(48, PLAZA_R, PLAZA_Y), PLAZA)
  m.loft(ring(48, PLAZA_R, PLAZA_Y - RIM_DROP_M), ring(48, PLAZA_R, PLAZA_Y), RIM)
  // The plinth.
  m.loft(ring(32, PLINTH_R, PLAZA_Y), ring(32, PLINTH_R, BASE_M), PLINTH)
  m.cap(ring(32, PLINTH_R, BASE_M), ROOF)

  // The fluted shaft: 2 x FLUTES points alternating out and in.
  const shaftPhase = Math.PI / (2 * FLUTES)
  m.loft(ring(2 * FLUTES, SHAFT_R, BASE_M, FLUTE_R, shaftPhase), ring(2 * FLUTES, SHAFT_R, CROWN_FROM_M, FLUTE_R, shaftPhase), CONCRETE, Glow.Flood)
  // The crown, its openings, the cornice, the roof and the lantern.
  const crownLow = ring(CROWN_SIDES, CROWN_R, CROWN_FROM_M)
  const crownHigh = ring(CROWN_SIDES, CROWN_R, CORNICE_FROM_M)
  m.cap(crownLow, CONCRETE, false) // its underside, a ledge over the shaft
  m.loft(crownLow, crownHigh, CONCRETE, Glow.Flood)
  for (let i = 0; i < CROWN_SIDES; i++) archOn(m, crownLow[i], crownLow[(i + 1) % CROWN_SIDES])
  m.cap(ring(CROWN_SIDES, CORNICE_R, CORNICE_FROM_M), CONCRETE, false, Glow.Flood)
  m.loft(ring(CROWN_SIDES, CORNICE_R, CORNICE_FROM_M), ring(CROWN_SIDES, CORNICE_R, CORNICE_M), CONCRETE, Glow.Flood)
  m.cap(ring(CROWN_SIDES, CORNICE_R, CORNICE_M), ROOF)
  m.loft(ring(CROWN_SIDES, ROOF_R, CORNICE_M), ring(CROWN_SIDES, ROOF_R, ROOF_M), CONCRETE, Glow.Flood)
  m.cap(ring(CROWN_SIDES, ROOF_R, ROOF_M), ROOF)
  m.loft(ring(8, LANTERN_R, ROOF_M), ring(8, LANTERN_R, TOP_M), CONCRETE, Glow.Flood)
  m.cap(ring(8, LANTERN_R, TOP_M), ROOF)
  return m
}

// An arched opening on the crown face from a to b (both at the crown's
// foot), a hair proud of it: a rectangle with a half-round top.
function archOn(m: ModelBuilder, a: V3, b: V3) {
  const dx = b[0] - a[0]
  const dz = b[2] - a[2]
  const len = Math.hypot(dx, dz)
  const ux = dx / len
  const uz = dz / len
  // Outward, for an outline counterclockwise seen from above.
  const ox = -uz
  const oz = ux
  const mid: [number, number] = [(a[0] + b[0]) / 2 + ox * 0.03, (a[2] + b[2]) / 2 + oz * 0.03]
  const w = OPENING_W / 2
  const springs = OPENING_TO_M - w
  const pts: V3[] = [
    [mid[0] - ux * w, OPENING_FROM_M, mid[1] - uz * w],
    [mid[0] + ux * w, OPENING_FROM_M, mid[1] + uz * w],
  ]
  for (let k = 0; k <= 6; k++) {
    const t = (Math.PI * k) / 6
    const along = Math.cos(t) * w
    pts.push([mid[0] + ux * along, springs + Math.sin(t) * w, mid[1] + uz * along])
  }
  m.face(pts, OPENING, Glow.Opening)
}
