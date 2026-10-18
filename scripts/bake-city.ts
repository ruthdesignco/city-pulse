// Bake OSM buildings and streets for SoMa, the Mission and the Tenderloin
// (plus a dimmer context ring) into public/city.bin.
//
//   npm run bake
//
// Inputs:  scripts/data/analysis-neighborhoods.geojson (DataSF)
//          OpenStreetMap via Overpass, cached in scripts/.cache/
// Output:  public/city.bin (see src/city/format.ts)

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COORD_QUANTUM,
  HEIGHT_QUANTUM,
  RING_BAND_METERS,
  StreetClass,
  type CityData,
  type Landmark,
  encodeCity,
} from '../src/city/format.ts'
import { ORIGIN, toScene } from '../src/geo/projection.ts'
import {
  type Pt,
  centroid,
  distToRing,
  openRing,
  parseHeight,
  pointInRing,
  signedArea,
  simplifyLine,
  simplifyRing,
  stitchRings,
} from './lib/geometry.ts'
import { type Bbox, type OsmElement, type OsmGeomPoint, cityQuery, fetchTiled } from './lib/overpass.ts'

const ROOT = join(import.meta.dirname, '..')
const NEIGHBORHOODS = ['South of Market', 'Mission', 'Tenderloin']
const RING_METERS = 600
// Cluster bbox padded ~650 m. Must stay fixed: it's part of the cache key.
const QUERY_BBOX: Bbox = { south: 37.7418, west: -122.4344, north: 37.7943, east: -122.3852 }
const TILES = 3

const SIMPLIFY_BUILDING_M = 0.75
const SIMPLIFY_STREET_M = 1.0
const MIN_FOOTPRINT_M2 = 15
const METERS_PER_LEVEL = 3.2
const DEFAULT_HEIGHT_M = 8
const SKIP_BUILDING_VALUES = new Set(['no', 'roof', 'construction', 'demolished', 'collapsed', 'ruins'])

const project = (p: OsmGeomPoint): Pt => {
  const s = toScene(p.lat, p.lon)
  return [s.x, s.z]
}

// ---------------------------------------------------------------- boundary

interface GeoJsonFeature {
  properties: { nhood: string }
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }
}

function loadBoundary(): Pt[][] {
  const fc = JSON.parse(readFileSync(join(ROOT, 'scripts/data/analysis-neighborhoods.geojson'), 'utf8'))
  const rings: Pt[][] = []
  for (const name of NEIGHBORHOODS) {
    const f = (fc.features as GeoJsonFeature[]).find((x) => x.properties.nhood === name)
    if (!f) throw new Error(`boundary: no feature named ${JSON.stringify(name)}`)
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][]
    for (const poly of polys) {
      if (poly.length > 1) console.warn(`boundary: ${name} has ${poly.length - 1} hole(s); ignoring holes`)
      rings.push(openRing(poly[0].map(([lng, lat]) => project({ lat, lon: lng }))))
    }
  }
  return rings
}

// ------------------------------------------------------------- buildings

interface Footprint {
  osm: string
  ring: Pt[]
  tags: Record<string, string>
}

const stats = {
  outlines: 0,
  parts: 0,
  relationRingsUnclosed: 0,
  holesIgnored: 0,
  skippedByValue: 0,
  tooSmall: 0,
  outsideRing: 0,
  heightFrom: { height: 0, levels: 0, parts: 0, default: 0 },
  badHeightValues: new Map<string, number>(),
}

function footprintsOf(el: OsmElement, tags: Record<string, string>): Footprint[] {
  const osm = `${el.type}/${el.id}`
  if (el.type === 'way') {
    if (!el.geometry || el.geometry.length < 4) return []
    const ring = el.geometry.map(project)
    const first = ring[0]
    const last = ring[ring.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) return [] // unclosed building way: broken data
    return [{ osm, ring: openRing(ring), tags }]
  }
  const outers = el.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry!.map(project))
  stats.holesIgnored += el.members.filter((m) => m.role === 'inner').length
  const { rings, unclosed } = stitchRings(outers)
  stats.relationRingsUnclosed += unclosed
  return rings.map((ring) => ({ osm, ring, tags }))
}

function heightOf(tags: Record<string, string>): { meters?: number; source?: 'height' | 'levels' } {
  const h = parseHeight(tags.height)
  if (h !== undefined) return { meters: h, source: 'height' }
  if (tags.height) stats.badHeightValues.set(tags.height, (stats.badHeightValues.get(tags.height) ?? 0) + 1)
  const levels = Number(tags['building:levels'])
  if (Number.isFinite(levels) && levels > 0 && levels < 150) return { meters: levels * METERS_PER_LEVEL, source: 'levels' }
  return {}
}

