// Bake OSM buildings and streets for SoMa, the Mission and the Tenderloin
// (plus a dimmer context ring, extended out to the Bay along the waterfront:
// src/city/waterfront.ts) into src/data/city.bin.
//
//   npm run bake                    fetch what's missing, then bake
//   npm run bake -- --cached-only   bake from cache only (partial preview)
//   npm run bake -- --pbf <file>    bake from a Geofabrik .osm.pbf via osmium-tool
//
// Inputs:  scripts/data/analysis-neighborhoods.geojson (DataSF)
//          OpenStreetMap via Overpass, cached in scripts/.cache/
// Output:  src/data/city.bin (see src/city/format.ts)

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COORD_QUANTUM,
  HEIGHT_QUANTUM,
  RING_BAND_METERS,
  StreetClass,
  type CityData,
  type Landmark,
  decodeCity,
  encodeCity,
} from '../src/city/format.ts'
import { seedHash, SEED_UNIT_M } from '../src/city/extrude.ts'
import { distToOutline, waterfrontOutline } from '../src/city/waterfront.ts'
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
import {
  type Bbox,
  type OsmElement,
  type OsmGeomPoint,
  buildingRelationsQuery,
  cityQuery,
  coverQuery,
  fetchOverpass,
  fetchTiled,
  overpassDataTimestamps,
} from './lib/overpass.ts'
import { compareCities, describeCityChange } from './lib/bakeSummary.ts'
import { buildingColorType, buildingVariant } from './lib/buildingColor.ts'
import { loadFromPbf } from './lib/pbf.ts'
import { LANDMARK_MATERIALS } from './lib/landmarkMaterials.ts'
import { CLIFF_WIDTH_M, coverClass, isCliff } from './lib/cover.ts'
import { LANDMARKS, type LandmarkPlacement } from '../src/city/landmarks/registry.ts'
import { minAreaRect } from './lib/geometry.ts'

const ROOT = join(import.meta.dirname, '..')
const NEIGHBORHOODS = ['South of Market', 'Mission', 'Tenderloin']
// 800 m (not 600) so the whole Transbay cluster is in: Salesforce Tower sits
// ~600 m out, Millennium and 181 Fremont ~700 m.
const RING_METERS = 800
// Cluster bbox padded ~850 m, north to the waterfront extension's edge
// (Bay St and the piers off it); corners stay inside the Int16 range at
// COORD_QUANTUM. Part of the Overpass cache key: changing it refetches
// every tile.
const QUERY_BBOX: Bbox = { south: 37.74, west: -122.4367, north: 37.8095, east: -122.3825 }
const WATERFRONT = waterfrontOutline()
const INT16_LIMIT_M = 32767 * COORD_QUANTUM
const TILES = 3

const SIMPLIFY_BUILDING_M = 0.75
const SIMPLIFY_STREET_M = 1.0
const MIN_FOOTPRINT_M2 = 15
const METERS_PER_LEVEL = 3.2
const DEFAULT_HEIGHT_M = 8
const SKIP_BUILDING_VALUES = new Set(['no', 'roof', 'construction', 'demolished', 'collapsed', 'ruins'])
// Bridge towers tagged as buildings (the Bay Bridge's W2 is building=tower,
// 160 m): without the deck and cables they read as a lone pillar in the Bay.
const isBridgeSupport = (tags: Record<string, string>) => !!tags['bridge:support']
// Underground structures (Powell Street Station's concourse is a 300 m
// building=train_station, location=underground, right under Market): with
// no height they extruded to the 8 m default and stood across the street.
const isUnderground = (tags: Record<string, string>) => tags.location === 'underground'

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
  relationsWithoutGeometry: 0,
  holesIgnored: 0,
  skippedByValue: 0,
  bridgeSupports: 0,
  underground: 0,
  tooSmall: 0,
  outsideRing: 0,
  waterfront: 0,
  pastInt16: 0,
  landmarkModels: 0,
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
  if (!el.members) {
    stats.relationsWithoutGeometry++
    return []
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
  colorIndex: number
  name?: string
  center: Pt
}

