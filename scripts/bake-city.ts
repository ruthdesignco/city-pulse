// Bake OpenStreetMap's buildings, streets and ground cover for all of San
// Francisco's land into tiles (src/city/format.ts): TILE_M squares from
// the scene origin, files in public/tiles/, listed in src/data/city-index.json
// (src/city/cityIndex.ts) with what's city-wide. SoMa, the Mission and the
// Tenderloin are the focus; everything else is a context ring that fades a
// little toward the haze with distance from them (ring.ts), the whole city
// past RING_METERS.
//
//   npm run bake -- --pbf <file>    bake from a Geofabrik .osm.pbf extract
//                                   (norcal-*.osm.pbf covers the city)
//
// Inputs:  scripts/data/analysis-neighborhoods.geojson (DataSF): the three
//          neighborhoods, and all 41 together as the city's land
//          (landMask.ts); Alcatraz too, which they leave out
// Output:  public/tiles/city-<i>_<j>-<hash>.bin, src/data/city-index.json

import { createHash } from 'node:crypto'
import {
  CoverClass,
  HEIGHT_QUANTUM,
  LAND_CELLS,
  LAND_CELL_M,
  RING_BAND_METERS,
  StreetClass,
  TILE_M,
  type CityTile,
  type Landmark,
  type PinnedMaterial,
  decodeTile,
  encodeTile,
  toLines,
} from '../src/city/format.ts'
import { type CityIndex, INDEX_VERSION, type TileEntry, tileKey } from '../src/city/cityIndex.ts'
import { seedHash, SEED_UNIT_M } from '../src/city/extrude.ts'
import { distToOutline, waterfrontOutline } from '../src/city/waterfront.ts'
import { ORIGIN, toScene } from '../src/geo/projection.ts'
import {
  type Pt,
  type Rect,
  centroid,
  clipPolylineToRect,
  clipRingToRect,
  distToRing,
  openRing,
  parseHeight,
  pointInRing,
  signedArea,
  simplifyLine,
  simplifyRing,
  stitchRings,
} from './lib/geometry.ts'
import type { Bbox, OsmElement, OsmGeomPoint } from './lib/overpass.ts'
import { buildingColorType, buildingVariant } from './lib/buildingColor.ts'
import { loadFromPbf } from './lib/pbf.ts'
import { LANDMARK_MATERIALS } from './lib/landmarkMaterials.ts'
import { CLIFF_WIDTH_M, PARK_ONLY, WOODED_PARKS, coverClass, isCliff } from './lib/cover.ts'
import { LANDMARKS, type LandmarkPlacement } from '../src/city/landmarks/registry.ts'
import { minAreaRect } from './lib/geometry.ts'
import { ALCATRAZ, LandMask, neighborhoodRings } from './lib/landMask.ts'
import { pruneLayer, readIndexIfAny, readTileFile, sizeReport, writeIndex, writeTileFile } from './lib/tileFiles.ts'

const NEIGHBORHOODS = ['South of Market', 'Mission', 'Tenderloin']
// 800 m (not 600) so the whole Transbay cluster is in: Salesforce Tower sits
// ~600 m out, Millennium and 181 Fremont ~700 m.
const RING_METERS = 800
// The city's land with room around it (the extract is read for this box).
const QUERY_BBOX: Bbox = { south: 37.7065, west: -122.517, north: 37.8345, east: -122.3555 }
const WATERFRONT = waterfrontOutline()
// Streets and cover may reach a little past the land (piers, the shore's
// beaches and rocks).
const SHORE_M = 60

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

const inRect = ([x, z]: Pt, r: Rect) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ

