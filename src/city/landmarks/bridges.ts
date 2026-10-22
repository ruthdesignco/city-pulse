// The Golden Gate Bridge (1937) and the Bay Bridge's western span (1936),
// low-poly, drawn with the landmarks (Landmarks.tsx). Unlike the other
// landmarks they replace no building footprint and stand over water, so
// they're placed here, in scene meters, not by the bake (registry.ts).
//
// Where they stand: from OpenStreetMap's decks (the Geofabrik extract of
// 2026-10-17). The Golden Gate's runs straight from its south anchorage at
// Fort Point to its north tower, where OSM splits the way; the Bay Bridge's
// west span is one straight way from Rincon Hill to Yerba Buena Island.
// Spans and heights from English Wikipedia (checked 2026-10-22): the Golden
// Gate's towers 227 m over the water, a 1,280 m main span between 343 m
// side spans, the cables' sag 143 m, the deck 67 m clear of the water; the
// Bay Bridge's west span two suspension bridges end to end, each 354 + 704
// + 354 m, meeting at a central anchorage, its towers about 160 m tall.
// Seen from the city a cable or a suspender is a pixel or two wide: they're
// drawn as square members, a little thicker than life, and kept apart from
// the rest (`thin`), out of the Bay's low-resolution reflection, where they
// broke into dashes. Approach piers run down past the ground; the terrain
// hides their feet.

import { palette } from '../palette.ts'
import { Glow, ModelBuilder, type V3, member } from './build.ts'

type P = [number, number] // scene x, z

const INTERNATIONAL_ORANGE = '#c0362c'
const BAY_GRAY = '#a3a8ac'
const CONCRETE = '#bdb8ae'
// Footings: below the water and the ground.
const FOOT_Y = -10

// A straight line through the scene: the point s meters along it from `a`,
// `off` meters across, y up.
function line(a: P, b: P) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  const u: P = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
  const n: P = [u[1], -u[0]]
  const at = (s: number, off = 0, y = 0): V3 => [a[0] + u[0] * s + n[0] * off, y, a[1] + u[1] * s + n[1] * off]
  return { length, at }
}
type Line = ReturnType<typeof line>

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const centroid = (ps: V3[]): V3 => ps.reduce<V3>((c, p) => [c[0] + p[0] / ps.length, c[1] + p[1] / ps.length, c[2] + p[2] / ps.length], [0, 0, 0])

// A quad facing away from `inside`, whatever order its corners come in.
function quad(m: ModelBuilder, ps: V3[], inside: V3, color: string, glow: Glow = Glow.None) {
  const [a, b, c] = ps
  const u = sub(b, a)
  const v = sub(c, a)
  const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  m.face(dot(n, sub(centroid(ps), inside)) >= 0 ? ps : [...ps].reverse(), color, glow)
}

// A box between two rectangles, four corners each in order around it
// (lower, then upper), its faces outward; its top in `top`.
function box(m: ModelBuilder, lower: V3[], upper: V3[], color: string, glow: Glow = Glow.None, top = color) {
  const inside = centroid([...lower, ...upper])
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    quad(m, [lower[i], lower[j], upper[j], upper[i]], inside, color, glow)
  }
  quad(m, upper, inside, top, glow)
  quad(m, lower, inside, color, glow)
}

// An upright block on the line at s, `off` across, from y0 to y1: its half
// sizes along and across the line at its foot, and at its head.
function block(m: ModelBuilder, l: Line, s: number, off: number, y0: number, y1: number, foot: P, head: P, color: string, glow: Glow = Glow.None) {
  const rect = (y: number, [ha, hc]: P): V3[] => [l.at(s - ha, off - hc, y), l.at(s + ha, off - hc, y), l.at(s + ha, off + hc, y), l.at(s - ha, off + hc, y)]
  box(m, rect(y0, foot), rect(y1, head), color, glow)
}

interface DeckPoint {
  p: P
  top: number // the roadway's height
}

