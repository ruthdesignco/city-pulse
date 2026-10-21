// Bake what the land around the city is (src/data/landcover.bin; format in
// src/city/landCover.ts) on the backdrop's grid (src/data/backdrop.bin, so
// bake that first): OpenStreetMap land use and natural cover, filled on a
// SUB_M grid and averaged to each backdrop sample, so class edges come out
// soft. Plus Alcatraz's buildings, the one island in view with any.
//
//   npm run bake:landcover                    fetch if not cached, then bake
//   npm run bake:landcover -- --cached-only   bake from the cache only

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type LandBuilding, encodeLandCover } from '../src/city/landCover.ts'
import { decodeTerrain } from '../src/city/terrain.ts'
import { toLatLng, toScene } from '../src/geo/projection.ts'
import { type Pt, openRing, parseHeight, signedArea, stitchRings } from './lib/geometry.ts'
import { type Bbox, type OsmElement, fetchOverpass, fetchTiled, overpassDataTimestamps } from './lib/overpass.ts'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'src/data/landcover.bin')
const SUB_M = 10
const CLIFF_HALF_M = 10 // a cliff's line, widened each way to show as rock

// Fill classes, in paint order: a later one covers an earlier one.
const Fill = { None: 0, Urban: 1, Grass: 2, Scrub: 3, Wood: 4, Sand: 5, Rock: 6 } as const
type Fill = (typeof Fill)[keyof typeof Fill]

const BY_TAG: [string, RegExp, Fill][] = [
  ['landuse', /^(residential|commercial|retail|industrial)$/, Fill.Urban],
  ['leisure', /^(park|garden|golf_course)$/, Fill.Grass],
  ['landuse', /^(grass|meadow|recreation_ground|village_green|cemetery)$/, Fill.Grass],
  ['natural', /^(grassland|heath)$/, Fill.Grass],
  ['natural', /^scrub$/, Fill.Scrub],
  ['natural', /^wood$/, Fill.Wood],
  ['landuse', /^forest$/, Fill.Wood],
  ['natural', /^(sand|beach)$/, Fill.Sand],
  ['natural', /^(bare_rock|scree|cliff)$/, Fill.Rock],
]

function fillOf(tags: Record<string, string> | undefined): Fill {
  if (!tags) return Fill.None
  for (const [k, re, f] of BY_TAG) if (tags[k] && re.test(tags[k])) return f
  return Fill.None
}

function query(b: Bbox): string {
  const bb = `${b.south},${b.west},${b.north},${b.east}`
  return `[out:json][timeout:180];
(
  nwr["landuse"~"^(residential|commercial|retail|industrial|grass|meadow|recreation_ground|village_green|cemetery|forest)$"](${bb});
  nwr["leisure"~"^(park|garden|golf_course)$"](${bb});
  nwr["natural"~"^(grassland|heath|scrub|wood|sand|beach|bare_rock|scree|cliff)$"](${bb});
);
out geom;`
}

// Alcatraz's buildings: the larger footprints, at OSM's height or a low
// default (ruins lower still). The water tower stands on legs: left out.
const ALCATRAZ: Bbox = { south: 37.8235, west: -122.4265, north: 37.8295, east: -122.4185 }
const MIN_AREA_M2 = 60
const DEFAULT_HEIGHT_M = 7
const RUINS_HEIGHT_M = 4
const HEIGHTS: Record<string, number> = { 'Main Prison': 12 }
const SKIP = new Set(['Water Tower'])

const project = (p: { lat: number; lon: number }): Pt => {
  const s = toScene(p.lat, p.lon)
  return [s.x, s.z]
}

// An element's rings (outer and inner alike: filled even-odd).
function ringsOf(el: OsmElement): Pt[][] {
  if (el.type === 'way') {
    if (!el.geometry || el.geometry.length < 4) return []
    const ring = el.geometry.map(project)
    const [a, b] = [ring[0], ring[ring.length - 1]]
    return a[0] === b[0] && a[1] === b[1] ? [openRing(ring)] : []
  }
  if (el.type !== 'relation' || !el.members) return [] // a node: a point, no area
  const ways = (role: string) => el.members.filter((m) => m.role === role && m.geometry).map((m) => m.geometry!.map(project))
  return [...stitchRings(ways('outer')).rings, ...stitchRings(ways('inner')).rings]
}