// What the bake keeps: the city's land, Alcatraz, and as before the
// neighborhoods' ring out to the Bay (the waterfront extension: piers).
// `shore`: also within SHORE_M of land.
function areaTest(mask: LandMask, boundary: Pt[][]) {
  const nearLand = ([x, z]: Pt) => {
    for (const [dx, dz] of [[0, 0], [SHORE_M, 0], [-SHORE_M, 0], [0, SHORE_M], [0, -SHORE_M]]) if (mask.has(x + dx, z + dz)) return true
    return false
  }
  const ring = (p: Pt) => boundary.some((b) => pointInRing(p, b)) || Math.min(...boundary.map((b) => distToRing(p, b))) <= RING_METERS || distToOutline(p[0], p[1], WATERFRONT) === 0
  return (p: Pt, shore = false) => mask.has(p[0], p[1]) || inRect(p, ALCATRAZ) || (shore && nearLand(p)) || ring(p)
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
  outsideCity: 0,
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
// Every outline point of each replaced element (a multipolygon brings
// several rings: Sutro Tower's legs).
const landmarkFootprints = new Map<string, Pt[]>()

// Past RING_METERS a building is as far out as the ring goes (ring.ts):
// capped there, so the whole city fits a byte.
function ringBandOf(center: Pt, boundary: Pt[][]): number {
  if (boundary.some((b) => pointInRing(center, b))) return 0
  const d = Math.min(...boundary.map((b) => distToRing(center, b)))
  return Math.max(1, Math.min(Math.ceil(RING_METERS / RING_BAND_METERS), Math.ceil(d / RING_BAND_METERS)))
}

function bakeBuildings(elements: OsmElement[], boundary: Pt[][], keep: (p: Pt) => boolean): BakedBuilding[] {
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
      landmarkFootprints.set(f.osm, [...(landmarkFootprints.get(f.osm) ?? []), ...f.ring])
      stats.landmarkModels++
      continue
    }
    const center = centroid(f.ring)
    if (!keep(center)) {
      stats.outsideCity++
      continue
    }
    const ringBand = ringBandOf(center, boundary)

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

// Keep only the runs of each street on the city's land (and its piers), so
// streets end where the city does instead of trailing on into Daly City.
function bakeStreets(elements: OsmElement[], keep: (p: Pt, shore: boolean) => boolean): { line: Pt[]; cls: number }[] {
  const within = (p: Pt) => keep(p, true)
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

// OSM ground cover (scripts/lib/cover.ts) over the city: areas as their
// outer rings (holes ignored, as for buildings), cliffs widened from their
// top edge to the right by CLIFF_WIDTH_M. Kept where any point is on the
// city's land or its shore.
const SIMPLIFY_COVER_M = 1
// The wooded parks (cover.ts WOODED_PARKS) are Park, their gardens too;
// water, fields and the like count only inside them.
function bakeCover(elements: OsmElement[], keep: (p: Pt, shore: boolean) => boolean): { ring: Pt[]; cls: number }[] {
  const within = (p: Pt) => keep(p, true)
  const out: { ring: Pt[]; cls: number }[] = []
  const parks = elements.filter((el) => WOODED_PARKS.has(`${el.type}/${el.id}`)).flatMap((el) => footprintsOf(el, el.tags ?? {}).map((f) => f.ring))
  const missing = [...WOODED_PARKS].filter(([id]) => !elements.some((el) => `${el.type}/${el.id}` === id))
  if (missing.length) throw new Error(`bake: wooded parks not found: ${missing.map(([id, name]) => `${name} (${id})`).join(', ')}`)
  const inPark = (ring: Pt[]) => parks.some((p) => pointInRing(centroid(ring), p))
  for (const el of elements) {
    let cls = coverClass(el.tags)
    if (cls === null) continue
    if (WOODED_PARKS.has(`${el.type}/${el.id}`)) cls = CoverClass.Park
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
      if (r.length < 3 || !r.some(within)) continue
      let c = cls
      if (PARK_ONLY.has(c) || (el.tags?.leisure === 'garden' && c === CoverClass.Grass)) {
        const inside = inPark(r)
        if (PARK_ONLY.has(c) && !inside) continue
        if (inside && c === CoverClass.Grass) c = CoverClass.Park
      }
      let ring = simplifyRing(r, SIMPLIFY_COVER_M)
      if (ring.length < 3) continue
      if (signedArea(ring) < 0) ring = [...ring].reverse()
      out.push({ ring, cls: c })
    }
  }
  return out
}

// ----------------------------------------------------------------- tiles

// Landmark grounds' OSM ways (registry.ts), read with the rest.
const LANDMARK_GROUNDS = new Set(LANDMARKS.flatMap((l) => (l.grounds ? [Number(l.grounds.split('/')[1])] : [])))

const tileRect = (i: number, j: number): Rect => ({ minX: i * TILE_M, minZ: j * TILE_M, maxX: (i + 1) * TILE_M, maxZ: (j + 1) * TILE_M })
const tileOf = ([x, z]: Pt): [number, number] => [Math.floor(x / TILE_M), Math.floor(z / TILE_M)]

interface TileParts {
  i: number
  j: number
  buildings: BakedBuilding[]
  pinned: PinnedMaterial[]
  streets: { line: Pt[]; cls: number }[]
  cover: { ring: Pt[]; cls: number }[]
}

// Buildings by the tile their center is in; streets and cover cut at the
// tiles' edges.
function intoTiles(buildings: BakedBuilding[], streets: { line: Pt[]; cls: number }[], cover: { ring: Pt[]; cls: number }[]): Map<string, TileParts> {
  const tiles = new Map<string, TileParts>()
  const at = (i: number, j: number) => {
    const k = tileKey(i, j)
    let t = tiles.get(k)
    if (!t) tiles.set(k, (t = { i, j, buildings: [], pinned: [], streets: [], cover: [] }))
    return t
  }
  for (const b of buildings) {
    const t = at(...tileOf(b.center))
    if (b.name !== undefined && Object.hasOwn(LANDMARK_MATERIALS, b.name)) t.pinned.push({ building: t.buildings.length, material: LANDMARK_MATERIALS[b.name], name: b.name })
    t.buildings.push(b)
  }
  const span = (pts: Pt[]) => {
    const [i0, j0] = tileOf([Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))])
    const [i1, j1] = tileOf([Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))])
    return { i0, j0, i1, j1 }
  }
  for (const s of streets) {
    const { i0, j0, i1, j1 } = span(s.line)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) for (const run of clipPolylineToRect(s.line, tileRect(i, j))) at(i, j).streets.push({ line: run, cls: s.cls })
  }
  for (const c of cover) {
    const { i0, j0, i1, j1 } = span(c.ring)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const ring = i0 === i1 && j0 === j1 ? c.ring : clipRingToRect(c.ring, tileRect(i, j))
        if (ring.length >= 3 && Math.abs(signedArea(ring)) >= 1) at(i, j).cover.push({ ring, cls: c.cls })
      }
  }
  return tiles
}

