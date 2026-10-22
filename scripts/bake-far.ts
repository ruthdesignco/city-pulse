// Bake the city seen from afar (src/city/farFormat.ts) from the tiles: each
// tile's buildings merged into low prisms, its woods as canopy cells, and
// the ground each landmark model stands on. Run after `npm run bake` and
// `npm run bake:terrain` (it reads both); bake:trees doesn't matter to it.
//
//   npm run bake:far
//
// Blocks: buildings that touch or nearly touch (within a raster cell,
// CELL_M) are one block, drawn as the smallest box around their outlines
// at the height that keeps the block's built volume (their areas times
// heights, over the box's): lower than its buildings, since the box takes
// in yards and light wells. Towers (TOWER_M and up) stand on their own, in
// their own outline, so the skyline keeps its shape.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HEIGHT_QUANTUM, RING_BAND_METERS, type CityTile, toLines } from '../src/city/format.ts'
import { woodedTest } from './lib/cover.ts'
import { FAR_CANOPY_CELLS, FAR_CANOPY_CELL_M, type FarTile, encodeFar } from '../src/city/farFormat.ts'
import { landmarkGround } from '../src/city/landmarks/registry.ts'
import { type Pt, convexHull, minAreaRect, pointInRing, signedArea } from './lib/geometry.ts'
import { loadShippedCity } from './lib/shippedCity.ts'
import { TILES_DIR, writeIndex } from './lib/tileFiles.ts'

const CELL_M = 2
export const TOWER_M = 35
const MIN_BLOCK_M = 3

// Union-find over n items: the groups `link` joins.
function groups(n: number, link: (union: (a: number, b: number) => void) => void): number[][] {
  const parent = Int32Array.from({ length: n }, (_, k) => k)
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]]
    return a
  }
  link((a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  })
  const out = new Map<number, number[]>()
  for (let k = 0; k < n; k++) {
    const r = find(k)
    let g = out.get(r)
    if (!g) out.set(r, (g = []))
    g.push(k)
  }
  return [...out.values()]
}

// Which of `rings` touch or nearly touch: each filled into a CELL_M raster
// by its cells' centers (a sliver narrower than a cell by the cell under
// its middle), then neighboring cells' owners joined.
export function touching(rings: Pt[][]): number[][] {
  if (rings.length === 0) return []
  let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const r of rings) for (const [x, z] of r) [minX, minZ, maxX, maxZ] = [Math.min(minX, x), Math.min(minZ, z), Math.max(maxX, x), Math.max(maxZ, z)]
  const x0 = minX - 2 * CELL_M
  const z0 = minZ - 2 * CELL_M
  const nx = Math.ceil((maxX - x0) / CELL_M) + 3
  const nz = Math.ceil((maxZ - z0) / CELL_M) + 3
  const owner = new Int32Array(nx * nz).fill(-1)
  const xs: number[] = []
  rings.forEach((r, k) => {
    const rz = r.map((p) => p[1])
    const j0 = Math.max(0, Math.floor((Math.min(...rz) - z0) / CELL_M))
    const j1 = Math.min(nz - 1, Math.ceil((Math.max(...rz) - z0) / CELL_M))
    for (let j = j0; j <= j1; j++) {
      const z = z0 + (j + 0.5) * CELL_M
      xs.length = 0
      for (let a = 0; a < r.length; a++) {
        const [ax, az] = r[a]
        const [bx, bz] = r[(a + 1) % r.length]
        if (az <= z !== bz <= z) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax))
      }
      xs.sort((p, q) => p - q)
      for (let c = 0; c + 1 < xs.length; c += 2) {
        const i0 = Math.ceil((xs[c] - x0) / CELL_M - 0.5)
        const i1 = Math.floor((xs[c + 1] - x0) / CELL_M - 0.5)
        if (i1 < i0) owner[j * nx + Math.floor(((xs[c] + xs[c + 1]) / 2 - x0) / CELL_M)] = k
        for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) owner[j * nx + i] = k
      }
    }
  })
  return groups(rings.length, (union) => {
    for (let j = 0; j < nz - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const a = owner[j * nx + i]
        if (a < 0) continue
        for (const b of [owner[j * nx + i + 1], owner[(j + 1) * nx + i - 1], owner[(j + 1) * nx + i], owner[(j + 1) * nx + i + 1]]) if (b >= 0 && b !== a) union(a, b)
      }
  })
}

// A minAreaRect's corners, counterclockwise (signedArea > 0).
function box(r: ReturnType<typeof minAreaRect>): Pt[] {
  const c = Math.cos(r.angle)
  const s = Math.sin(r.angle)
  const out = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]): Pt => [r.center[0] + ((u * r.sizeX) / 2) * c - ((v * r.sizeZ) / 2) * s, r.center[1] + ((u * r.sizeX) / 2) * s + ((v * r.sizeZ) / 2) * c])
  return signedArea(out) < 0 ? out.reverse() : out
}

interface Prism {
  ring: Pt[]
  base: number
  height: number
  colorIndex: number
  ring01: number
}