// A deck along a path: a box per stretch, `half` meters either side,
// `depth` deep, its sides and underside in `color`, its roadway asphalt.
function deck(m: ModelBuilder, path: DeckPoint[], half: number, depth: number, color: string) {
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k]
    const b = path[k + 1]
    const l = line(a.p, b.p)
    // A little past each end, so stretches meeting at an angle close up.
    const over = Math.min(2, l.length / 4)
    const end = (s: number, y: number): V3[] => [l.at(s, -half, y), l.at(s, half, y)]
    const lower = [...end(-over, a.top - depth), ...end(l.length + over, b.top - depth).reverse()]
    const upper = [...end(-over, a.top), ...end(l.length + over, b.top).reverse()]
    box(m, lower, upper, color, Glow.None, palette.asphalt)
  }
}

// Points along a straight line every `step` meters or so from s0 to s1, at
// the heights `top` gives.
function along(l: Line, s0: number, s1: number, step: number, top: (s: number) => number): DeckPoint[] {
  const n = Math.max(1, Math.round((s1 - s0) / step))
  return Array.from({ length: n + 1 }, (_, k) => {
    const s = s0 + ((s1 - s0) * k) / n
    const [x, , z] = l.at(s)
    return { p: [x, z], top: top(s) }
  })
}

// Approach piers: a pair of columns under a deck path every `step` meters.
function piers(m: ModelBuilder, path: DeckPoint[], half: number, depth: number, step: number, width: number, color: string) {
  let next = step / 2
  for (let k = 0; k + 1 < path.length; k++) {
    const l = line(path[k].p, path[k + 1].p)
    for (; next < l.length; next += step) {
      const y = path[k].top + ((path[k + 1].top - path[k].top) * next) / l.length - depth
      for (const off of [-half * 0.7, half * 0.7]) block(m, l, next, off, FOOT_Y, y, [width, width], [width, width], color)
    }
    next -= l.length
  }
}

interface Suspension {
  l: Line
  // Along the line: the anchorages' cable ends, and the towers.
  anchors: [number, number]
  towers: [number, number]
  anchorY: [number, number]
  saddleY: number // the cables over the towers
  lowY: number // the main span's cables at their lowest
  sideSag: number
  cableOff: number
  cableM: number
  deckTop: (s: number) => number
  hangerM: number
  color: string
}

const between = (from: number, to: number, n: number) => Array.from({ length: n - 1 }, (_, k) => from + ((to - from) * (k + 1)) / n)

// The cables over a suspension bridge, either side, and the suspenders from
// them down to the deck every 15 m.
function cables(m: ModelBuilder, b: Suspension) {
  const [a0, a1] = b.anchors
  const [t0, t1] = b.towers
  const mid = (t0 + t1) / 2
  const half = (t1 - t0) / 2
  const y = (s: number) => {
    if (s >= t0 && s <= t1) return b.lowY + (b.saddleY - b.lowY) * ((s - mid) / half) ** 2
    const [from, to, yFrom, yTo] = s < t0 ? [a0, t0, b.anchorY[0], b.saddleY] : [t1, a1, b.saddleY, b.anchorY[1]]
    const t = (s - from) / (to - from)
    return yFrom + (yTo - yFrom) * t - b.sideSag * 4 * t * (1 - t)
  }
  const stops = [a0, ...between(a0, t0, 25), t0, ...between(t0, t1, 40), t1, ...between(t1, a1, 25), a1]
  for (const side of [-1, 1]) {
    const off = side * b.cableOff
    for (let k = 0; k + 1 < stops.length; k++) member(m, b.l.at(stops[k], off, y(stops[k])), b.l.at(stops[k + 1], off, y(stops[k + 1])), b.cableM, b.cableM, b.color)
    for (let s = a0 + 15; s < a1 - 5; s += 15.2) {
      if (Math.abs(s - t0) < 8 || Math.abs(s - t1) < 8) continue
      const top = y(s)
      const foot = b.deckTop(s)
      if (top - foot > 1.5) member(m, b.l.at(s, off, foot), b.l.at(s, off, top), b.hangerM, b.hangerM, b.color)
    }
  }
}

