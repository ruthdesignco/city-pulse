// The baked city, in tiles: San Francisco's land on a TILE_M grid of
// squares from the scene origin, each tile one file (public/tiles/, from
// scripts/bake-city.ts), listed with everything city-wide (the three
// neighborhoods' boundary, landmarks, provenance) in an index
// (src/data/city-index.json; cityIndex.ts). Both sides go through this
// module so the layout can't drift.
//
// A tile file:
//
//   bytes 0-3   "CPK1"
//   bytes 4-7   u32 LE: header JSON byte length
//   then        header JSON (utf8), padded to a 4-byte boundary
//   then        gzip of the sections (TILE_SECTIONS), each 4-byte aligned,
//               lengths in header.lengths
//
// Version 2 adds `land`: which of the tile's LAND_CELL_M cells are San
// Francisco's land (the bake's land mask), 255 or 0, row by row from the
// corner, so the paving (paving.ts) stops at the county line.
//
// Coordinates in the file are integers in units of COORD_QUANTUM meters
// from the tile's corner (header.x0, z0), within the Int16 range (+-4.9 km
// of the tile's own) so the city can be any size: each line's first point
// as is, the rest as differences from the point before, zigzag varints (a
// step under 9.6 m is one byte; 12% smaller gzipped than Int16). Decoded, they're Float32 scene meters (src/geo/projection.ts):
// float precision there is about a millimeter at the city's far edge, ~10
// km out. Rings are open and wound so that signedArea in (x, z) is positive.
//
// Until 2026-10 the city was one file (city.bin, version 3), Int16 in scene
// space, which reached only ~4.9 km from the origin.

import type { LatLng } from '../geo/projection.ts'
import type { LandmarkPlacement } from './landmarks/registry.ts'

export const TILE_MAGIC = 'CPK1'
export const TILE_M = 1000
export const COORD_QUANTUM = 0.15 // meters per Int16 unit in a tile file, from its corner
export const HEIGHT_QUANTUM = 0.1 // meters per Uint16 unit
export const RING_BAND_METERS = 4 // ringBand: 0 = inside the three neighborhoods, n = within n*4 m outside
export const LAND_CELL_M = 25
export const LAND_CELLS = TILE_M / LAND_CELL_M // per side

export const StreetClass = { Major: 0, Minor: 1, Local: 2 } as const

// Ground cover (scripts/lib/cover.ts): what the ground shows where it isn't paved.
export const CoverClass = { Grass: 0, Wood: 1, Rock: 2, Sand: 3 } as const
export type CoverClass = (typeof CoverClass)[keyof typeof CoverClass]

export interface Landmark {
  name: string
  x: number
  z: number
  height: number
}

// Lines or rings: `counts` points each, x, z interleaved in scene meters.
export interface Lines {
  counts: Uint16Array
  coords: Float32Array
}

export interface CityParts {
  buildings: Lines & {
    heights: Uint16Array // HEIGHT_QUANTUM units
    ringBand: Uint8Array
    colorIndex: Uint8Array // scripts/lib/buildingColor.ts: BuildingColorType*3 + buildingVariant, 0-8
    seeds: Uint32Array // facade seed hash (extrude.ts seedHash), from the first vertex in 0.1 m units
  }
  streets: Lines & { classes: Uint8Array }
  cover: Lines & { classes: Uint8Array } // CoverClass
}

// A landmark facade pinned by name (scripts/lib/landmarkMaterials.ts):
// building index, facade.ts PinnedMaterial code, and the OSM name.
export interface PinnedMaterial {
  building: number
  material: number
  name: string
}

export interface TileHeader {
  version: 2
  i: number // the tile's column: x from i * TILE_M
  j: number // and row: z from j * TILE_M
  x0: number // its corner, scene m: what file coordinates count from
  z0: number
  pinnedMaterials: PinnedMaterial[]
  lengths?: Record<TileSection, number>
}

export interface CityTile extends CityParts {
  header: TileHeader
  land: Uint8Array // LAND_CELLS x LAND_CELLS, 255 where the cell is the city's land
}

// The loaded city as one: the tiles' parts end to end, plus what's
// city-wide (useCity.ts).
export interface CityHeader {
  origin: LatLng
  ringMeters: number
  // Extra ring area out to the Bay (waterfront.ts), outline in scene meters.
  waterfront?: [number, number][]
  // The loaded tiles' area, scene meters [minX, minZ, maxX, maxZ]: the
  // city's ground ends past it (paving.ts).
  extent: [number, number, number, number]
  pinnedMaterials: PinnedMaterial[] // building index into the whole
  // Landmarks drawn as models instead of their footprints (landmarks/registry.ts).
  landmarkModels: LandmarkPlacement[]
  attribution: string
  // Provenance: the date the OSM data is current to (the extract's header),
  // and a sha256 of the OSM elements the bake read, so a rebake from the
  // same input can be recognized.
  osmTimestamp: string | null
  osmElementsSha256?: string
  bakedAt: string
  landmarks: Landmark[]
}

