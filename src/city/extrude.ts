// Turn baked footprints into one merged, flat-shaded mesh: one draw call for
// a tile's buildings (Buildings.tsx). Walls get their own vertices per edge
// so normals stay crisp.

import { ShapeUtils, Vector2 } from 'three'
import { type CityData, HEIGHT_QUANTUM, RING_BAND_METERS } from './format.ts'
import { type StreetFrontage, hasStorefront } from './frontage.ts'

export interface CityMesh {
  positions: Float32Array
  normals: Float32Array
  ring: Float32Array // 0 inside the three neighborhoods, up to 1 at the ring's outer edge
  colorIndex: Float32Array // scripts/lib/buildingColor.ts: BuildingColorType*3 + buildingVariant, per vertex
  // For the facade windows (facade.ts), 4 per vertex: distance along this
  // wall from its start (m), the wall's length (m), the building's height
  // (m), and a per-building seed in [0, 1). Roof vertices have 0 for the
  // first two.
  facade: Float32Array
  // facade.ts PinnedMaterial per vertex: 0 (the random choice) unless pinned.
  material: Float32Array
  // 1 on walls with a ground-floor storefront (frontage.ts), else 0.
  storefront: Float32Array
  // Height above the building's base (the facade's floors count from it);
  // positions add the ground under it.
  localY: Float32Array
  index: Uint32Array
}

// A stable per-building seed from its first footprint point in 0.1 m units
// (the bake stores it: the tiles' buildings.seeds), so a building keeps its
// window pattern across rebakes and coordinate formats.
export const SEED_UNIT_M = 0.1
export function seedHash(x: number, z: number): number {
  let h = Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(z | 0, 0x85ebca77)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h ^= h >>> 13
  return h >>> 0
}

// The seed in [0, 1).
export function seedOf(hash: number): number {
  return hash / 4294967296
}

// Where a building stands on sloping ground (terrain.ts): its walls start
// at the lowest ground under its footprint, so no corner floats, and its
// roof is its height above the footprint's average ground; `extra` is how
// much taller that makes the walls than the height itself.
export function buildingGround(pts: [number, number][], groundAt: (x: number, z: number) => number): { base: number; extra: number } {
  let lo = Infinity
  let sum = 0
  for (const [x, z] of pts) {
    const g = groundAt(x, z)
    lo = Math.min(lo, g)
    sum += g
  }
  return pts.length ? { base: lo, extra: sum / pts.length - lo } : { base: 0, extra: 0 }
}

const flatGround = () => 0