// ------------------------------------------------------------ Golden Gate

const GG_SOUTH_ANCHORAGE: P = [-5687, -4772]
const GG_NORTH_TOWER: P = [-5836, -6381.5]
const GG_MAIN_M = 1280
const GG_SIDE_M = 343
const GG_TOWER_M = 227
const GG_SADDLE_M = 222
const GG_SAG_M = 143
const GG_DECK_HALF = 13.5
const GG_DECK_DEPTH = 7.6
// The roadway's height: up from Fort Point to the towers, a little higher
// at mid-span (67 m clear of the water under its truss).
const GG_DECK = { anchorage: 70, tower: 72.5, mid: 75 }
const GG_LEG_OFF = 17
// Each leg's half sizes (along the bridge, across) at its foot and its top,
// stepping in at every strut; the struts' heights over the water.
const GG_LEG_FOOT: P = [8, 5]
const GG_LEG_HEAD: P = [5, 3.2]
const GG_STRUTS = [58, 104, 145, 183, 219]
// The roads onto it: from the toll plaza (OSM's deck, its carriageways
// averaged), and on into the Marin headland.
const GG_SOUTH_APPROACH: DeckPoint[] = [
  { p: [-5597, -4450], top: 58 },
  { p: [-5615, -4479], top: 59 },
  { p: [-5631, -4505], top: 60 },
  { p: [-5644, -4532], top: 61 },
  { p: [-5654, -4558], top: 62.5 },
  { p: [-5662, -4585], top: 64 },
  { p: [-5667, -4612], top: 65 },
  { p: [-5671, -4640], top: 66 },
  { p: GG_SOUTH_ANCHORAGE, top: GG_DECK.anchorage },
]
const GG_NORTH_APPROACH: P[] = [
  [-5878, -6828],
  [-5887, -6920],
  [-5895, -6985],
  [-5910, -7040],
  [-5930, -7085],
  [-5955, -7122],
]

