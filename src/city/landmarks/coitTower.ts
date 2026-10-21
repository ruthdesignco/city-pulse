// Coit Tower (1933, Arthur Brown Jr.), on Telegraph Hill: a fluted
// unpainted-concrete column 64 m (210 ft) tall on a low base, crowned by an
// observation level ringed with arched openings under a projecting cornice.
// Floodlit at night, as it is. Pioneer Park's trees around it are baked
// with the street trees (bake-trees.ts), standing in the park's OSM outline.
//
// Sizes from English Wikipedia (checked 2026-10-21): 64 m tall; the shaft
// ~11 m across. The base is sized from the OSM footprint, which includes it.

import type { LandmarkPlacement } from './registry.ts'
import { Glow, ModelBuilder, type V3, rect, ring } from './build.ts'

const CONCRETE = '#efece5'
const BASE = '#e7e3da'
const ROOF = '#cfcac0'
const OPENING = '#33363a'
const BASE_M = 9
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

export function buildCoitTower(at: LandmarkPlacement): ModelBuilder {
  const m = new ModelBuilder()
  // The base: a low block, from the footprint, not wider than the hilltop plaza.
  const hx = Math.min(13, Math.max(7, at.sizeX / 2))
  const hz = Math.min(13, Math.max(7, at.sizeZ / 2))
  m.loft(rect(hx, hz, 0), rect(hx, hz, BASE_M), BASE)
  m.cap(rect(hx, hz, BASE_M), ROOF)

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
