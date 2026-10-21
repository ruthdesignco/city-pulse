// Bake DataSF's Street Tree Inventory into src/data/trees.bin, clipped to the
// city.bin bake area. Run after `npm run bake` (it reads src/data/city.bin).
//
//   npm run bake:trees                    fetch if not cached, then bake
//   npm run bake:trees -- --cached-only   bake from the cache only
//
// Input:  DataSF tkzw-k3nq (San Francisco Public Works, PDDL 1.0), the rows
//         inside city.bin's data extent, cached in scripts/.cache/
// Output: src/data/trees.bin (see src/city/treeFormat.ts)
//
// Plus illustrative trees in landmark grounds (city.bin landmarkModels:
// Coit Tower's Pioneer Park), which no tree inventory covers: scattered on
// a jittered PARK_SPACING_M grid inside the grounds' OSM outline, clear of
// the landmark itself, Monterey pines and cypresses (broad and columnar).
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
import { COORD_QUANTUM, decodeCity } from '../src/city/format.ts'
import { ringPosition } from '../src/city/ring.ts'
import { decodeTrees, encodeTrees } from '../src/city/treeFormat.ts'
import { TREE_KINDS, TreeKind, TreeTone, classifySpecies, isNotATree, parseDbh } from '../src/city/treeSpecies.ts'
import { distToOutline } from '../src/city/waterfront.ts'
import { toLatLng, toScene } from '../src/geo/projection.ts'
import { CURB_INSET_M, CURB_PUSH_MAX_M, FootprintIndex, RoadwayIndex } from './lib/treeSites.ts'

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
const DATASET = 'tkzw-k3nq'
// DataSF moved from data.sfgov.org (now a 301 here) in 2026.
const ENDPOINT = `https://data.sf.gov/resource/${DATASET}.json`
const SOURCE_URL = `https://data.sf.gov/d/${DATASET}`
const PAGE = 50_000
const FIELDS = ['treeid', 'species', 'siteinfo', 'planttype', 'mapdbh', 'latitude', 'longitude', 'data_as_of']
const INT16_LIMIT_M = 32767 * COORD_QUANTUM
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