// With `frontage` (the streets, frontage.ts), walls that front one may get
// a storefront; `groundAt` stands each building on the terrain
// (buildingGround).
export function extrudeBuildings(
  b: CityData['buildings'],
  ringMeters = 600,
  pinned: { building: number; material: number }[] = [],
  frontage: StreetFrontage | null = null,
  groundAt: (x: number, z: number) => number = flatGround,
): CityMesh {
  let verts = 0
  let tris = 0
  for (const n of b.counts) {
    verts += n * 4 + n
    tris += n * 2 + (n - 2)
  }
  const positions = new Float32Array(verts * 3)
  const normals = new Float32Array(verts * 3)
  const ring = new Float32Array(verts)
  const colorIndex = new Float32Array(verts)
  const facade = new Float32Array(verts * 4)
  const material = new Float32Array(verts)
  const storefront = new Float32Array(verts)
  const localY = new Float32Array(verts)
  const pinnedBy = new Map(pinned.map((p) => [p.building, p.material]))
  const index = new Uint32Array(tris * 3)

  let v = 0
  let t = 0
  let c = 0
  // Per building and per wall, set before its vertices are put.
  let height = 0
  let seed = 0
  let wallLen = 0
  let mat = 0
  let shop = 0
  let ground = 0
  const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, ci: number, wallU = 0) => {
    positions.set([x, ground + y, z], v * 3)
    localY[v] = y
    normals.set([nx, ny, nz], v * 3)
    ring[v] = r
    colorIndex[v] = ci
    facade.set([wallU, ny > 0.5 ? 0 : wallLen, height, seed], v * 4)
    material[v] = mat
    storefront[v] = ny > 0.5 ? 0 : shop
    return v++
  }

  for (let k = 0; k < b.counts.length; k++) {
    const n = b.counts[k]
    const tall = b.heights[k] * HEIGHT_QUANTUM
    const r = Math.min(1, (b.ringBand[k] * RING_BAND_METERS) / ringMeters)
    const ci = b.colorIndex[k]
    const pts: [number, number][] = []
    seed = seedOf(b.seeds[k])
    mat = pinnedBy.get(k) ?? 0
    for (let i = 0; i < n; i++, c += 2) pts.push([b.coords[c], b.coords[c + 1]])
    const g = buildingGround(pts, groundAt)
    ground = g.base
    // Its walls, from the lowest ground under it to its roof.
    const h = tall + g.extra
    height = h

    // Walls. Rings have signedArea(x, z) > 0, so for edge direction (dx, dz)
    // the outward normal is (dz, -dx).
    for (let i = 0; i < n; i++) {
      const [x0, z0] = pts[i]
      const [x1, z1] = pts[(i + 1) % n]
      const len = Math.hypot(x1 - x0, z1 - z0) || 1
      const nx = (z1 - z0) / len
      const nz = -(x1 - x0) / len
      wallLen = len
      shop = frontage && hasStorefront(frontage.classOf(x0, z0, x1, z1, nx, nz), Math.floor(ci / 3), seed, tall, len) ? 1 : 0
      const a = put(x0, 0, z0, nx, 0, nz, r, ci, 0)
      const bb = put(x1, 0, z1, nx, 0, nz, r, ci, len)
      const cc = put(x1, h, z1, nx, 0, nz, r, ci, len)
      const d = put(x0, h, z0, nx, 0, nz, r, ci, 0)
      index.set([a, cc, bb, a, d, cc], t)
      t += 6
    }

    // Roof: earcut via three's ShapeUtils, then wind each triangle so its
    // face points up (+y).
    const base = v
    for (const [x, z] of pts) put(x, h, z, 0, 1, 0, r, ci)
    const faces = ShapeUtils.triangulateShape(
      pts.map(([x, z]) => new Vector2(x, z)),
      [],
    )
    for (const [i0, i1, i2] of faces) {
      const [ax, az] = pts[i0]
      const [bx, bz] = pts[i1]
      const [cx, cz] = pts[i2]
      // y-component of (b - a) x (c - a) in 3D with points (x, h, z)
      const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
      index.set(up > 0 ? [base + i0, base + i1, base + i2] : [base + i0, base + i2, base + i1], t)
      t += 3
    }
  }

  // Degenerate rings can make earcut return fewer triangles than n - 2.
  return { positions, normals, ring, colorIndex, facade, material, storefront, localY, index: t === index.length ? index : index.slice(0, t) }
}

// Plain prisms, for buildings at middle distance and the far blocks
// (stream/lod.ts): each outline's corners once at its foot and once at its
// top, shared by its walls and roof (the shader shades them flat from the
// screen's derivatives), and per corner what the averaged facade needs
// (facade.ts FACADE_AVERAGE): `prism` = (colorIndex + 10 * pinned
// material, ring, height, seed) and its height above the foot. A third of
// a full extrusion's vertices, and a fifth of its bytes.
export interface PrismMesh {
  positions: Float32Array
  prism: Float32Array // 4 per vertex
  localY: Float32Array
  index: Uint32Array
}

export interface PrismInput {
  counts: Uint16Array
  coords: Float32Array
  // Per outline: its foot (m), its walls' height above it, and its look.
  base: (k: number, pts: [number, number][]) => { base: number; height: number }
  colorIndex: ArrayLike<number>
  material: (k: number) => number
  ring: (k: number) => number
  seed: (k: number) => number
}