// Which of the tile's LAND_CELL_M cells are the city's land, by their centers.
function landCells(i: number, j: number, mask: LandMask): Uint8Array {
  const out = new Uint8Array(LAND_CELLS * LAND_CELLS)
  for (let b = 0; b < LAND_CELLS; b++)
    for (let a = 0; a < LAND_CELLS; a++) if (mask.has(i * TILE_M + (a + 0.5) * LAND_CELL_M, j * TILE_M + (b + 0.5) * LAND_CELL_M)) out[b * LAND_CELLS + a] = 255
  return out
}

function toTile(t: TileParts, mask: LandMask): CityTile {
  const b = t.buildings
  return {
    header: { version: 2, i: t.i, j: t.j, x0: t.i * TILE_M, z0: t.j * TILE_M, pinnedMaterials: t.pinned },
    land: landCells(t.i, t.j, mask),
    buildings: {
      ...toLines(b.map((x) => x.ring)),
      heights: Uint16Array.from(b, (x) => Math.round(x.height / HEIGHT_QUANTUM)),
      ringBand: Uint8Array.from(b, (x) => Math.min(255, x.ringBand)),
      colorIndex: Uint8Array.from(b, (x) => x.colorIndex),
      seeds: Uint32Array.from(b, (x) => seedHash(Math.round(x.ring[0][0] / SEED_UNIT_M), Math.round(x.ring[0][1] / SEED_UNIT_M))),
    },
    streets: { ...toLines(t.streets.map((x) => x.line)), classes: Uint8Array.from(t.streets, (x) => x.cls) },
    cover: { ...toLines(t.cover.map((x) => x.ring)), classes: Uint8Array.from(t.cover, (x) => x.cls) },
  }
}

