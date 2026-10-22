// A tile's streets as meshes (roads.ts ribbons), built in the tile worker
// (stream/tileBuild.ts) and drawn by Streets.tsx: sidewalks, asphalt over
// them, lane lines over that, each on the ground (terrain.ts), with what
// their shader needs per vertex: how far toward the haze the ring fades
// them (ring.ts), and for the streetlight pools (Streets.tsx) where along
// the street it is, how far off its centerline, its curb's offset and how
// bright its lights are.

import { Color } from 'three'
import { type CityParts, StreetClass } from './format.ts'
import { palette } from './palette.ts'
import { ringDim } from './ring.ts'
import { ROAD_CLASS, type Mesh, type Pt, dashes, emptyMesh, laneLineOffsets, ribbon } from './roads.ts'
import { type Ground, densify, drape } from './terrain.ts'

// A few centimeters apart above the ground (Ground.tsx, y <= 0.1), pushed
// further apart in depth by polygon offset (Streets.tsx).
const SIDEWALK_Y = 0.2
const ASPHALT_Y = 0.25
const MARKING_Y = 0.3
// Streets lie on the ground with a vertex at least this often where it
// bends, kept only where the ground between its neighbors strays more than
// DRAPE_TOLERANCE_M from a straight line (the ground mesh sits 0.4 m under
// the asphalt, terrain.ts / Ground.tsx): on the flats, a block-long segment
// is one quad, not twenty.
const DRAPE_STEP_M = 5
const DRAPE_TOLERANCE_M = 0.12

// A line's points every DRAPE_STEP_M, then only those the ground's shape
// needs, and every point of its own (its corners).
export function drapePoints(raw: Pt[], ground: Ground): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < raw.length; i++) {
    out.push(raw[i])
    if (i === raw.length - 1) break
    const seg = densify([raw[i], raw[i + 1]], DRAPE_STEP_M)
    const h = seg.map(([x, z]) => ground.heightAt(x, z))
    // From each kept point, as far along as a straight line still fits.
    let a = 0
    while (a < seg.length - 1) {
      let b = a + 1
      while (b + 1 < seg.length) {
        let fits = true
        for (let k = a + 1; k <= b; k++) {
          const t = (k - a) / (b + 1 - a)
          if (Math.abs(h[k] - (h[a] + (h[b + 1] - h[a]) * t)) > DRAPE_TOLERANCE_M) {
            fits = false
            break
          }
        }
        if (!fits) break
        b++
      }
      if (b < seg.length - 1) out.push(seg[b])
      a = b
    }
  }
  return out
}
// Main streets' lights brightest, side streets' dimmer.
const POOL_BY_CLASS: Record<number, number> = { [StreetClass.Major]: 1, [StreetClass.Minor]: 0.75, [StreetClass.Local]: 0.5 }

export interface StreetLayer {
  position: Float32Array
  normal: Float32Array
  color: Float32Array
  ringFade: Float32Array
  // The pools' (sidewalks and asphalt only).
  along?: Float32Array
  offset?: Float32Array
  curb?: Float32Array
  lit?: Float32Array
  index: Uint16Array | Uint32Array
}

export interface StreetLayers {
  sidewalk: StreetLayer
  asphalt: StreetLayer
  markings: StreetLayer
}

function toLayer(m: Mesh, base: Color, ground: Ground, ringAt: (x: number, z: number) => number, pools?: { curb: number[]; lit: number[] }): StreetLayer {
  const position = new Float32Array(m.position)
  const color = new Float32Array(position.length)
  const ringFade = new Float32Array(position.length / 3)
  for (let i = 0; i < position.length; i += 3) {
    base.toArray(color, i)
    ringFade[i / 3] = ringDim(ringAt(position[i], position[i + 2]))
  }
  // On the ground, shaded by its slope.
  const normal = new Float32Array(position.length)
  drape(ground, position, normal)
  const out: StreetLayer = {
    position,
    normal,
    color,
    ringFade,
    index: position.length / 3 > 65535 ? new Uint32Array(m.index) : new Uint16Array(m.index),
  }
  if (pools) {
    out.along = new Float32Array(m.along)
    out.offset = new Float32Array(m.offset)
    out.curb = new Float32Array(pools.curb)
    out.lit = new Float32Array(pools.lit)
  }
  return out
}

export function buildStreetLayers(streets: CityParts['streets'], ground: Ground, ringAt: (x: number, z: number) => number): StreetLayers {
  const sidewalk = emptyMesh()
  const asphalt = emptyMesh()
  const markings = emptyMesh()
  const sidewalkPools = { curb: [] as number[], lit: [] as number[] }
  const asphaltPools = { curb: [] as number[], lit: [] as number[] }
  // Tags the vertices `ribbon` just added with this street's curb and pools.
  const tag = (m: Mesh, p: typeof sidewalkPools, curb: number, lit: number) => {
    while (p.curb.length < m.along.length) {
      p.curb.push(curb)
      p.lit.push(lit)
    }
  }
  let c = 0
  streets.counts.forEach((n, k) => {
    const raw: Pt[] = []
    for (let i = 0; i < n; i++, c += 2) raw.push([streets.coords[c], streets.coords[c + 1]])
    // A vertex as often as the ground's slope needs.
    const line = drapePoints(raw, ground)
    const cls = ROAD_CLASS[streets.classes[k]] ?? ROAD_CLASS[StreetClass.Local]
    const lit = POOL_BY_CLASS[streets.classes[k]] ?? POOL_BY_CLASS[StreetClass.Local]
    ribbon(sidewalk, line, cls.asphaltM / 2 + cls.sidewalkM, SIDEWALK_Y)
    tag(sidewalk, sidewalkPools, cls.asphaltM / 2, lit)
    ribbon(asphalt, line, cls.asphaltM / 2, ASPHALT_Y)
    tag(asphalt, asphaltPools, cls.asphaltM / 2, lit)
    const lanes = laneLineOffsets(cls.asphaltM, cls.lanes)
    if (lanes.length) dashes(markings, line, lanes, MARKING_Y)
  })
  return {
    sidewalk: toLayer(sidewalk, new Color(palette.sidewalk), ground, ringAt, sidewalkPools),
    asphalt: toLayer(asphalt, new Color(palette.asphalt), ground, ringAt, asphaltPools),
    markings: toLayer(markings, new Color(palette.laneMarking), ground, ringAt),
  }
}
