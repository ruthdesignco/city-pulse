// Rooftop detail on the flat roofs (Rooftops.tsx): mechanical boxes and
// HVAC units, stair and elevator penthouses, a tower's mechanical
// penthouse, and now and then a wooden water tank on an older mid-rise.
// Worked out at load from city.bin, deterministic per building (the facade
// seed, extrude.ts), sized by footprint and building family
// (scripts/lib/buildingColor.ts BuildingColorType), each item aligned with
// the building's longest wall and kept inside the roof's edge without
// overlapping the others.

import { type CityData, COORD_QUANTUM, HEIGHT_QUANTUM, RING_BAND_METERS } from './format.ts'
import { seedOf } from './extrude.ts'

export const RoofItem = { Hvac: 0, Penthouse: 1, Tank: 2 } as const
export type RoofItem = (typeof RoofItem)[keyof typeof RoofItem]

export interface RoofPiece {
  kind: RoofItem
  x: number
  y: number // roof height: the item stands on it
  z: number
  yaw: number
  w: number // along the building's long axis, m
  d: number // across it, m
  h: number // height above the roof, m
  building: number
  ring: number // 0..1, as the building's
}

// Roofs smaller than this, or lower, get nothing (sheds, kiosks, garages).
export const MIN_ROOF_M2 = 80
export const MIN_HEIGHT_M = 6
// Clearance from the roof's edge (a parapet's worth) and between items.
export const EDGE_M = 0.8
const GAP_M = 0.6
// Placement tries per item before giving up on it.
const TRIES = 14
const TOWER_M = 60

const NEUTRAL = 0
const RESIDENTIAL = 1
const TOWER = 2

// xorshift, seeded per building.
function rng(seed: number): () => number {
  let a = Math.floor(seed * 4294967296) >>> 0 || 0x9e3779b9
  return () => {
    a ^= a << 13
    a ^= a >>> 17
    a ^= a << 5
    return (a >>> 0) / 4294967296
  }
}

const between = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r()

export function insideRing(ring: number[], x: number, z: number): boolean {
  let hit = false
  const n = ring.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i]
    const zi = ring[2 * i + 1]
    const xj = ring[2 * j]
    const zj = ring[2 * j + 1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}

// The corners of a placed item's footprint (with `margin` added all round),
// in world x, z. Local +x runs along the building's long wall; rotated by
// yaw about y in three's convention (world x = cos*lx + sin*lz, world
// z = -sin*lx + cos*lz), the same rotation Rooftops.tsx gives the instance.
export function cornersOf(p: Pick<RoofPiece, 'x' | 'z' | 'yaw' | 'w' | 'd'>, margin = 0): [number, number][] {
  const cos = Math.cos(p.yaw)
  const sin = Math.sin(p.yaw)
  const hw = p.w / 2 + margin
  const hd = p.d / 2 + margin
  return [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ].map(([sx, sz]) => [p.x + cos * sx * hw + sin * sz * hd, p.z - sin * sx * hw + cos * sz * hd])
}

// What one building's roof carries, before placement: [kind, w, d, h].
function wishList(family: number, height: number, area: number, r: () => number): [RoofItem, number, number, number][] {
  const out: [RoofItem, number, number, number][] = []
  const side = Math.sqrt(area)
  if (family === TOWER || height >= TOWER_M) {
    // A tower's mechanical penthouse: a big screened box over the core.
    const w = Math.min(28, Math.max(7, side * between(r, 0.35, 0.5)))
    out.push([RoofItem.Penthouse, w, w * between(r, 0.6, 0.95), between(r, 5, 8)])
    for (let i = Math.floor(between(r, 2, 6)); i > 0; i--) out.push([RoofItem.Hvac, between(r, 2, 3.5), between(r, 1.5, 2.5), between(r, 1.2, 2)])
    return out
  }
  // Stair and elevator penthouse on anything with a few floors.
  if (height >= 12 && r() < (family === RESIDENTIAL ? 0.55 : 0.75)) {
    const w = Math.min(9, Math.max(2.8, side * between(r, 0.15, 0.25)))
    out.push([RoofItem.Penthouse, w, between(r, 2.6, 3.6), between(r, 2.6, 3.6)])
  }
  // The occasional wooden water tank on an older mid-rise.
  if (height >= 15 && height <= 50 && r() < 0.12) out.push([RoofItem.Tank, 3.4, 3.4, 5])
  // HVAC: commercial roofs carry more and bigger units.
  const hvac =
    family === RESIDENTIAL ? Math.min(3, Math.floor(area / 250 + r() * 1.5)) : Math.min(10, Math.max(1, Math.floor(area / 220 + r() * 2)))
  const big = family === NEUTRAL ? 1.4 : 1
  for (let i = 0; i < hvac; i++) out.push([RoofItem.Hvac, between(r, 1.3, 2.6) * big, between(r, 1, 1.8) * big, between(r, 0.9, 1.7)])
  return out
}

// Every building's roof items; buildings in `skip` (pinned landmarks) get
// none.
export function generateRooftops(b: CityData['buildings'], ringMeters: number, skip: Set<number> = new Set()): RoofPiece[] {
  const out: RoofPiece[] = []
  let c = 0
  for (let k = 0; k < b.counts.length; k++) {
    const n = b.counts[k]
    const ring = new Array<number>(2 * n)
    for (let i = 0; i < 2 * n; i++) ring[i] = b.coords[c + i] * COORD_QUANTUM
    const seed = seedOf(b.seeds[k])
    c += 2 * n
    const height = b.heights[k] * HEIGHT_QUANTUM
    if (skip.has(k) || height < MIN_HEIGHT_M) continue

    let area = 0
    let longest = 0
    let yaw = 0
    let minX = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxZ = -Infinity
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, zi, xj, zj] = [ring[2 * i], ring[2 * i + 1], ring[2 * j], ring[2 * j + 1]]
      area += xj * zi - xi * zj
      const len = Math.hypot(xi - xj, zi - zj)
      if (len > longest) {
        longest = len
        yaw = -Math.atan2(zi - zj, xi - xj)
      }
      minX = Math.min(minX, xi)
      maxX = Math.max(maxX, xi)
      minZ = Math.min(minZ, zi)
      maxZ = Math.max(maxZ, zi)
    }
    area = Math.abs(area) / 2
    if (area < MIN_ROOF_M2) continue

    const r = rng(seed)
    const family = Math.floor(b.colorIndex[k] / 3)
    const ringPos = Math.min(1, (b.ringBand[k] * RING_BAND_METERS) / ringMeters)
    const placed: { x: number; z: number; rad: number }[] = []
    for (const [kind, w, d, h] of wishList(family, height, area, r)) {
      const rad = Math.hypot(w, d) / 2
      for (let t = 0; t < TRIES; t++) {
        const x = between(r, minX, maxX)
        const z = between(r, minZ, maxZ)
        if (!cornersOf({ x, z, yaw, w, d }, EDGE_M).every(([cx, cz]) => insideRing(ring, cx, cz))) continue
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.rad + rad + GAP_M)) continue
        placed.push({ x, z, rad })
        out.push({ kind, x, y: height, z, yaw, w, d, h, building: k, ring: ringPos })
        break
      }
    }
  }
  return out
}