export function extrudePrisms(p: PrismInput): PrismMesh {
  let verts = 0
  let tris = 0
  for (const n of p.counts) {
    verts += 2 * n
    tris += 2 * n + (n - 2)
  }
  const positions = new Float32Array(verts * 3)
  const prism = new Float32Array(verts * 4)
  const localY = new Float32Array(verts)
  const index = new Uint32Array(tris * 3)
  let v = 0
  let t = 0
  let c = 0
  for (let k = 0; k < p.counts.length; k++) {
    const n = p.counts[k]
    const pts: [number, number][] = []
    for (let i = 0; i < n; i++, c += 2) pts.push([p.coords[c], p.coords[c + 1]])
    const { base, height } = p.base(k, pts)
    const look = [p.colorIndex[k] + 10 * p.material(k), p.ring(k), height, p.seed(k)]
    const foot = v
    for (const [x, z] of pts) {
      positions.set([x, base, z], v * 3)
      prism.set(look, v * 4)
      localY[v++] = 0
    }
    const top = v
    for (const [x, z] of pts) {
      positions.set([x, base + height, z], v * 3)
      prism.set(look, v * 4)
      localY[v++] = height
    }
    // Walls: rings run counterclockwise (signedArea > 0), as extrudeBuildings'.
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      index.set([foot + i, top + j, foot + j, foot + i, top + i, top + j], t)
      t += 6
    }
    const faces = ShapeUtils.triangulateShape(
      pts.map(([x, z]) => new Vector2(x, z)),
      [],
    )
    for (const [i0, i1, i2] of faces) {
      const [ax, az] = pts[i0]
      const [bx, bz] = pts[i1]
      const [cx, cz] = pts[i2]
      const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
      index.set(up > 0 ? [top + i0, top + i1, top + i2] : [top + i0, top + i2, top + i1], t)
      t += 3
    }
  }
  return { positions, prism, localY, index: t === index.length ? index : index.slice(0, t) }
}

// A closed ring's corners that stray more than `tolerance` m from the line
// between their neighbors' kept corners (Douglas-Peucker, split at its two
// furthest points); at least a triangle.
export function simplifyOutline(pts: [number, number][], tolerance: number): [number, number][] {
  if (pts.length <= 4) return pts
  const keep = new Uint8Array(pts.length)
  const far = (a: number, b: number) => {
    let best = -1
    let bestD = tolerance
    const [ax, az] = pts[a]
    const [bx, bz] = pts[b % pts.length]
    const len = Math.hypot(bx - ax, bz - az) || 1
    for (let k = a + 1; k < b; k++) {
      const [px, pz] = pts[k]
      const d = Math.abs((bx - ax) * (az - pz) - (ax - px) * (bz - az)) / len
      if (d > bestD) [best, bestD] = [k, d]
    }
    return best
  }
  const split = (a: number, b: number) => {
    const k = far(a, b)
    if (k < 0) return
    keep[k] = 1
    split(a, k)
    split(k, b)
  }
  // The corner furthest from the first splits the ring in two.
  let m = 1
  for (let k = 2; k < pts.length; k++) if (Math.hypot(pts[k][0] - pts[0][0], pts[k][1] - pts[0][1]) > Math.hypot(pts[m][0] - pts[0][0], pts[m][1] - pts[0][1])) m = k
  keep[0] = keep[m] = 1
  split(0, m)
  split(m, pts.length)
  const out = pts.filter((_, k) => keep[k])
  return out.length >= 3 ? out : pts
}

// Mid-distance outlines lose corners under this (a few pixels at most).
const MID_OUTLINE_M = 1.5

// A tile's buildings as plain prisms, stood as extrudeBuildings stands them,
// their outlines simplified (MID_OUTLINE_M).
export function extrudeMid(b: CityData['buildings'], ringMeters: number, pinned: { building: number; material: number }[], groundAt: (x: number, z: number) => number): PrismMesh {
  const pinnedBy = new Map(pinned.map((x) => [x.building, x.material]))
  const rings: [number, number][][] = []
  let c = 0
  for (const n of b.counts) {
    const r: [number, number][] = []
    for (let i = 0; i < n; i++, c += 2) r.push([b.coords[c], b.coords[c + 1]])
    rings.push(simplifyOutline(r, MID_OUTLINE_M))
  }
  return extrudePrisms({
    counts: Uint16Array.from(rings, (r) => r.length),
    coords: Float32Array.from(rings.flat(2)),
    base: (k, pts) => {
      const g = buildingGround(pts, groundAt)
      return { base: g.base, height: b.heights[k] * HEIGHT_QUANTUM + g.extra }
    },
    colorIndex: b.colorIndex,
    material: (k) => pinnedBy.get(k) ?? 0,
    ring: (k) => Math.min(1, (b.ringBand[k] * RING_BAND_METERS) / ringMeters),
    seed: (k) => seedOf(b.seeds[k]),
  })
}