export interface CityData extends CityParts {
  header: CityHeader
  boundary: Lines // the three neighborhoods
}

const TILE_SECTIONS = [
  ['buildings.counts', Uint16Array],
  ['buildings.heights', Uint16Array],
  ['buildings.ringBand', Uint8Array],
  ['buildings.colorIndex', Uint8Array],
  ['buildings.seeds', Uint32Array],
  ['buildings.coords', Uint8Array],
  ['streets.counts', Uint16Array],
  ['streets.classes', Uint8Array],
  ['streets.coords', Uint8Array],
  ['cover.counts', Uint16Array],
  ['cover.classes', Uint8Array],
  ['cover.coords', Uint8Array],
  ['land', Uint8Array],
] as const

type TileSection = (typeof TILE_SECTIONS)[number][0]
type Typed = Uint8Array | Uint16Array | Uint32Array

const align4 = (n: number) => (n + 3) & ~3

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(body).arrayBuffer())
}

// Scene meters to the file's varints (zigzag LEB128), from (x0, z0), each
// line's points after its first as differences.
export function packCoords(lines: Lines, x0: number, z0: number): Uint8Array {
  const out: number[] = []
  const q = (v: number, o: number) => {
    const u = Math.round((v - o) / COORD_QUANTUM)
    if (u < -32768 || u > 32767) throw new Error(`coordinate ${v.toFixed(1)} m is ${(v - o).toFixed(0)} m from its tile's corner, outside the Int16 range`)
    return u
  }
  const put = (d: number) => {
    let z = d < 0 ? -2 * d - 1 : 2 * d
    while (z >= 128) {
      out.push((z & 127) | 128)
      z = Math.floor(z / 128)
    }
    out.push(z)
  }
  let c = 0
  for (const n of lines.counts) {
    let px = 0
    let pz = 0
    for (let i = 0; i < n; i++, c += 2) {
      const x = q(lines.coords[c], x0)
      const z = q(lines.coords[c + 1], z0)
      put(x - px)
      put(z - pz)
      ;[px, pz] = [x, z]
    }
  }
  return Uint8Array.from(out)
}

export function unpackCoords(counts: Uint16Array, packed: Uint8Array, x0: number, z0: number): Float32Array {
  let total = 0
  for (const n of counts) total += 2 * n
  const out = new Float32Array(total)
  let at = 0
  const get = () => {
    let v = 0
    let scale = 1
    let b: number
    do {
      b = packed[at++]
      v += (b & 127) * scale
      scale *= 128
    } while (b & 128)
    return v & 1 ? -(v + 1) / 2 : v / 2
  }
  let c = 0
  for (const n of counts) {
    let x = 0
    let z = 0
    for (let i = 0; i < n; i++, c += 2) {
      x += get()
      z += get()
      out[c] = x0 + x * COORD_QUANTUM
      out[c + 1] = z0 + z * COORD_QUANTUM
    }
  }
  if (at !== packed.length) throw new Error('tile: coordinates do not match their counts')
  return out
}

function sectionsOf(t: CityTile): Record<TileSection, Typed> {
  const { x0, z0 } = t.header
  return {
    'buildings.counts': t.buildings.counts,
    'buildings.heights': t.buildings.heights,
    'buildings.ringBand': t.buildings.ringBand,
    'buildings.colorIndex': t.buildings.colorIndex,
    'buildings.seeds': t.buildings.seeds,
    'buildings.coords': packCoords(t.buildings, x0, z0),
    'streets.counts': t.streets.counts,
    'streets.classes': t.streets.classes,
    'streets.coords': packCoords(t.streets, x0, z0),
    'cover.counts': t.cover.counts,
    'cover.classes': t.cover.classes,
    'cover.coords': packCoords(t.cover, x0, z0),
    land: t.land,
  }
}

export async function encodeTile(t: CityTile): Promise<Uint8Array> {
  if (t.land.length !== LAND_CELLS * LAND_CELLS) throw new Error(`tile ${t.header.i},${t.header.j}: land mask has ${t.land.length} cells, not ${LAND_CELLS * LAND_CELLS}`)
  const sections = sectionsOf(t)
  const lengths = {} as Record<TileSection, number>
  let size = 0
  for (const [name] of TILE_SECTIONS) {
    lengths[name] = sections[name].length
    size = align4(size + sections[name].byteLength)
  }
  const body = new Uint8Array(size)
  let at = 0
  for (const [name] of TILE_SECTIONS) {
    const a = sections[name]
    body.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at)
    at = align4(at + a.byteLength)
  }
  const json = new TextEncoder().encode(JSON.stringify({ ...t.header, lengths }))
  const base = align4(8 + json.length)
  const packed = await pipe(body, new CompressionStream('gzip'))
  const out = new Uint8Array(base + packed.length)
  out.set(new TextEncoder().encode(TILE_MAGIC), 0)
  new DataView(out.buffer).setUint32(4, json.length, true)
  out.set(json, 8)
  out.set(packed, base)
  return out
}