function goldenGate(m: ModelBuilder, thin: ModelBuilder) {
  const l = line(GG_SOUTH_ANCHORAGE, GG_NORTH_TOWER)
  const t1 = l.length
  const t0 = t1 - GG_MAIN_M
  const a0 = t0 - GG_SIDE_M
  const a1 = t1 + GG_SIDE_M
  const mid = (t0 + t1) / 2
  const deckTop = (s: number) => {
    if (s <= t0) return GG_DECK.anchorage + ((GG_DECK.tower - GG_DECK.anchorage) * (s - a0)) / (t0 - a0)
    if (s >= t1) return GG_DECK.tower + ((GG_DECK.anchorage - GG_DECK.tower) * (s - t1)) / (a1 - t1)
    return GG_DECK.mid + (GG_DECK.tower - GG_DECK.mid) * ((s - mid) / (GG_MAIN_M / 2)) ** 2
  }
  // The deck, anchorage to anchorage, and its approaches.
  deck(m, along(l, a0, a1, 40, deckTop), GG_DECK_HALF, GG_DECK_DEPTH, INTERNATIONAL_ORANGE)
  deck(m, GG_SOUTH_APPROACH, GG_DECK_HALF, GG_DECK_DEPTH, INTERNATIONAL_ORANGE)
  piers(m, GG_SOUTH_APPROACH, GG_DECK_HALF, GG_DECK_DEPTH, 55, 2.2, INTERNATIONAL_ORANGE)
  const [nx, , nz] = l.at(a1)
  const north: DeckPoint[] = [
    { p: [nx, nz], top: GG_DECK.anchorage },
    ...GG_NORTH_APPROACH.map((p, k) => ({ p, top: GG_DECK.anchorage - (3 * (k + 1)) / GG_NORTH_APPROACH.length })),
  ]
  deck(m, north, GG_DECK_HALF, GG_DECK_DEPTH, INTERNATIONAL_ORANGE)
  piers(m, north, GG_DECK_HALF, GG_DECK_DEPTH, 55, 2.2, INTERNATIONAL_ORANGE)
  // The anchorages, concrete, where the cables go into the ground.
  for (const s of [a0, a1]) block(m, l, s, 0, FOOT_Y, GG_DECK.anchorage - 4, [22, 26], [16, 22], CONCRETE)
  // The towers: on their piers, two legs stepping in at each strut,
  // floodlit at night.
  const legSize = (y: number): P => {
    const t = y / GG_TOWER_M
    return [GG_LEG_FOOT[0] + (GG_LEG_HEAD[0] - GG_LEG_FOOT[0]) * t, GG_LEG_FOOT[1] + (GG_LEG_HEAD[1] - GG_LEG_FOOT[1]) * t]
  }
  for (const s of [t0, t1]) {
    block(m, l, s, 0, FOOT_Y, 8, [26, 34], [24, 32], CONCRETE)
    const levels = [8, ...GG_STRUTS, GG_TOWER_M]
    for (let k = 0; k + 1 < levels.length; k++) {
      // Each stretch as wide all the way up as at its top: a step at each strut.
      const size = legSize(levels[k + 1])
      for (const side of [-1, 1]) block(m, l, s, side * GG_LEG_OFF, levels[k], levels[k + 1], size, size, INTERNATIONAL_ORANGE, Glow.Flood)
    }
    for (const y of GG_STRUTS) block(m, l, s, 0, y - 7, y, [3, GG_LEG_OFF], [3, GG_LEG_OFF], INTERNATIONAL_ORANGE, Glow.Flood)
    block(m, l, s, 0, GG_TOWER_M - 6, GG_TOWER_M, [3.5, GG_LEG_OFF + 3], [3.5, GG_LEG_OFF + 3], INTERNATIONAL_ORANGE, Glow.Flood)
  }
  cables(thin, {
    l,
    anchors: [a0, a1],
    towers: [t0, t1],
    anchorY: [GG_DECK.anchorage - 6, GG_DECK.anchorage - 6],
    saddleY: GG_SADDLE_M,
    lowY: GG_SADDLE_M - GG_SAG_M,
    sideSag: 12,
    cableOff: GG_DECK_HALF + 0.5,
    cableM: 1.1,
    deckTop,
    hangerM: 0.35,
    color: INTERNATIONAL_ORANGE,
  })
}

// ------------------------------------------------------- Bay Bridge (west)

const BAY_RINCON: P = [1994, -2051]
const BAY_YERBA_BUENA: P = [4030, -4446]
const BAY_MAIN_M = 704
const BAY_SIDE_M = 354
const BAY_TOWER_M = 160
const BAY_SADDLE_M = 157
const BAY_LOW_M = 73
const BAY_DECK_TOP = 66
const BAY_DECK_HALF = 10.5
const BAY_DECK_DEPTH = 10 // two decks in one truss
const BAY_LEG_OFF = 13
// The towers' X-bracing: its tiers' heights over the water.
const BAY_TIERS = [BAY_DECK_TOP + 2, 98, 128, BAY_TOWER_M - 6]
// From Rincon Hill the approach climbs on piers to the San Francisco
// anchorage at the shore; on Yerba Buena the deck runs on into the hill
// toward its tunnel.
const BAY_APPROACH_TOP = 30
const BAY_ISLAND_RUN_M = 140