// Bucket grid so each outline only checks nearby parts.
class Grid<T> {
  private cells = new Map<string, T[]>()
  private readonly size: number
  constructor(size: number) {
    this.size = size
  }
  private key(x: number, z: number) {
    return `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`
  }
  add(p: Pt, item: T) {
    const k = this.key(p[0], p[1])
    const cell = this.cells.get(k)
    if (cell) cell.push(item)
    else this.cells.set(k, [item])
  }
  near(ring: Pt[]): T[] {
    const xs = ring.map((p) => p[0])
    const zs = ring.map((p) => p[1])
    const out: T[] = []
    for (let gx = Math.floor(Math.min(...xs) / this.size); gx <= Math.floor(Math.max(...xs) / this.size); gx++)
      for (let gz = Math.floor(Math.min(...zs) / this.size); gz <= Math.floor(Math.max(...zs) / this.size); gz++)
        out.push(...(this.cells.get(`${gx},${gz}`) ?? []))
    return out
  }
}

interface BakedBuilding {
  ring: Pt[]
  height: number
  ringBand: number
  name?: string
  center: Pt
}

function bakeBuildings(elements: OsmElement[], boundary: Pt[][]): BakedBuilding[] {
  const outlines: Footprint[] = []
  const partGrid = new Grid<{ center: Pt; height: number }>(100)

  for (const el of elements) {
    const tags = el.tags ?? {}
    if (tags.building) {
      if (SKIP_BUILDING_VALUES.has(tags.building)) {
        stats.skippedByValue++
        continue
      }
      for (const f of footprintsOf(el, tags)) outlines.push(f)
    } else if (tags['building:part'] && tags['building:part'] !== 'no') {
      for (const f of footprintsOf(el, tags)) {
        const { meters } = heightOf(tags)
        if (meters === undefined) continue
        stats.parts++
        partGrid.add(centroid(f.ring), { center: centroid(f.ring), height: meters })
      }
    }
  }
  stats.outlines = outlines.length

  const baked: BakedBuilding[] = []
  for (const f of outlines) {
    const center = centroid(f.ring)
    let ringBand = 0
    if (!boundary.some((b) => pointInRing(center, b))) {
      const d = Math.min(...boundary.map((b) => distToRing(center, b)))
      if (d > RING_METERS) {
        stats.outsideRing++
        continue
      }
      ringBand = Math.max(1, Math.ceil(d / RING_BAND_METERS))
    }

    let ring = simplifyRing(f.ring, SIMPLIFY_BUILDING_M)
    const area = signedArea(ring)
    if (ring.length < 3 || Math.abs(area) < MIN_FOOTPRINT_M2) {
      stats.tooSmall++
      continue
    }
    if (area < 0) ring = [...ring].reverse()

    // v1 rule (agreed): keep only the outline; if it has building:parts,
    // it gets the tallest part's height when that's taller than its own.
    let { meters, source } = heightOf(f.tags) as { meters?: number; source?: keyof typeof stats.heightFrom }
    const partMax = Math.max(0, ...partGrid.near(ring).filter((p) => pointInRing(p.center, ring)).map((p) => p.height))
    if (partMax > (meters ?? 0)) {
      meters = partMax
      source = 'parts'
    }
    if (meters === undefined) {
      meters = DEFAULT_HEIGHT_M
      source = 'default'
    }
    stats.heightFrom[source!]++

    baked.push({ ring, height: meters, ringBand, name: f.tags.name, center })
  }
  return baked
}

// --------------------------------------------------------------- streets

const STREET_CLASS: Record<string, number> = {
  motorway: StreetClass.Major,
  trunk: StreetClass.Major,
  primary: StreetClass.Major,
  motorway_link: StreetClass.Major,
  trunk_link: StreetClass.Major,
  primary_link: StreetClass.Major,
  secondary: StreetClass.Minor,
  tertiary: StreetClass.Minor,
  secondary_link: StreetClass.Minor,
  tertiary_link: StreetClass.Minor,
}

// Keep only the runs of each street inside the cluster + ring, so streets
// end where the buildings do instead of trailing off into empty ground.
function bakeStreets(elements: OsmElement[], boundary: Pt[][]): { line: Pt[]; cls: number }[] {
  const within = (p: Pt) =>
    boundary.some((b) => pointInRing(p, b)) || Math.min(...boundary.map((b) => distToRing(p, b))) <= RING_METERS
  const out: { line: Pt[]; cls: number }[] = []
  for (const el of elements) {
    if (el.type !== 'way' || !el.tags?.highway || !el.geometry) continue
    const cls = STREET_CLASS[el.tags.highway] ?? StreetClass.Local
    let run: Pt[] = []
    const flush = () => {
      if (run.length >= 2) out.push({ line: simplifyLine(run, SIMPLIFY_STREET_M), cls })
      run = []
    }
    for (const g of el.geometry) {
      const p = project(g)
      if (within(p)) run.push(p)
      else flush()
    }
    flush()
  }
  return out
}

