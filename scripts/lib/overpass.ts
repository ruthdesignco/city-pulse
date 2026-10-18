// Fetch OSM data for the bake from the public Overpass API, cached on disk.
//
// The cache (scripts/.cache/, gitignored) keeps rebakes offline and avoids
// hammering a shared community server; delete it to force a fresh pull.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ENDPOINT = 'https://overpass-api.de/api/interpreter'
const USER_AGENT = 'city-pulse-bake/0.1 (portfolio project; one-off bake, cached)'
const CACHE_DIR = join(import.meta.dirname, '..', '.cache')

export interface Bbox {
  south: number
  west: number
  north: number
  east: number
}

export interface OsmGeomPoint {
  lat: number
  lon: number
}

export interface OsmWay {
  type: 'way'
  id: number
  tags?: Record<string, string>
  geometry?: OsmGeomPoint[]
}

export interface OsmRelation {
  type: 'relation'
  id: number
  tags?: Record<string, string>
  members: { type: string; ref: number; role: string; geometry?: OsmGeomPoint[] }[]
}

export type OsmElement = OsmWay | OsmRelation

export function cityQuery(b: Bbox): string {
  const bb = `${b.south},${b.west},${b.north},${b.east}`
  return `[out:json][timeout:300][maxsize:1073741824];
(
  way["building"](${bb});
  relation["building"]["type"="multipolygon"](${bb});
  way["building:part"](${bb});
  relation["building:part"]["type"="multipolygon"](${bb});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${bb});
);
out tags geom;`
}

export interface FetchOptions {
  // Never touch the network: use cached tiles (or cached sub-tiles) only and
  // skip anything missing. For previewing a partial bake.
  cachedOnly?: boolean
}

class NotCachedError extends Error {}

// The main query uses `out tags geom`, which omits relation members, so
// multipolygon buildings arrive without geometry. Fetch them separately with
// full geometry (`out geom`): a small query, kept apart so the cached tiles
// stay valid.
export function buildingRelationsQuery(b: Bbox): string {
  const bb = `${b.south},${b.west},${b.north},${b.east}`
  return `[out:json][timeout:180];
(
  relation["building"]["type"="multipolygon"](${bb});
  relation["building:part"]["type"="multipolygon"](${bb});
);
out geom;`
}

export async function fetchOverpass(
  query: string,
  maxAttempts = MAX_ATTEMPTS,
  opts: FetchOptions = {},
): Promise<OsmElement[]> {
  const key = createHash('sha256').update(query).digest('hex').slice(0, 16)
  const file = join(CACHE_DIR, `overpass-${key}.json`)
  if (existsSync(file)) {
    console.log(`overpass: using cache ${file}`)
    return JSON.parse(readFileSync(file, 'utf8')).elements
  }
  if (opts.cachedOnly) throw new NotCachedError(`not cached: overpass-${key}`)

  const started = Date.now()
  const text = await postWithBackoff(query, maxAttempts)
  const json = JSON.parse(text)
  if (json.remark) console.warn(`overpass remark: ${json.remark}`)
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(file, text)
  console.log(
    `overpass: ${json.elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)}s`,
  )
  return json.elements
}

// Split a large area into rows x cols tiles and fetch them one at a time.
// Smaller queries get through a busy public server far more often than one
// big one, and each tile caches on its own so a failure resumes where it
// stopped. A tile that keeps failing is split 2x2 (up to MAX_SPLIT_DEPTH
// levels). Elements crossing tile edges come back twice; dedupe by type/id.
export async function fetchTiled(
  bbox: Bbox,
  rows: number,
  cols: number,
  query: (b: Bbox) => string,
  opts: FetchOptions = {},
): Promise<OsmElement[]> {
  const seen = new Map<string, OsmElement>()
  const dLat = (bbox.north - bbox.south) / rows
  const dLng = (bbox.east - bbox.west) / cols
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      console.log(`overpass: tile ${r * cols + c + 1}/${rows * cols}`)
      const tile: Bbox = {
        south: bbox.south + r * dLat,
        north: bbox.south + (r + 1) * dLat,
        west: bbox.west + c * dLng,
        east: bbox.west + (c + 1) * dLng,
      }
      for (const el of await fetchAdaptive(tile, query, 0, opts)) seen.set(`${el.type}/${el.id}`, el)
    }
  }
  return [...seen.values()]
}

const MAX_SPLIT_DEPTH = 2
const ATTEMPTS_BEFORE_SPLIT = 2

async function fetchAdaptive(
  tile: Bbox,
  query: (b: Bbox) => string,
  depth: number,
  opts: FetchOptions,
): Promise<OsmElement[]> {
  if (depth === MAX_SPLIT_DEPTH) {
    try {
      return await fetchOverpass(query(tile), MAX_ATTEMPTS, opts)
    } catch (err) {
      if (!(err instanceof NotCachedError)) throw err
      console.warn(`overpass: SKIPPING uncached area ${JSON.stringify(tile)} (cached-only)`)
      return []
    }
  }
  try {
    return await fetchOverpass(query(tile), ATTEMPTS_BEFORE_SPLIT, opts)
  } catch (err) {
    if (!(err instanceof NotCachedError)) {
      console.warn(`overpass: splitting tile into 4 (depth ${depth + 1}) after: ${(err as Error).message.slice(0, 80)}`)
    }
    const midLat = (tile.south + tile.north) / 2
    const midLng = (tile.west + tile.east) / 2
    const quads: Bbox[] = [
      { south: tile.south, north: midLat, west: tile.west, east: midLng },
      { south: tile.south, north: midLat, west: midLng, east: tile.east },
      { south: midLat, north: tile.north, west: tile.west, east: midLng },
      { south: midLat, north: tile.north, west: midLng, east: tile.east },
    ]
    const out: OsmElement[] = []
    for (const q of quads) out.push(...(await fetchAdaptive(q, query, depth + 1, opts)))
    return out
  }
}

// The public server asks clients to back off exponentially when it's at
// capacity (HTTP 429/502/503/504). Anything else fails immediately.
const RETRYABLE = new Set([429, 502, 503, 504])
const MAX_ATTEMPTS = 5

async function postWithBackoff(query: string, maxAttempts: number): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    console.log(`overpass: fetching, attempt ${attempt}/${maxAttempts} (can take a few minutes)...`)
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(330_000),
    })
    const text = await res.text()
    if (res.ok && text.trimStart().startsWith('{')) return text

    const summary = `HTTP ${res.status}; body starts: ${text.slice(0, 200).replace(/\s+/g, ' ')}`
    if (!RETRYABLE.has(res.status) || attempt >= maxAttempts) throw new Error(`overpass: ${summary}`)
    const waitS = 30 * 2 ** (attempt - 1)
    console.warn(`overpass: ${summary}\noverpass: retrying in ${waitS}s`)
    await new Promise((r) => setTimeout(r, waitS * 1000))
  }
}