function bayBridge(m: ModelBuilder, thin: ModelBuilder) {
  const l = line(BAY_RINCON, BAY_YERBA_BUENA)
  // The anchorages and towers along it, back from Yerba Buena.
  const yb = l.length
  const w6 = yb - BAY_SIDE_M
  const w5 = w6 - BAY_MAIN_M
  const center = w5 - BAY_SIDE_M
  const w3 = center - BAY_SIDE_M
  const w2 = w3 - BAY_MAIN_M
  const w1 = w2 - BAY_SIDE_M
  const deckTop = (s: number) => (s >= w1 ? BAY_DECK_TOP : BAY_APPROACH_TOP + ((BAY_DECK_TOP - BAY_APPROACH_TOP) * s) / w1)
  const approach = along(l, 0, w1, 40, deckTop)
  deck(m, approach, BAY_DECK_HALF, BAY_DECK_DEPTH, BAY_GRAY)
  piers(m, approach, BAY_DECK_HALF, BAY_DECK_DEPTH, 50, 2.5, CONCRETE)
  block(m, l, 3, 0, FOOT_Y, BAY_APPROACH_TOP - BAY_DECK_DEPTH, [4, BAY_DECK_HALF], [4, BAY_DECK_HALF], CONCRETE)
  deck(m, along(l, w1, yb + BAY_ISLAND_RUN_M, 50, deckTop), BAY_DECK_HALF, BAY_DECK_DEPTH, BAY_GRAY)
  // Anchorages: at the shore, between the two bridges, on the island.
  block(m, l, w1, 0, FOOT_Y, BAY_DECK_TOP - 4, [24, 20], [20, 18], CONCRETE)
  block(m, l, center, 0, FOOT_Y, 92, [16, 24], [12, 19], CONCRETE)
  block(m, l, yb, 0, FOOT_Y, BAY_DECK_TOP - 4, [20, 20], [18, 18], CONCRETE)
  // The towers: on their piers, two legs braced by an X in each tier.
  for (const s of [w2, w3, w5, w6]) {
    block(m, l, s, 0, FOOT_Y, 9, [16, 26], [14, 24], CONCRETE)
    for (const side of [-1, 1]) block(m, l, s, side * BAY_LEG_OFF, 9, BAY_TOWER_M, [4.5, 3.5], [3, 2.5], BAY_GRAY)
    block(m, l, s, 0, BAY_DECK_TOP - BAY_DECK_DEPTH - 6, BAY_DECK_TOP - BAY_DECK_DEPTH, [3, BAY_LEG_OFF], [3, BAY_LEG_OFF], BAY_GRAY)
    block(m, l, s, 0, BAY_TOWER_M - 6, BAY_TOWER_M, [3, BAY_LEG_OFF + 2], [3, BAY_LEG_OFF + 2], BAY_GRAY)
    for (let k = 0; k + 1 < BAY_TIERS.length; k++)
      for (const side of [-1, 1]) member(m, l.at(s, -side * BAY_LEG_OFF, BAY_TIERS[k]), l.at(s, side * BAY_LEG_OFF, BAY_TIERS[k + 1]), 2.2, 2.2, BAY_GRAY)
  }
  const spans: [number, number, number, number, number, number][] = [
    [w1, w2, w3, center, BAY_DECK_TOP - 6, 88],
    [center, w5, w6, yb, 88, BAY_DECK_TOP - 6],
  ]
  for (const [a0, t0, t1, a1, y0, y1] of spans)
    cables(thin, {
      l,
      anchors: [a0, a1],
      towers: [t0, t1],
      anchorY: [y0, y1],
      saddleY: BAY_SADDLE_M,
      lowY: BAY_LOW_M,
      sideSag: 8,
      cableOff: BAY_DECK_HALF + 0.5,
      cableM: 1,
      deckTop,
      hangerM: 0.35,
      color: BAY_GRAY,
    })
}

// Both bridges, in scene meters (place() them at the origin, unturned):
// their towers, decks and piers, and apart, their cables and suspenders.
export function buildBridges(): { solid: ModelBuilder; thin: ModelBuilder } {
  const solid = new ModelBuilder()
  const thin = new ModelBuilder()
  goldenGate(solid, thin)
  bayBridge(solid, thin)
  return { solid, thin }
}