// Landmarks drawn as models (src/city/landmarks/registry.ts): their
// footprints are left out of the extrusion, and each one's placement is
// worked out from its footprint instead.
const LANDMARK_BY_OSM = new Map(LANDMARKS.flatMap((l) => l.replaces.map((osm) => [osm, l] as const)))
const landmarkFootprints = new Map<string, Footprint>()

function ringBandOf(center: Pt, boundary: Pt[][]): number {
  if (boundary.some((b) => pointInRing(center, b))) return 0
  return Math.max(1, Math.ceil(Math.min(...boundary.map((b) => distToRing(center, b))) / RING_BAND_METERS))
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
      if (isBridgeSupport(tags)) {
        stats.bridgeSupports++
        continue
      }
      if (isUnderground(tags)) {
        stats.underground++
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
    if (LANDMARK_BY_OSM.has(f.osm)) {
      landmarkFootprints.set(f.osm, f)
      stats.landmarkModels++
      continue
    }
    const center = centroid(f.ring)
    let ringBand = 0
    if (!boundary.some((b) => pointInRing(center, b))) {
      const d = Math.min(...boundary.map((b) => distToRing(center, b)))
      if (d > RING_METERS) {
        if (distToOutline(center[0], center[1], WATERFRONT) > 0) {
          stats.outsideRing++
          continue
        }
        stats.waterfront++
      }
      ringBand = Math.max(1, Math.ceil(d / RING_BAND_METERS))
    }
    if (f.ring.some(([x, z]) => Math.abs(x) > INT16_LIMIT_M || Math.abs(z) > INT16_LIMIT_M)) {
      stats.pastInt16++
      continue
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

    const colorIndex = buildingColorType(f.tags.building, meters) * 3 + buildingVariant(f.osm)
    baked.push({ ring, height: meters, ringBand, colorIndex, name: f.tags.name, center })
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
    boundary.some((b) => pointInRing(p, b)) ||
    Math.min(...boundary.map((b) => distToRing(p, b))) <= RING_METERS ||
    distToOutline(p[0], p[1], WATERFRONT) === 0
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

// ----------------------------------------------------------- ground cover

// OSM ground cover (scripts/lib/cover.ts) over the bake area: areas as
// their outer rings (holes ignored, as for buildings), cliffs widened from
// their top edge to the right by CLIFF_WIDTH_M. Kept where any point is in
// the area (the neighborhoods, the ring, the extensions) and inside the
// Int16 range.
const SIMPLIFY_COVER_M = 1
function bakeCover(elements: OsmElement[], boundary: Pt[][]): { ring: Pt[]; cls: number }[] {
  const within = (p: Pt) =>
    Math.abs(p[0]) < INT16_LIMIT_M &&
    Math.abs(p[1]) < INT16_LIMIT_M &&
    (boundary.some((b) => pointInRing(p, b)) || Math.min(...boundary.map((b) => distToRing(p, b))) <= RING_METERS || distToOutline(p[0], p[1], WATERFRONT) === 0)
  const out: { ring: Pt[]; cls: number }[] = []
  for (const el of elements) {
    const cls = coverClass(el.tags)
    if (cls === null) continue
    let rings: Pt[][] = []
    if (el.type === 'way' && isCliff(el.tags) && el.geometry) {
      const line = el.geometry.map(project)
      // The cliff's face, to the right of its line: the line, then back along it offset.
      const offset = line.map((p, i): Pt => {
        const a = line[Math.max(0, i - 1)]
        const b = line[Math.min(line.length - 1, i + 1)]
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
        return [p[0] - ((b[1] - a[1]) / l) * CLIFF_WIDTH_M, p[1] + ((b[0] - a[0]) / l) * CLIFF_WIDTH_M]
      })
      rings = [[...line, ...offset.reverse()]]
    } else rings = footprintsOf(el, el.tags ?? {}).map((f) => f.ring)
    for (const r of rings) {
      if (r.length < 3 || !r.some(within) || r.some(([x, z]) => Math.abs(x) >= INT16_LIMIT_M || Math.abs(z) >= INT16_LIMIT_M)) continue
      let ring = simplifyRing(r, SIMPLIFY_COVER_M)
      if (ring.length < 3) continue
      if (signedArea(ring) < 0) ring = [...ring].reverse()
      out.push({ ring, cls })
    }
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

// The query bbox in scene meters, [minX, minZ, maxX, maxZ] (north is -z).
function bboxExtent(b: Bbox): [number, number, number, number] {
  const sw = toScene(b.south, b.west)
  const ne = toScene(b.north, b.east)
  const r = (v: number) => Math.round(v * 10) / 10
  return [r(sw.x), r(ne.z), r(ne.x), r(sw.z)]
}

// ----------------------------------------------------------------- main

// Landmark grounds' OSM ways (registry.ts), fetched by ID with the rest.
const LANDMARK_GROUNDS = new Set(LANDMARKS.flatMap((l) => (l.grounds ? [Number(l.grounds.split('/')[1])] : [])))

async function loadFromOverpass(): Promise<OsmElement[]> {
  const cachedOnly = process.argv.includes('--cached-only')
  if (cachedOnly) console.warn('bake: --cached-only. Output may be PARTIAL; do not commit it.')
  const tiled = await fetchTiled(QUERY_BBOX, TILES, TILES, cityQuery, { cachedOnly })
  let relations: OsmElement[] = []
  try {
    relations = await fetchOverpass(buildingRelationsQuery(QUERY_BBOX), undefined, { cachedOnly })
  } catch (err) {
    if (!cachedOnly) throw err
    console.warn('bake: building relations not cached; multipolygon buildings will be missing')
  }
  // Full-geometry relations replace the tag-only copies from the tiles.
  const byId = new Map(tiled.map((e) => [`${e.type}/${e.id}`, e]))
  for (const r of relations) byId.set(`${r.type}/${r.id}`, r)
  // Ground cover replaces any tag-only copies too.
  for (const c of await fetchOverpass(coverQuery(QUERY_BBOX), undefined, { cachedOnly })) byId.set(`${c.type}/${c.id}`, c)
  if (LANDMARK_GROUNDS.size) {
    const grounds = await fetchOverpass(`[out:json][timeout:60];\nway(id:${[...LANDMARK_GROUNDS].join(',')});\nout tags geom;`, undefined, { cachedOnly })
    for (const g of grounds) byId.set(`${g.type}/${g.id}`, g)
  }
  return [...byId.values()]
}

async function main() {
  const started = Date.now()
  const boundary = loadBoundary()
  console.log(`boundary: ${boundary.length} rings, ${boundary.reduce((n, r) => n + r.length, 0)} points`)

  const pbfIdx = process.argv.indexOf('--pbf')
  let elements: OsmElement[]
  let osmTimestamp: string | null
  if (pbfIdx !== -1) {
    ;({ elements, osmTimestamp } = loadFromPbf(process.argv[pbfIdx + 1] ?? '', QUERY_BBOX, LANDMARK_GROUNDS))
  } else {
    elements = await loadFromOverpass()
    // The oldest response: the whole bake is at least that current.
    osmTimestamp = [...overpassDataTimestamps].sort()[0] ?? null
  }
  if (!osmTimestamp) console.warn('bake: the OSM source has no data timestamp; osmTimestamp stays null')
  const osmElementsSha256 = createHash('sha256').update(JSON.stringify(elements)).digest('hex')
  console.log(`osm: ${elements.length} elements, data as of ${osmTimestamp ?? 'unknown'}`)

  const buildings = bakeBuildings(elements, boundary)
  const streets = bakeStreets(elements, boundary)
  const cover = bakeCover(elements, boundary)

  // A near-empty OSM source (e.g. --cached-only with nothing cached yet, or
  // a bad --pbf path) must never silently overwrite a good city.bin with a
  // near-empty one -- happened twice in one session before this guard existed.
  if (buildings.length === 0) {
    throw new Error(
      `bake: 0 buildings kept from ${elements.length} OSM elements -- refusing to write src/data/city.bin. ` +
        'Check the Overpass cache (bake without --cached-only first) or the --pbf path.',
    )
  }

  const tallest = [...buildings].sort((a, b) => b.height - a.height).slice(0, 10)
  const landmarks: Landmark[] = tallest
    .filter((b) => b.name)
    .map((b) => ({ name: b.name!, x: b.center[0], z: b.center[1], height: b.height }))

  // Landmark facades, pinned by exact OSM name; every name must match.
  const pinnedMaterials = buildings.flatMap((x, building) =>
    x.name !== undefined && Object.hasOwn(LANDMARK_MATERIALS, x.name) ? [{ building, material: LANDMARK_MATERIALS[x.name], name: x.name }] : [],
  )
  const unmatched = Object.keys(LANDMARK_MATERIALS).filter((name) => !pinnedMaterials.some((p) => p.name === name))
  if (unmatched.length) throw new Error(`bake: landmark material names match no building: ${unmatched.join(', ')}`)

  // Each landmark's placement, from the first of its footprints; its grounds' outline.
  const r1 = (v: number) => Math.round(v * 10) / 10
  const landmarkModels: LandmarkPlacement[] = LANDMARKS.map((l) => {
    const missing = l.replaces.filter((osm) => !landmarkFootprints.has(osm))
    if (missing.length) throw new Error(`bake: landmark ${l.id}: no building footprint for ${missing.join(', ')}`)
    const ring = landmarkFootprints.get(l.replaces[0])!.ring
    const rect = minAreaRect(ring)
    const center = centroid(ring)
    const placement: LandmarkPlacement = {
      id: l.id,
      x: r1(rect.center[0]),
      z: r1(rect.center[1]),
      angle: Math.round(rect.angle * 1e4) / 1e4,
      sizeX: r1(rect.sizeX),
      sizeZ: r1(rect.sizeZ),
      ring: Math.min(1, (ringBandOf(center, boundary) * RING_BAND_METERS) / RING_METERS),
    }
    if (l.grounds) {
      const g = elements.find((e) => `${e.type}/${e.id}` === l.grounds)
      if (!g || g.type !== 'way' || !g.geometry) throw new Error(`bake: landmark ${l.id}: grounds ${l.grounds} not found`)
      placement.grounds = simplifyRing(openRing(g.geometry.map(project)), 1).flatMap(([x, z]) => [r1(x), r1(z)])
    }
    return placement
  })

  const b = packLines(buildings.map((x) => x.ring))
  const s = packLines(streets.map((x) => x.line))
  const n = packLines(boundary)
  const cv = packLines(cover.map((x) => x.ring))
  const data: CityData = {
    header: {
      version: 3,
      origin: ORIGIN,
      ringMeters: RING_METERS,
      waterfront: WATERFRONT.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]),
      extent: bboxExtent(QUERY_BBOX),
      pinnedMaterials,
      landmarkModels,
      attribution: '© OpenStreetMap contributors (ODbL) · Neighborhoods: DataSF',
      osmTimestamp,
      osmElementsSha256,
      bakedAt: new Date().toISOString(),
      landmarks,
    },
    buildings: {
      counts: b.counts,
      heights: Uint16Array.from(buildings, (x) => Math.round(x.height / HEIGHT_QUANTUM)),
      ringBand: Uint8Array.from(buildings, (x) => Math.min(255, x.ringBand)),
      colorIndex: Uint8Array.from(buildings, (x) => x.colorIndex),
      seeds: Uint32Array.from(buildings, (x) => seedHash(Math.round(x.ring[0][0] / SEED_UNIT_M), Math.round(x.ring[0][1] / SEED_UNIT_M))),
      coords: b.coords,
    },
    streets: { counts: s.counts, classes: Uint8Array.from(streets, (x) => x.cls), coords: s.coords },
    boundary: n,
    cover: { counts: cv.counts, classes: Uint8Array.from(cover, (x) => x.cls), coords: cv.coords },
  }
  const bytes = encodeCity(data)
  const out = join(ROOT, 'src/data/city.bin')
  if (existsSync(out)) {
    const prev = readFileSync(out)
    try {
      console.log(`\nchange vs the committed city.bin: ${describeCityChange(compareCities(decodeCity(prev.buffer.slice(prev.byteOffset, prev.byteOffset + prev.byteLength)), data))}`)
    } catch (err) {
      // An older format version: nothing to compare against here.
      console.log(`\nchange vs the committed city.bin: not compared (${err instanceof Error ? err.message : err})`)
    }
  }
  writeFileSync(out, bytes)

  // ------------------------------------------------------------- report
  const core = buildings.filter((x) => x.ringBand === 0).length
  console.log(`\nbuildings: ${buildings.length} kept (${core} in the three neighborhoods, ${buildings.length - core} in the ring, ${stats.waterfront} of them in the waterfront extension)`)
  console.log(`  outlines seen ${stats.outlines}, parts with heights ${stats.parts}`)
  console.log(`  dropped: ${stats.outsideRing} beyond ring, ${stats.pastInt16} past the Int16 limit, ${stats.tooSmall} under ${MIN_FOOTPRINT_M2} m², ${stats.skippedByValue} by building=* value, ${stats.bridgeSupports} bridge supports, ${stats.underground} underground`)
  console.log(`  multipolygon: ${stats.relationRingsUnclosed} outer rings could not be closed, ${stats.holesIgnored} inner rings (courtyards) ignored, ${stats.relationsWithoutGeometry} relations had no geometry`)
  const hf = stats.heightFrom
  const pct = (v: number) => `${((100 * v) / buildings.length).toFixed(1)}%`
  console.log(`  height source: height ${pct(hf.height)}, levels ${pct(hf.levels)}, parts ${pct(hf.parts)}, default ${DEFAULT_HEIGHT_M} m ${pct(hf.default)}`)
  if (stats.badHeightValues.size) {
    const top = [...stats.badHeightValues].sort((a, b) => b[1] - a[1]).slice(0, 8)
    console.log(`  unparseable height values (${stats.badHeightValues.size} distinct): ${top.map(([v, c]) => `${JSON.stringify(v)}×${c}`).join(', ')}`)
  }
  console.log(`landmark models: ${landmarkModels.map((m) => `${m.id} (${m.sizeX.toFixed(0)} x ${m.sizeZ.toFixed(0)} m at ${m.x.toFixed(0)}, ${m.z.toFixed(0)}, ${((m.angle * 180) / Math.PI).toFixed(1)} deg${m.grounds ? `, grounds ${m.grounds.length / 2} pts` : ''})`).join(', ')}`)
  console.log(`landmark materials: ${pinnedMaterials.map((p) => `${p.name} (#${p.building}, ${buildings[p.building].height.toFixed(0)} m)`).join(', ')}`)
  console.log(`streets: ${streets.length} runs`)
  console.log(`ground cover: ${['grass', 'wood', 'rock', 'sand'].map((name, c) => `${cover.filter((x) => x.cls === c).length} ${name}`).join(', ')} outlines`)
  console.log(`\ntallest:`)
  for (const t of tallest) {
    console.log(`  ${t.height.toFixed(1).padStart(6)} m  ${t.name ?? '(unnamed)'}  at x=${t.center[0].toFixed(0)}, z=${t.center[1].toFixed(0)}${t.ringBand ? '  [ring]' : ''}`)
  }
  console.log(`\nsrc/data/city.bin: ${(bytes.length / 1024).toFixed(0)} KB in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

await main()
