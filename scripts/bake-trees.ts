// Bake DataSF's Street Tree Inventory into each tile of the city (format.ts,
// cityIndex.ts): one trees file per tile. Run after `npm run bake` (it
// reads the tiles).
//
//   npm run bake:trees                    fetch if not cached, then bake
//   npm run bake:trees -- --cached-only   bake from the cache only
//
// Input:  DataSF tkzw-k3nq (San Francisco Public Works, PDDL 1.0), the rows
//         inside the tiles' box, cached in scripts/.cache/
// Output: public/tiles/trees-<i>_<j>-<hash>.bin (src/city/treeFormat.ts)
//
// Plus illustrative trees where no inventory covers them, Monterey pines
// and cypresses (broad and columnar): in landmark grounds (the index's
// landmarkModels: Coit Tower's Pioneer Park), scattered on a jittered
// PARK_SPACING_M grid inside the grounds' OSM outline, clear of the
// landmark itself; and in OSM's woods (Golden Gate Park, the Presidio,
// Sutro Forest), on a WOOD_SPACING_M grid.
//
// Skipped: planting sites and stumps, median trees (our streets have no
// medians, so they'd stand on the asphalt), trunks inside a building
// footprint, and anything outside the bake area. Trunks on the drawn roadway
// are moved out to the curb when they're within CURB_PUSH_MAX_M of it
// (treeSites.ts pushToCurb: our street widths are per class, so most such
// trees are real curbside trees), skipped when they're deeper in.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CoverClass, type CityTile, TILE_M, decodeTile, joinParts, toLines } from '../src/city/format.ts'
import { woodedTest } from './lib/cover.ts'
import { tileKey } from '../src/city/cityIndex.ts'
import { ringPosition } from '../src/city/ring.ts'
import { decodeTrees, encodeTrees } from '../src/city/treeFormat.ts'
import { TREE_KINDS, TreeKind, TreeTone, classifySpecies, isNotATree, parseDbh } from '../src/city/treeSpecies.ts'
import { distToOutline } from '../src/city/waterfront.ts'
import { toLatLng, toScene } from '../src/geo/projection.ts'
import { CURB_INSET_M, CURB_PUSH_MAX_M, FootprintIndex, RoadwayIndex } from './lib/treeSites.ts'
import { LandMask, neighborhoodRings } from './lib/landMask.ts'
import { pruneLayer, readIndex, readTileFile, sizeReport, writeIndex, writeTileFile } from './lib/tileFiles.ts'

const ROOT = join(import.meta.dirname, '..')
const CACHE_DIR = join(ROOT, 'scripts/.cache')
// Landmark grounds' trees (illustrative): one per PARK_SPACING_M cell where
// a hash falls under PARK_FILL, none within PARK_CLEAR_M of the landmark's
// center (Coit Tower's plaza), PARK_COLUMNAR of them cypresses.
const PARK_SPACING_M = 8
const PARK_FILL = 0.75
const PARK_CLEAR_M = 30
const PARK_COLUMNAR = 0.35
const PARK_DBH = [14, 30] // inches
// OSM woods: one tree per WOOD_SPACING_M cell where a hash falls under
// WOOD_FILL (a canopy, with gaps), the cell's center inside the wood.
const WOOD_SPACING_M = 9
const WOOD_FILL = 0.8
const DATASET = 'tkzw-k3nq'
// DataSF moved from data.sfgov.org (now a 301 here) in 2026.
const ENDPOINT = `https://data.sf.gov/resource/${DATASET}.json`
const SOURCE_URL = `https://data.sf.gov/d/${DATASET}`
const PAGE = 50_000
const FIELDS = ['treeid', 'species', 'siteinfo', 'planttype', 'mapdbh', 'latitude', 'longitude', 'data_as_of']
const KIND_NAMES = ['broad', 'columnar', 'fan palm', 'date palm', 'feather palm', 'cordyline']

interface TreeRow {
  treeid?: string
  species?: string
  siteinfo?: string
  planttype?: string
  mapdbh?: string
  latitude?: string
  longitude?: string
  data_as_of?: string
}