async function main() {
  const started = Date.now()
  const pbfIdx = process.argv.indexOf('--pbf')
  if (pbfIdx === -1 || !process.argv[pbfIdx + 1]) throw new Error('bake: --pbf <file.osm.pbf> is required (a Geofabrik extract covering the city)')
  const boundary = neighborhoodRings(NEIGHBORHOODS)
  console.log(`boundary: ${boundary.length} rings, ${boundary.reduce((n, r) => n + r.length, 0)} points`)
  const mask = new LandMask(neighborhoodRings())
  const keep = areaTest(mask, boundary)

  const { elements, osmTimestamp } = loadFromPbf(process.argv[pbfIdx + 1], QUERY_BBOX, LANDMARK_GROUNDS)
  if (!osmTimestamp) console.warn('bake: the OSM source has no data timestamp; osmTimestamp stays null')
  const osmElementsSha256 = createHash('sha256').update(JSON.stringify(elements)).digest('hex')
  console.log(`osm: ${elements.length} elements, data as of ${osmTimestamp ?? 'unknown'}`)

  const buildings = bakeBuildings(elements, boundary, keep)
  const streets = bakeStreets(elements, keep)
  const cover = bakeCover(elements, keep)

  // A near-empty OSM source (a bad --pbf path, a wrong extract) must never
  // silently overwrite a good city with a near-empty one.
  if (buildings.length < 1000) {
    throw new Error(`bake: only ${buildings.length} buildings kept from ${elements.length} OSM elements -- refusing to write. Check the --pbf extract covers San Francisco.`)
  }

  const tallest = [...buildings].sort((a, b) => b.height - a.height).slice(0, 10)
  const landmarks: Landmark[] = tallest
    .filter((b) => b.name)
    .map((b) => ({ name: b.name!, x: b.center[0], z: b.center[1], height: b.height }))

  // Each landmark's placement, from the first of its footprints; its grounds' outline.
  const r1 = (v: number) => Math.round(v * 10) / 10
  const landmarkModels: LandmarkPlacement[] = LANDMARKS.map((l) => {
    const missing = l.replaces.filter((osm) => !landmarkFootprints.has(osm))
    if (missing.length) throw new Error(`bake: landmark ${l.id}: no building footprint for ${missing.join(', ')}`)
    const rect = minAreaRect(landmarkFootprints.get(l.replaces[0])!)
    const center = rect.center
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

  const tiles = intoTiles(buildings, streets, cover)
  // Landmark facades, pinned by exact OSM name; every name must match.
  const pinned = [...tiles.values()].flatMap((t) => t.pinned)
  const unmatched = Object.keys(LANDMARK_MATERIALS).filter((name) => !pinned.some((p) => p.name === name))
  if (unmatched.length) throw new Error(`bake: landmark material names match no building: ${unmatched.join(', ')}`)

  // What changes against the tiles baked before (by facade seed).
  const before = readIndexIfAny()
  const oldSeeds = new Set<number>()
  let oldBuildings = 0
  let oldStreets = 0
  let comparable = !!before
  if (before)
    for (const t of before.tiles) {
      if (!t.files.city) continue
      // Tiles of an older format version can't be read: no comparison then.
      const old = await decodeTile(readTileFile(t.files.city.file)).catch(() => null)
      if (!old) {
        comparable = false
        break
      }
      old.buildings.seeds.forEach((x) => oldSeeds.add(x))
      oldBuildings += old.buildings.counts.length
      oldStreets += old.streets.counts.length
    }

  const entries: TileEntry[] = []
  const kept = new Map((before?.tiles ?? []).map((t) => [tileKey(t.i, t.j), t]))
  for (const t of [...tiles.values()].sort((a, b) => a.j - b.j || a.i - b.i)) {
    const land = Math.round(mask.fraction(tileRect(t.i, t.j)) * 1000) / 1000
    if (t.buildings.length === 0 && land === 0) continue
    const file = writeTileFile('city', t.i, t.j, await encodeTile(toTile(t, mask)))
    const prev = kept.get(tileKey(t.i, t.j))
    entries.push({ i: t.i, j: t.j, buildings: t.buildings.length, land, files: { ...prev?.files, city: file } })
  }
  const index: CityIndex = {
    version: INDEX_VERSION,
    origin: ORIGIN,
    tileM: TILE_M,
    ringMeters: RING_METERS,
    boundary: boundary.map((r) => r.flatMap(([x, z]) => [r1(x), r1(z)])),
    waterfront: WATERFRONT.map(([x, z]) => [r1(x), r1(z)]),
    landmarks,
    landmarkModels,
    attribution: '© OpenStreetMap contributors (ODbL) · Neighborhoods: DataSF',
    osmTimestamp,
    osmElementsSha256,
    bakedAt: new Date().toISOString(),
    sources: { ...before?.sources, city: `OpenStreetMap contributors (ODbL), extract of ${osmTimestamp ?? 'unknown date'}` },
    tiles: entries,
  }
  writeIndex(index)
  const removed = pruneLayer(index, 'city')
  if (before && !comparable) console.log('\nchange vs the tiles before: they are an older format version, not compared')
  if (before && comparable) {
    const newSeeds = buildings.filter((b) => !oldSeeds.has(seedHash(Math.round(b.ring[0][0] / SEED_UNIT_M), Math.round(b.ring[0][1] / SEED_UNIT_M)))).length
    console.log(`\nchange vs the tiles before: buildings ${oldBuildings} -> ${buildings.length}, streets ${oldStreets} -> ${streets.length}; ${newSeeds} buildings with a new facade seed (their look may change)`)
  }
  console.log(`tiles: ${entries.length} written, ${removed} stale city files removed`)

  // ------------------------------------------------------------- report
  const core = buildings.filter((x) => x.ringBand === 0).length
  console.log(`\nbuildings: ${buildings.length} kept (${core} in the three neighborhoods, ${buildings.length - core} beyond)`)
  console.log(`  outlines seen ${stats.outlines}, parts with heights ${stats.parts}`)
  console.log(`  dropped: ${stats.outsideCity} outside the city, ${stats.tooSmall} under ${MIN_FOOTPRINT_M2} m², ${stats.skippedByValue} by building=* value, ${stats.bridgeSupports} bridge supports, ${stats.underground} underground`)
  console.log(`  multipolygon: ${stats.relationRingsUnclosed} outer rings could not be closed, ${stats.holesIgnored} inner rings (courtyards) ignored, ${stats.relationsWithoutGeometry} relations had no geometry`)
  const hf = stats.heightFrom
  const pct = (v: number) => `${((100 * v) / buildings.length).toFixed(1)}%`
  console.log(`  height source: height ${pct(hf.height)}, levels ${pct(hf.levels)}, parts ${pct(hf.parts)}, default ${DEFAULT_HEIGHT_M} m ${pct(hf.default)}`)
  if (stats.badHeightValues.size) {
    const top = [...stats.badHeightValues].sort((a, b) => b[1] - a[1]).slice(0, 8)
    console.log(`  unparseable height values (${stats.badHeightValues.size} distinct): ${top.map(([v, c]) => `${JSON.stringify(v)}×${c}`).join(', ')}`)
  }
  console.log(`landmark models: ${landmarkModels.map((m) => `${m.id} (${m.sizeX.toFixed(0)} x ${m.sizeZ.toFixed(0)} m at ${m.x.toFixed(0)}, ${m.z.toFixed(0)}, ${((m.angle * 180) / Math.PI).toFixed(1)} deg${m.grounds ? `, grounds ${m.grounds.length / 2} pts` : ''})`).join(', ')}`)
  console.log(`landmark materials: ${pinned.map((p) => p.name).join(', ')}`)
  console.log(`streets: ${streets.length} runs`)
  console.log(`ground cover: ${['grass', 'wood', 'rock', 'sand', 'wooded park', 'park water', 'park fields', 'park clear'].map((name, c) => `${cover.filter((x) => x.cls === c).length} ${name}`).join(', ')} outlines`)
  console.log(`\ntallest:`)
  for (const t of tallest) {
    console.log(`  ${t.height.toFixed(1).padStart(6)} m  ${t.name ?? '(unnamed)'}  at x=${t.center[0].toFixed(0)}, z=${t.center[1].toFixed(0)}${t.ringBand ? '  [ring]' : ''}`)
  }
  console.log(`\n${sizeReport(index, ['city', 'terrain', 'trees'])}`)
  console.log(`\nbaked in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

await main()