async function main() {
  const started = Date.now()
  const cityBytes = readFileSync(join(ROOT, 'src/data/city.bin'))
  const city = decodeCity(cityBytes.buffer.slice(cityBytes.byteOffset, cityBytes.byteOffset + cityBytes.byteLength))
  const citySha256 = createHash('sha256').update(cityBytes).digest('hex')
  const { extent, waterfront = [], ringMeters, origin } = city.header
  if (!extent) throw new Error('trees: city.bin has no data extent; rebake the city first')
  const [minX, minZ, maxX, maxZ] = extent

  const sw = toLatLng(minX, maxZ)
  const ne = toLatLng(maxX, minZ)
  const where = `latitude between ${sw.lat.toFixed(5)} and ${ne.lat.toFixed(5)} and longitude between ${sw.lng.toFixed(5)} and ${ne.lng.toFixed(5)}`
  const rows = await fetchRows(where, process.argv.includes('--cached-only'))
  const inputSha256 = createHash('sha256').update(JSON.stringify(rows)).digest('hex')

  const footprints = new FootprintIndex(city.buildings)
  const roads = new RoadwayIndex(city.streets)

  const drop = { notATree: 0, noLocation: 0, median: 0, outsideArea: 0, inBuilding: 0, onRoadway: 0 }
  let pushed = 0
  const kept: { x: number; z: number; kind: number; tone: number; dbh: number; ring: number }[] = []
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
    // The bake area, as the city's: the neighborhoods and the ring around
    // them, plus the waterfront extension; within the data extent and the
    // Int16 range.
    const ring = ringPosition(city.boundary, ringMeters, x, z)
    const inArea = ring < 1 || distToOutline(x, z, waterfront) === 0
    if (!inArea || x < minX || x > maxX || z < minZ || z > maxZ || Math.abs(x) > INT16_LIMIT_M || Math.abs(z) > INT16_LIMIT_M) {
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

  if (kept.length === 0) throw new Error(`trees: 0 trees kept from ${rows.length} rows -- refusing to write src/data/trees.bin`)

  // Landmark grounds: the street trees first, so these never shift them.
  let parkTrees = 0
  for (const lm of city.header.landmarkModels ?? []) {
    if (!lm.grounds) continue
    const outline: [number, number][] = []
    for (let i = 0; i < lm.grounds.length; i += 2) outline.push([lm.grounds[i], lm.grounds[i + 1]])
    const xs = outline.map((p) => p[0])
    const zs = outline.map((p) => p[1])
    const h = (a: number, b: number, salt: number) => {
      let v = Math.imul(a ^ Math.imul(salt, 0x9e3779b9), 0x85ebca6b) ^ Math.imul(b, 0xc2b2ae35)
      v ^= v >>> 15
      v = Math.imul(v, 0x2c1b3c6d)
      v ^= v >>> 13
      return (v >>> 0) / 4294967296
    }
    for (let gx = Math.floor(Math.min(...xs) / PARK_SPACING_M); gx <= Math.ceil(Math.max(...xs) / PARK_SPACING_M); gx++)
      for (let gz = Math.floor(Math.min(...zs) / PARK_SPACING_M); gz <= Math.ceil(Math.max(...zs) / PARK_SPACING_M); gz++) {
        if (h(gx, gz, 1) > PARK_FILL) continue
        const x = (gx + 0.15 + 0.7 * h(gx, gz, 2)) * PARK_SPACING_M
        const z = (gz + 0.15 + 0.7 * h(gx, gz, 3)) * PARK_SPACING_M
        if (distToOutline(x, z, outline) > 0 || Math.hypot(x - lm.x, z - lm.z) < PARK_CLEAR_M) continue
        if (footprints.contains(x, z) || roads.onRoadway(x, z)) continue
        const columnar = h(gx, gz, 4) < PARK_COLUMNAR
        const ring = ringPosition(city.boundary, ringMeters, x, z)
        kept.push({
          x,
          z,
          kind: columnar ? TreeKind.Columnar : TreeKind.Broad,
          tone: h(gx, gz, 5) < 0.6 ? TreeTone.Deep : TreeTone.Gray,
          dbh: Math.round(PARK_DBH[0] + (PARK_DBH[1] - PARK_DBH[0]) * h(gx, gz, 6)),
          ring: Math.round(ring * 255),
        })
        byKind[columnar ? TreeKind.Columnar : TreeKind.Broad]++
        parkTrees++
      }
  }

  const n = kept.length
  const coords = new Int16Array(2 * n)
  kept.forEach((t, i) => {
    coords[2 * i] = Math.round(t.x / COORD_QUANTUM)
    coords[2 * i + 1] = Math.round(t.z / COORD_QUANTUM)
  })
  const bytes = encodeTrees({
    header: {
      version: 2,
      count: n,
      origin,
      attribution: 'Street trees: San Francisco Public Works via DataSF (PDDL 1.0)',
      source: SOURCE_URL,
      dataAsOf,
      bakedAt: new Date().toISOString(),
      inputSha256,
      city: { bakedAt: city.header.bakedAt, sha256: citySha256 },
    },
    coords,
    kind: Uint8Array.from(kept, (t) => t.kind),
    tone: Uint8Array.from(kept, (t) => t.tone),
    dbh: Uint8Array.from(kept, (t) => t.dbh),
    ring: Uint8Array.from(kept, (t) => t.ring),
  })
  const out = join(ROOT, 'src/data/trees.bin')
  if (existsSync(out)) {
    const prev = readFileSync(out)
    try {
      const old = decodeTrees(prev.buffer.slice(prev.byteOffset, prev.byteOffset + prev.byteLength))
      console.log(`change vs the committed trees.bin: trees ${old.header.count} -> ${n} (${n - old.header.count >= 0 ? '+' : ''}${n - old.header.count})`)
    } catch (err) {
      // An older format version: nothing to compare against here.
      console.log(`change vs the committed trees.bin: not compared (${err instanceof Error ? err.message : err})`)
    }
  }
  writeFileSync(out, bytes)

  const core = kept.filter((t) => t.ring === 0).length
  const inArea = rows.length - drop.notATree - drop.noLocation - drop.outsideArea
  const pct = (v: number, of: number) => `${((100 * v) / of).toFixed(1)}%`
  console.log(`\nrows: ${rows.length} in the data extent (data as of ${dataAsOf})`)
  console.log(`trees: ${n} kept (${core} in the three neighborhoods, ${n - core} in the ring; ${yard} yard trees; ${parkTrees} illustrative in landmark grounds)`)
  console.log(`  dropped before the bake area: ${drop.notATree} planting sites/stumps, ${drop.noLocation} without a location, ${drop.outsideArea} outside it`)
  console.log(
    `  of the ${inArea} trees in the bake area: ${drop.median} median trees (${pct(drop.median, inArea)}), ` +
      `${drop.inBuilding} inside a footprint (${pct(drop.inBuilding, inArea)}), ${drop.onRoadway} on the roadway (${pct(drop.onRoadway, inArea)})`,
  )
  console.log(`  moved out to the curb from up to ${CURB_PUSH_MAX_M} m onto our asphalt: ${pushed}`)
  console.log(`  kinds: ${KIND_NAMES.map((k, i) => `${k} ${byKind[i]}`).join(', ')}`)
  console.log(`  DBH known for ${pct(dbhKnown, n)}`)
  console.log(`\nsrc/data/trees.bin: ${(bytes.length / 1024).toFixed(0)} KB in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

await main()