async function fetchRows(where: string, cachedOnly: boolean): Promise<TreeRow[]> {
  const hash = createHash('sha256').update(`${DATASET}|${FIELDS.join(',')}|${where}`).digest('hex').slice(0, 12)
  const file = join(CACHE_DIR, `street-trees-${hash}.json`)
  if (existsSync(file)) {
    console.log(`trees: cached ${file}`)
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  if (cachedOnly) throw new Error(`trees: ${file} not cached; run without --cached-only`)
  const rows: TreeRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    const url = new URL(ENDPOINT)
    url.searchParams.set('$select', FIELDS.join(','))
    url.searchParams.set('$where', where)
    url.searchParams.set('$order', 'treeid')
    url.searchParams.set('$limit', String(PAGE))
    url.searchParams.set('$offset', String(offset))
    const res = await fetch(url, { headers: { 'user-agent': 'city-pulse-bake/0.1 (portfolio project; one-off bake, cached)' } })
    if (!res.ok) throw new Error(`trees: DataSF HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const page = (await res.json()) as TreeRow[]
    rows.push(...page)
    console.log(`trees: fetched ${rows.length}`)
    if (page.length < PAGE) break
  }
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(file, JSON.stringify(rows))
  return rows
}

// A hash in [0, 1) of a grid cell and a salt.
function cellHash(a: number, b: number, salt: number): number {
  let v = Math.imul(a ^ Math.imul(salt, 0x9e3779b9), 0x85ebca6b) ^ Math.imul(b, 0xc2b2ae35)
  v ^= v >>> 15
  v = Math.imul(v, 0x2c1b3c6d)
  v ^= v >>> 13
  return (v >>> 0) / 4294967296
}

interface Kept {
  x: number
  z: number
  kind: number
  tone: number
  dbh: number
  ring: number
}

// An illustrative pine or cypress at grid cell (gx, gz).
function parkTree(x: number, z: number, gx: number, gz: number, ring: number): Kept {
  const columnar = cellHash(gx, gz, 4) < PARK_COLUMNAR
  return {
    x,
    z,
    kind: columnar ? TreeKind.Columnar : TreeKind.Broad,
    tone: cellHash(gx, gz, 5) < 0.6 ? TreeTone.Deep : TreeTone.Gray,
    dbh: Math.round(PARK_DBH[0] + (PARK_DBH[1] - PARK_DBH[0]) * cellHash(gx, gz, 6)),
    ring: Math.round(ring * 255),
  }
}

// The cells (centers at (g + 0.5) * spacing) whose centers are inside a
// ring: each row's crossings, in pairs.
function cellsIn(ring: [number, number][], spacing: number): [number, number][] {
  const zs = ring.map((p) => p[1])
  const out: [number, number][] = []
  const xs: number[] = []
  for (let gz = Math.floor(Math.min(...zs) / spacing); gz <= Math.ceil(Math.max(...zs) / spacing); gz++) {
    const z = (gz + 0.5) * spacing
    xs.length = 0
    for (let k = 0; k < ring.length; k++) {
      const [ax, az] = ring[k]
      const [bx, bz] = ring[(k + 1) % ring.length]
      if (az <= z !== bz <= z) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let gx = Math.ceil(xs[k] / spacing - 0.5); gx <= Math.floor(xs[k + 1] / spacing - 0.5); gx++) out.push([gx, gz])
  }
  return out
}

async function main() {
  const started = Date.now()
  const index = readIndex()
  const tiles: CityTile[] = []
  for (const t of index.tiles) if (t.files.city) tiles.push(await decodeTile(readTileFile(t.files.city.file)))
  const city = joinParts(tiles)
  const boundary = toLines(index.boundary.map((r) => Array.from({ length: r.length / 2 }, (_, k): [number, number] => [r[2 * k], r[2 * k + 1]])))
  const { waterfront, ringMeters } = index
  const tileSet = new Set(index.tiles.map((t) => tileKey(t.i, t.j)))
  const mask = new LandMask(neighborhoodRings())
  const minX = Math.min(...index.tiles.map((t) => t.i)) * TILE_M
  const minZ = Math.min(...index.tiles.map((t) => t.j)) * TILE_M
  const maxX = (Math.max(...index.tiles.map((t) => t.i)) + 1) * TILE_M
  const maxZ = (Math.max(...index.tiles.map((t) => t.j)) + 1) * TILE_M

  const sw = toLatLng(minX, maxZ)
  const ne = toLatLng(maxX, minZ)
  const where = `latitude between ${sw.lat.toFixed(5)} and ${ne.lat.toFixed(5)} and longitude between ${sw.lng.toFixed(5)} and ${ne.lng.toFixed(5)}`
  const rows = await fetchRows(where, process.argv.includes('--cached-only'))
  const inputSha256 = createHash('sha256').update(JSON.stringify(rows)).digest('hex')

  const footprints = new FootprintIndex(city.buildings)
  const roads = new RoadwayIndex(city.streets)

  const drop = { notATree: 0, noLocation: 0, median: 0, outsideArea: 0, inBuilding: 0, onRoadway: 0 }
  let pushed = 0
  const kept: Kept[] = []
  const byKind = new Array<number>(TREE_KINDS).fill(0)
  let dbhKnown = 0
  let yard = 0
  let dataAsOf: string | null = null

  for (const r of rows) {
    if (r.data_as_of && (!dataAsOf || r.data_as_of > dataAsOf)) dataAsOf = r.data_as_of
    const species = r.species ?? ''
    const site = r.siteinfo ?? ''
    if ((r.planttype ?? '').toLowerCase() !== 'tree' || isNotATree(species)) {
      drop.notATree++
      continue
    }
    const lat = Number(r.latitude)
    const lng = Number(r.longitude)
    if (!r.latitude || !r.longitude || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      drop.noLocation++
      continue
    }
    let { x, z } = toScene(lat, lng)
    // The city's land (and as before the ring and the waterfront
    // extension: the piers), in a tile.
    const ring = ringPosition(boundary, ringMeters, x, z)
    const inArea = mask.has(x, z) || ring < 1 || distToOutline(x, z, waterfront) === 0
    if (!inArea || !tileSet.has(tileKey(Math.floor(x / TILE_M), Math.floor(z / TILE_M)))) {
      drop.outsideArea++
      continue
    }
    if (site.startsWith('Median')) {
      drop.median++
      continue
    }
    if (footprints.contains(x, z)) {
      drop.inBuilding++
      continue
    }
    if (roads.onRoadway(x, z)) {
      const moved = roads.pushToCurb(x, z, CURB_PUSH_MAX_M, CURB_INSET_M)
      if (!moved || footprints.contains(moved[0], moved[1])) {
        drop.onRoadway++
        continue
      }
      ;[x, z] = moved
      pushed++
    }
    const { kind, tone } = classifySpecies(species)
    const dbh = parseDbh(r.mapdbh)
    if (dbh) dbhKnown++
    if (/Yard\s*:/.test(site)) yard++
    byKind[kind]++
    kept.push({ x, z, kind, tone, dbh, ring: Math.round(ring * 255) })
  }

  if (kept.length < 1000) throw new Error(`trees: only ${kept.length} trees kept from ${rows.length} rows -- refusing to write`)

  // Landmark grounds: the street trees first, so these never shift them.
  let parkTrees = 0
  for (const lm of index.landmarkModels) {
    if (!lm.grounds) continue
    const outline: [number, number][] = []
    for (let i = 0; i < lm.grounds.length; i += 2) outline.push([lm.grounds[i], lm.grounds[i + 1]])
    const xs = outline.map((p) => p[0])
    const zs = outline.map((p) => p[1])
    const h = cellHash
    for (let gx = Math.floor(Math.min(...xs) / PARK_SPACING_M); gx <= Math.ceil(Math.max(...xs) / PARK_SPACING_M); gx++)
      for (let gz = Math.floor(Math.min(...zs) / PARK_SPACING_M); gz <= Math.ceil(Math.max(...zs) / PARK_SPACING_M); gz++) {
        if (h(gx, gz, 1) > PARK_FILL) continue
        const x = (gx + 0.15 + 0.7 * h(gx, gz, 2)) * PARK_SPACING_M
        const z = (gz + 0.15 + 0.7 * h(gx, gz, 3)) * PARK_SPACING_M
        if (distToOutline(x, z, outline) > 0 || Math.hypot(x - lm.x, z - lm.z) < PARK_CLEAR_M) continue
        if (footprints.contains(x, z) || roads.onRoadway(x, z)) continue
        const t = parkTree(x, z, gx, gz, ringPosition(boundary, ringMeters, x, z))
        kept.push(t)
        byKind[t.kind]++
        parkTrees++
      }
  }

  // OSM's woods and the wooded parks' land (cover.ts woodedTest), tile by
  // tile (each tile's cover is cut at its edges): one tree per cell once,
  // where a woods and a park overlap.
  let woodTrees = 0
  for (const tile of tiles) {
    const { counts, classes, coords } = tile.cover
    const wooded = woodedTest(tile.cover)
    const seen = new Set<string>()
    let c = 0
    counts.forEach((n, k) => {
      const ring: [number, number][] = []
      for (let i = 0; i < n; i++, c += 2) ring.push([coords[c], coords[c + 1]])
      if (classes[k] !== CoverClass.Wood && classes[k] !== CoverClass.Park) return
      for (const [gx, gz] of cellsIn(ring, WOOD_SPACING_M)) {
        const cell = `${gx},${gz}`
        if (seen.has(cell)) continue
        seen.add(cell)
        if (cellHash(gx, gz, 11) > WOOD_FILL) continue
        if (!wooded((gx + 0.5) * WOOD_SPACING_M, (gz + 0.5) * WOOD_SPACING_M)) continue
        const x = (gx + 0.15 + 0.7 * cellHash(gx, gz, 12)) * WOOD_SPACING_M
        const z = (gz + 0.15 + 0.7 * cellHash(gx, gz, 13)) * WOOD_SPACING_M
        if (footprints.contains(x, z) || roads.onRoadway(x, z)) continue
        const t = parkTree(x, z, gx, gz, ringPosition(boundary, ringMeters, x, z))
        kept.push(t)
        byKind[t.kind]++
        woodTrees++
      }
    })
  }

  const n = kept.length
  const byTile = new Map<string, Kept[]>()
  for (const t of kept) {
    const k = tileKey(Math.floor(t.x / TILE_M), Math.floor(t.z / TILE_M))
    byTile.set(k, [...(byTile.get(k) ?? []), t])
  }
  let before = 0
  for (const entry of index.tiles) {
    if (entry.files.trees) before += (await decodeTrees(readTileFile(entry.files.trees.file))).header.count
    const list = byTile.get(tileKey(entry.i, entry.j)) ?? []
    if (list.length === 0) {
      delete entry.files.trees
      continue
    }
    entry.files.trees = writeTileFile(
      'trees',
      entry.i,
      entry.j,
      await encodeTrees({
        header: { version: 3, i: entry.i, j: entry.j, x0: entry.i * TILE_M, z0: entry.j * TILE_M, count: list.length },
        coords: Float32Array.from(list.flatMap((t) => [t.x, t.z])),
        kind: Uint8Array.from(list, (t) => t.kind),
        tone: Uint8Array.from(list, (t) => t.tone),
        dbh: Uint8Array.from(list, (t) => t.dbh),
        ring: Uint8Array.from(list, (t) => t.ring),
      }),
    )
  }
  // The illustrative trees stand in the tiles' OSM woods and wooded parks,
  // and curbside trees move by the OSM streets' widths, so the tree tiles
  // are OSM-derived: ODbL as a whole (the PDDL inventory can go in one).
  index.sources.trees = `ODbL 1.0 as a whole. Street trees: San Francisco Public Works via DataSF (PDDL 1.0), ${SOURCE_URL}, data as of ${dataAsOf ?? 'unknown'}; rows sha256 ${inputSha256.slice(0, 12)}. Illustrative trees in the woods and wooded parks, and curbside trees' moves, from ${index.sources.city ?? 'OpenStreetMap contributors (ODbL)'}`
  writeIndex(index)
  const removed = pruneLayer(index, 'trees')
  if (before) console.log(`change vs the trees before: ${before} -> ${n} (${n - before >= 0 ? '+' : ''}${n - before})`)

  const core = kept.filter((t) => t.ring === 0).length
  const inArea = rows.length - drop.notATree - drop.noLocation - drop.outsideArea
  const pct = (v: number, of: number) => `${((100 * v) / of).toFixed(1)}%`
  console.log(`\nrows: ${rows.length} in the tiles' box (data as of ${dataAsOf})`)
  console.log(`trees: ${n} kept (${core} in the three neighborhoods, ${n - core} beyond; ${yard} yard trees; illustrative: ${parkTrees} in landmark grounds, ${woodTrees} in OSM woods and the wooded parks)`)
  console.log(`  dropped before the bake area: ${drop.notATree} planting sites/stumps, ${drop.noLocation} without a location, ${drop.outsideArea} outside it`)
  console.log(
    `  of the ${inArea} trees in the bake area: ${drop.median} median trees (${pct(drop.median, inArea)}), ` +
      `${drop.inBuilding} inside a footprint (${pct(drop.inBuilding, inArea)}), ${drop.onRoadway} on the roadway (${pct(drop.onRoadway, inArea)})`,
  )
  console.log(`  moved out to the curb from up to ${CURB_PUSH_MAX_M} m onto our asphalt: ${pushed}`)
  console.log(`  kinds: ${KIND_NAMES.map((k, i) => `${k} ${byKind[i]}`).join(', ')}`)
  console.log(`  DBH known for ${pct(dbhKnown, n)}`)
  console.log(`\n${sizeReport(index, ['city', 'terrain', 'trees'])}`)
  console.log(`${removed} stale tree files removed; baked in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

await main()