export async function decodeTile(buffer: ArrayBuffer): Promise<CityTile> {
  const bytes = new Uint8Array(buffer)
  const magic = new TextDecoder().decode(bytes.subarray(0, 4))
  if (magic !== TILE_MAGIC) throw new Error(`tile: bad magic ${JSON.stringify(magic)}`)
  const len = new DataView(buffer).getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as TileHeader
  if (header.version !== 2 || !header.lengths) throw new Error(`tile: unsupported version ${header.version}`)
  const body = await pipe(bytes.subarray(align4(8 + len)), new DecompressionStream('gzip'))
  const s = {} as Record<TileSection, Typed>
  let at = 0
  for (const [name, Ctor] of TILE_SECTIONS) {
    const n = header.lengths[name]
    s[name] = new Ctor(body.buffer as ArrayBuffer, body.byteOffset + at, n)
    at = align4(at + n * Ctor.BYTES_PER_ELEMENT)
  }
  if (at > body.length) throw new Error('tile: sections run past the data')
  const { x0, z0 } = header
  const counts = (name: TileSection) => s[name] as Uint16Array
  return {
    header,
    buildings: {
      counts: counts('buildings.counts'),
      heights: s['buildings.heights'] as Uint16Array,
      ringBand: s['buildings.ringBand'] as Uint8Array,
      colorIndex: s['buildings.colorIndex'] as Uint8Array,
      seeds: s['buildings.seeds'] as Uint32Array,
      coords: unpackCoords(counts('buildings.counts'), s['buildings.coords'] as Uint8Array, x0, z0),
    },
    streets: {
      counts: counts('streets.counts'),
      classes: s['streets.classes'] as Uint8Array,
      coords: unpackCoords(counts('streets.counts'), s['streets.coords'] as Uint8Array, x0, z0),
    },
    cover: {
      counts: counts('cover.counts'),
      classes: s['cover.classes'] as Uint8Array,
      coords: unpackCoords(counts('cover.counts'), s['cover.coords'] as Uint8Array, x0, z0),
    },
    land: s.land as Uint8Array,
  }
}

// Lines from arrays of [x, z] points.
export function toLines(lines: [number, number][][]): Lines {
  const counts = new Uint16Array(lines.length)
  const coords = new Float32Array(lines.reduce((n, l) => n + 2 * l.length, 0))
  let c = 0
  lines.forEach((l, k) => {
    if (l.length > 65535) throw new Error(`line with ${l.length} points exceeds Uint16`)
    counts[k] = l.length
    for (const [x, z] of l) {
      coords[c++] = x
      coords[c++] = z
    }
  })
  return { counts, coords }
}

// Several tiles' parts end to end (pinned materials renumbered), for what
// works on the city as a whole.
export function joinParts(parts: CityTile[]): CityParts & { pinnedMaterials: PinnedMaterial[] } {
  const cat = <T extends Typed | Float32Array>(arrays: T[], Ctor: new (n: number) => T): T => {
    const out = new Ctor(arrays.reduce((n, a) => n + a.length, 0))
    let at = 0
    for (const a of arrays) {
      ;(out as unknown as { set(a: T, at: number): void }).set(a, at)
      at += a.length
    }
    return out
  }
  const pinnedMaterials: PinnedMaterial[] = []
  let offset = 0
  for (const p of parts) {
    for (const m of p.header.pinnedMaterials) pinnedMaterials.push({ ...m, building: m.building + offset })
    offset += p.buildings.counts.length
  }
  return {
    pinnedMaterials,
    buildings: {
      counts: cat(parts.map((p) => p.buildings.counts), Uint16Array),
      heights: cat(parts.map((p) => p.buildings.heights), Uint16Array),
      ringBand: cat(parts.map((p) => p.buildings.ringBand), Uint8Array),
      colorIndex: cat(parts.map((p) => p.buildings.colorIndex), Uint8Array),
      seeds: cat(parts.map((p) => p.buildings.seeds), Uint32Array),
      coords: cat(parts.map((p) => p.buildings.coords), Float32Array),
    },
    streets: {
      counts: cat(parts.map((p) => p.streets.counts), Uint16Array),
      classes: cat(parts.map((p) => p.streets.classes), Uint8Array),
      coords: cat(parts.map((p) => p.streets.coords), Float32Array),
    },
    cover: {
      counts: cat(parts.map((p) => p.cover.counts), Uint16Array),
      classes: cat(parts.map((p) => p.cover.classes), Uint8Array),
      coords: cat(parts.map((p) => p.cover.coords), Float32Array),
    },
  }
}