// --------------------------------------------------------------- encode

function quantize(v: number): number {
  const q = Math.round(v / COORD_QUANTUM)
  if (q < -32768 || q > 32767) throw new Error(`coordinate ${v.toFixed(1)} m is outside the Int16 range`)
  return q
}

function packLines(lines: Pt[][]): { counts: Uint16Array; coords: Int16Array } {
  const counts = new Uint16Array(lines.length)
  const coords = new Int16Array(lines.reduce((n, l) => n + l.length * 2, 0))
  let i = 0
  lines.forEach((l, k) => {
    if (l.length > 65535) throw new Error(`line with ${l.length} points exceeds Uint16`)
    counts[k] = l.length
    for (const [x, z] of l) {
      coords[i++] = quantize(x)
      coords[i++] = quantize(z)
    }
  })
  return { counts, coords }
}

// ----------------------------------------------------------------- main

async function main() {
  const started = Date.now()
  const boundary = loadBoundary()
  console.log(`boundary: ${boundary.length} rings, ${boundary.reduce((n, r) => n + r.length, 0)} points`)

  const elements = await fetchTiled(QUERY_BBOX, TILES, TILES, cityQuery)
  console.log(`osm: ${elements.length} elements after tile dedupe`)

  const buildings = bakeBuildings(elements, boundary)
  const streets = bakeStreets(elements, boundary)

  const tallest = [...buildings].sort((a, b) => b.height - a.height).slice(0, 10)
  const landmarks: Landmark[] = tallest
    .filter((b) => b.name)
    .map((b) => ({ name: b.name!, x: b.center[0], z: b.center[1], height: b.height }))

  const b = packLines(buildings.map((x) => x.ring))
  const s = packLines(streets.map((x) => x.line))
  const n = packLines(boundary)
  const data: CityData = {
    header: {
      version: 1,
      origin: ORIGIN,
      ringMeters: RING_METERS,
      attribution: '© OpenStreetMap contributors (ODbL) · Neighborhoods: DataSF',
      osmTimestamp: null,
      bakedAt: new Date().toISOString(),
      landmarks,
    },
    buildings: {
      counts: b.counts,
      heights: Uint16Array.from(buildings, (x) => Math.round(x.height / HEIGHT_QUANTUM)),
      ringBand: Uint8Array.from(buildings, (x) => Math.min(255, x.ringBand)),
      coords: b.coords,
    },
    streets: { counts: s.counts, classes: Uint8Array.from(streets, (x) => x.cls), coords: s.coords },
    boundary: n,
  }
  const bytes = encodeCity(data)
  writeFileSync(join(ROOT, 'public/city.bin'), bytes)

  // ------------------------------------------------------------- report
  const core = buildings.filter((x) => x.ringBand === 0).length
  console.log(`\nbuildings: ${buildings.length} kept (${core} in the three neighborhoods, ${buildings.length - core} in the ring)`)
  console.log(`  outlines seen ${stats.outlines}, parts with heights ${stats.parts}`)
  console.log(`  dropped: ${stats.outsideRing} beyond ring, ${stats.tooSmall} under ${MIN_FOOTPRINT_M2} m², ${stats.skippedByValue} by building=* value`)
  console.log(`  multipolygon: ${stats.relationRingsUnclosed} outer rings could not be closed, ${stats.holesIgnored} inner rings (courtyards) ignored`)
  const hf = stats.heightFrom
  const pct = (v: number) => `${((100 * v) / buildings.length).toFixed(1)}%`
  console.log(`  height source: height ${pct(hf.height)}, levels ${pct(hf.levels)}, parts ${pct(hf.parts)}, default ${DEFAULT_HEIGHT_M} m ${pct(hf.default)}`)
  if (stats.badHeightValues.size) {
    const top = [...stats.badHeightValues].sort((a, b) => b[1] - a[1]).slice(0, 8)
    console.log(`  unparseable height values (${stats.badHeightValues.size} distinct): ${top.map(([v, c]) => `${JSON.stringify(v)}×${c}`).join(', ')}`)
  }
  console.log(`streets: ${streets.length} runs`)
  console.log(`\ntallest:`)
  for (const t of tallest) {
    console.log(`  ${t.height.toFixed(1).padStart(6)} m  ${t.name ?? '(unnamed)'}  at x=${t.center[0].toFixed(0)}, z=${t.center[1].toFixed(0)}${t.ringBand ? '  [ring]' : ''}`)
  }
  console.log(`\npublic/city.bin: ${(bytes.length / 1024).toFixed(0)} KB in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

await main()
