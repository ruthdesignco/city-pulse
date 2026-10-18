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

export async function fetchOverpass(query: string): Promise<OsmElement[]> {
  const key = createHash('sha256').update(query).digest('hex').slice(0, 16)
  const file = join(CACHE_DIR, `overpass-${key}.json`)
  if (existsSync(file)) {
    console.log(`overpass: using cache ${file}`)
    return JSON.parse(readFileSync(file, 'utf8')).elements
  }

  const started = Date.now()
  const text = await postWithBackoff(query)
  const json = JSON.parse(text)
  if (json.remark) console.warn(`overpass remark: ${json.remark}`)
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(file, text)
  console.log(
    `overpass: ${json.elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)}s`,
  )
  return json.elements
}

// The public server asks clients to back off exponentially when it's at
// capacity (HTTP 429/502/503/504). Anything else fails immediately.
const RETRYABLE = new Set([429, 502, 503, 504])
const MAX_ATTEMPTS = 5

async function postWithBackoff(query: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    console.log(`overpass: fetching, attempt ${attempt}/${MAX_ATTEMPTS} (can take a few minutes)...`)
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(330_000),
    })
    const text = await res.text()
    if (res.ok && text.trimStart().startsWith('{')) return text

    const summary = `HTTP ${res.status}; body starts: ${text.slice(0, 200).replace(/\s+/g, ' ')}`
    if (!RETRYABLE.has(res.status) || attempt === MAX_ATTEMPTS) throw new Error(`overpass: ${summary}`)
    const waitS = 30 * 2 ** (attempt - 1)
    console.warn(`overpass: ${summary}\noverpass: retrying in ${waitS}s`)
    await new Promise((r) => setTimeout(r, waitS * 1000))
  }
}