async function main() {
  const cachedOnly = process.argv.includes('--cached-only')
  const backdrop = await decodeTerrain(readFileSync(join(ROOT, 'src/data/backdrop.bin')).buffer as ArrayBuffer)
  const { x0, z0, cell, nx, nz } = backdrop.header
  const nw = toLatLng(x0 - cell, z0 - cell)
  const se = toLatLng(x0 + nx * cell, z0 + nz * cell)
  const bbox: Bbox = { south: +se.lat.toFixed(3), west: +nw.lng.toFixed(3), north: +nw.lat.toFixed(3), east: +se.lng.toFixed(3) }
  const per = Math.round(cell / SUB_M) // sub-samples per cell each way (odd: centered)
  // The sub-grid: sample (i, j) of the backdrop is the mean of sub-cells
  // per*i .. per*i + per - 1 (and so in j), centered on it.
  const fx0 = x0 - ((per - 1) / 2) * SUB_M
  const fz0 = z0 - ((per - 1) / 2) * SUB_M
  const fw = nx * per
  const fh = nz * per
  const fine = new Uint8Array(fw * fh)

  const fillRings = (rings: Pt[][], f: Fill) => {
    let zMin = Infinity
    let zMax = -Infinity
    for (const r of rings) for (const [, z] of r) [zMin, zMax] = [Math.min(zMin, z), Math.max(zMax, z)]
    const j0 = Math.max(0, Math.ceil((zMin - fz0) / SUB_M))
    const j1 = Math.min(fh - 1, Math.floor((zMax - fz0) / SUB_M))
    const xs: number[] = []
    for (let j = j0; j <= j1; j++) {
      const z = fz0 + j * SUB_M
      xs.length = 0
      for (const r of rings)
        for (let k = 0; k < r.length; k++) {
          const [ax, az] = r[k]
          const [bx, bz] = r[(k + 1) % r.length]
          if (az <= z !== bz <= z) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax))
        }
      xs.sort((a, b) => a - b)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - fx0) / SUB_M))
        const i1 = Math.min(fw - 1, Math.floor((xs[k + 1] - fx0) / SUB_M))
        if (i1 >= i0) fine.fill(f, j * fw + i0, j * fw + i1 + 1)
      }
    }
  }
  const fillLine = (line: Pt[], f: Fill) => {
    const r = Math.ceil(CLIFF_HALF_M / SUB_M)
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, az] = line[k]
      const [bx, bz] = line[k + 1]
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (SUB_M / 2)))
      for (let s = 0; s <= steps; s++) {
        const ci = Math.round((ax + ((bx - ax) * s) / steps - fx0) / SUB_M)
        const cj = Math.round((az + ((bz - az) * s) / steps - fz0) / SUB_M)
        for (let dj = -r; dj <= r; dj++)
          for (let di = -r; di <= r; di++) {
            const [i, j] = [ci + di, cj + dj]
            if (i >= 0 && j >= 0 && i < fw && j < fh && Math.hypot(di, dj) * SUB_M <= CLIFF_HALF_M) fine[j * fw + i] = f
          }
      }
    }
  }

  const elements = await fetchTiled(bbox, 2, 3, query, { cachedOnly })
  const byFill = new Map<Fill, OsmElement[]>()
  for (const el of elements) {
    const f = fillOf(el.tags)
    if (f !== Fill.None) byFill.set(f, [...(byFill.get(f) ?? []), el])
  }
  const counts: Record<string, number> = {}
  for (const [name, f] of Object.entries(Fill)) {
    if (f === Fill.None) continue
    for (const el of byFill.get(f) ?? []) {
      if (el.tags?.natural === 'cliff' && el.type === 'way' && el.geometry) fillLine(el.geometry.map(project), f)
      else {
        const rings = ringsOf(el)
        if (rings.length) fillRings(rings, f)
      }
    }
    counts[name] = byFill.get(f)?.length ?? 0
  }

  // Average each sample's sub-cells into its four channels.
  const share: Record<Fill, [number, number, number, number]> = {
    [Fill.None]: [0, 0, 0, 0],
    [Fill.Urban]: [1, 0, 0, 0],
    [Fill.Grass]: [0, 1, 0, 0],
    [Fill.Scrub]: [0, 0.5, 0.5, 0],
    [Fill.Wood]: [0, 0, 1, 0],
    [Fill.Sand]: [0, 0, 0, 0.5],
    [Fill.Rock]: [0, 0, 0, 1],
  }
  const rgba = new Uint8Array(nx * nz * 4)
  const totals = [0, 0, 0, 0]
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const sum = [0, 0, 0, 0]
      for (let b = 0; b < per; b++)
        for (let a = 0; a < per; a++) {
          const s = share[fine[(j * per + b) * fw + i * per + a] as Fill]
          for (let c = 0; c < 4; c++) sum[c] += s[c]
        }
      for (let c = 0; c < 4; c++) {
        const v = Math.round((255 * sum[c]) / (per * per))
        rgba[(j * nx + i) * 4 + c] = v
        totals[c] += v / 255
      }
    }

  const buildings: LandBuilding[] = []
  const alcatraz = `[out:json][timeout:60];\nway["building"](${ALCATRAZ.south},${ALCATRAZ.west},${ALCATRAZ.north},${ALCATRAZ.east});\nout tags geom;`
  for (const el of await fetchOverpass(alcatraz, undefined, { cachedOnly })) {
    const name = el.tags?.name
    if (name && SKIP.has(name)) continue
    const [ring] = ringsOf(el)
    if (!ring) continue
    const area = signedArea(ring)
    if (Math.abs(area) < MIN_AREA_M2) continue
    const height = (name && HEIGHTS[name]) || parseHeight(el.tags?.height) || (el.tags?.building === 'ruins' ? RUINS_HEIGHT_M : DEFAULT_HEIGHT_M)
    // Counterclockwise seen from above: scene z runs south, so negative
    // signed area in (x, z).
    const ccw = area < 0 ? ring : [...ring].reverse()
    buildings.push({ ring: ccw.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]), height, ...(name ? { name } : {}) })
  }

  const out = await encodeLandCover({
    header: {
      version: 1,
      x0,
      z0,
      cell,
      nx,
      nz,
      buildings,
      source: `OpenStreetMap contributors (ODbL), Overpass ${[...overpassDataTimestamps].sort()[0] ?? 'unknown'}`,
      bakedAt: new Date().toISOString(),
    },
    rgba,
  })
  writeFileSync(OUT, out)
  const pct = (v: number) => `${((100 * v) / (nx * nz)).toFixed(1)}%`
  console.log(`landcover: ${nx} x ${nz} at ${cell} m; elements ${JSON.stringify(counts)}`)
  console.log(`  of the box: urban ${pct(totals[0])}, grass ${pct(totals[1])}, wood ${pct(totals[2])}, rock ${pct(totals[3])}`)
  console.log(`  Alcatraz: ${buildings.length} buildings (${buildings.map((b) => `${b.name ?? '?'} ${b.height} m`).join(', ')})`)
  console.log(`src/data/landcover.bin: ${(out.length / 1024).toFixed(0)} KB`)
}

await main()