export function farTile(t: CityTile, ringMeters: number, heightAt: (x: number, z: number) => number): FarTile {
  const b = t.buildings
  const rings: Pt[][] = []
  let c = 0
  for (const n of b.counts) {
    const r: Pt[] = []
    for (let i = 0; i < n; i++, c += 2) r.push([b.coords[c], b.coords[c + 1]])
    rings.push(r)
  }
  const heightOf = (k: number) => b.heights[k] * HEIGHT_QUANTUM
  const ringOf = (k: number) => Math.min(1, (b.ringBand[k] * RING_BAND_METERS) / ringMeters)
  const prisms: Prism[] = []
  // On the lowest ground under its outline, its top its height above the
  // outline's average ground, as the buildings stand (extrude.ts).
  const stand = (ring: Pt[], height: number, colorIndex: number, ring01: number) => {
    const g = ring.map(([x, z]) => heightAt(x, z))
    const base = Math.min(...g)
    prisms.push({ ring, base, height: g.reduce((s, v) => s + v, 0) / g.length - base + height, colorIndex, ring01 })
  }
  const low: number[] = []
  rings.forEach((r, k) => (heightOf(k) >= TOWER_M ? stand(r, heightOf(k), b.colorIndex[k], ringOf(k)) : low.push(k)))
  for (const g of touching(low.map((k) => rings[k]))) {
    const members = g.map((m) => low[m])
    const points = members.flatMap((k) => rings[k])
    if (convexHull(points).length < 3) continue
    const hull = box(minAreaRect(points))
    let volume = 0
    let biggest = members[0]
    let biggestArea = 0
    let ring01 = 1
    for (const k of members) {
      const a = Math.abs(signedArea(rings[k]))
      volume += a * heightOf(k)
      if (a > biggestArea) [biggest, biggestArea] = [k, a]
      ring01 = Math.min(ring01, ringOf(k))
    }
    const tallest = Math.max(...members.map(heightOf))
    stand(hull, Math.min(tallest, Math.max(MIN_BLOCK_M, volume / signedArea(hull))), b.colorIndex[biggest], ring01)
  }

  // The woods' canopy: the cells whose centers are wooded (cover.ts
  // woodedTest: OSM's woods, the wooded parks' land), clear of buildings.
  const wooded = woodedTest(t.cover)
  const inBuilding = (x: number, z: number) => rings.some((r) => pointInRing([x, z], r))
  const cells: number[] = []
  const ground: number[] = []
  for (let bz = 0; bz < FAR_CANOPY_CELLS; bz++)
    for (let a = 0; a < FAR_CANOPY_CELLS; a++) {
      const p: Pt = [t.header.x0 + (a + 0.5) * FAR_CANOPY_CELL_M, t.header.z0 + (bz + 0.5) * FAR_CANOPY_CELL_M]
      if (!wooded(p[0], p[1]) || inBuilding(p[0], p[1])) continue
      cells.push(a + bz * FAR_CANOPY_CELLS)
      ground.push(heightAt(p[0], p[1]))
    }

  return {
    i: t.header.i,
    j: t.header.j,
    prisms: {
      ...toLines(prisms.map((p) => p.ring)),
      base: Float32Array.from(prisms, (p) => p.base),
      height: Float32Array.from(prisms, (p) => p.height),
      colorIndex: Uint8Array.from(prisms, (p) => p.colorIndex),
      ring: Float32Array.from(prisms, (p) => p.ring01),
    },
    canopy: { cells: Uint16Array.from(cells), ground: Float32Array.from(ground) },
  }
}

async function main() {
  const started = Date.now()
  const s = await loadShippedCity()
  const { index } = s
  if (s.terrain.size === 0) throw new Error('bake:far: no terrain tiles. Run `npm run bake:terrain` first.')
  // An outline can reach past its tile's ground into one with none (open
  // water): sea level there.
  const heightAt = (x: number, z: number) => {
    try {
      return s.heightAt(x, z)
    } catch {
      return 0
    }
  }
  const tiles = s.tiles.map((t) => farTile(t, index.ringMeters, heightAt))
  const landmarkY: Record<string, number> = {}
  for (const at of index.landmarkModels) landmarkY[at.id] = Math.round(landmarkGround(at, heightAt) * 100) / 100
  const bytes = await encodeFar({ header: { version: 1, tiles: [], landmarkY, bakedAt: new Date().toISOString() }, tiles })
  const file = `far-${createHash('sha256').update(bytes).digest('hex').slice(0, 10)}.bin`
  writeFileSync(join(TILES_DIR, file), bytes)
  if (existsSync(TILES_DIR)) for (const f of readdirSync(TILES_DIR)) if (f.startsWith('far-') && f !== file) rmSync(join(TILES_DIR, f))
  writeIndex({ ...index, far: { file, bytes: bytes.length } })

  const prisms = tiles.reduce((n, t) => n + t.prisms.counts.length, 0)
  const canopy = tiles.reduce((n, t) => n + t.canopy.cells.length, 0)
  const buildings = s.tiles.reduce((n, t) => n + t.buildings.counts.length, 0)
  console.log(`far: ${buildings} buildings as ${prisms} prisms, ${canopy} canopy cells (${((canopy * FAR_CANOPY_CELL_M ** 2) / 1e6).toFixed(2)} km²)`)
  console.log(`landmarks stand at ${Object.entries(landmarkY).map(([id, y]) => `${id} ${y} m`).join(', ')}`)
  console.log(`${file}: ${(bytes.length / 1024).toFixed(0)} KB, baked in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

if (import.meta.main) await main()
