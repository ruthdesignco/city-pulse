// src/data/city.bin: the baked city. Written by scripts/bake-city.ts, read by
// the app. Both sides go through this module so the layout can't drift.
//
//   bytes 0-3   "CPB1"
//   bytes 4-7   u32 LE: header JSON byte length
//   then        header JSON (utf8), padded to a 4-byte boundary
//   then        typed-array sections, each 4-byte aligned, at the offsets
//               listed in header.sections
//
// Coordinates are Int16 in units of COORD_QUANTUM meters, interleaved x,z in
// scene space (src/geo/projection.ts). Rings are open and wound so that
// signedArea in (x, z) is positive.
//
// Version 3: plus OSM ground cover (parks, woods, rock and cliffs, sand) as
// outlines with a CoverClass each (cover.*).
// Version 2: COORD_QUANTUM 0.15 m (was 0.1 m, which reached only 3.3 km
// north of ORIGIN, about Washington St; North Beach and Telegraph Hill are
// up to 4.6 km), and each building's facade seed stored (buildings.seeds),
// since it hashed the first vertex in 0.1 m units and must not change.

import type { LatLng } from '../geo/projection.ts'
import type { LandmarkPlacement } from './landmarks/registry.ts'

export const MAGIC = 'CPB1'
export const COORD_QUANTUM = 0.15 // meters per Int16 unit: +-4915 m range
export const HEIGHT_QUANTUM = 0.1 // meters per Uint16 unit
export const RING_BAND_METERS = 4 // ringBand: 0 = inside the three neighborhoods, n = within n*4 m outside

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

export interface CityHeader {
  version: 3
  origin: LatLng
  ringMeters: number
  // Extra ring area out to the Bay (waterfront.ts), outline in scene meters.
  waterfront?: [number, number][]
  // The area OSM data was baked from, scene meters [minX, minZ, maxX, maxZ]:
  // the ring is cut off where it runs past this (the north edge).
  extent?: [number, number, number, number]
  // Landmark facades pinned by name (scripts/lib/landmarkMaterials.ts):
  // building index, facade.ts PinnedMaterial code, and the OSM name.
  pinnedMaterials?: { building: number; material: number; name: string }[]
  // Landmarks drawn as models instead of their footprints (landmarks/registry.ts).
  landmarkModels?: LandmarkPlacement[]
  attribution: string
  // Provenance: the date the OSM data is current to (the extract's header,
  // or Overpass's timestamp_osm_base), and a sha256 of the OSM elements the
  // bake read, so a rebake from the same input can be recognized.
  osmTimestamp: string | null
  osmElementsSha256?: string
  bakedAt: string
  landmarks: Landmark[]
  sections?: Record<SectionName, { offset: number; length: number }>
}

export interface CityData {
  header: CityHeader
  buildings: {
    counts: Uint16Array // points per footprint
    heights: Uint16Array // HEIGHT_QUANTUM units
    ringBand: Uint8Array
    colorIndex: Uint8Array // scripts/lib/buildingColor.ts: BuildingColorType*3 + buildingVariant, 0-8
    seeds: Uint32Array // facade seed hash (extrude.ts seedHash), from the first vertex in 0.1 m units
    coords: Int16Array
  }
  streets: {
    counts: Uint16Array
    classes: Uint8Array
    coords: Int16Array
  }
  boundary: {
    counts: Uint16Array
    coords: Int16Array
  }
  cover: {
    counts: Uint16Array
    classes: Uint8Array // CoverClass
    coords: Int16Array
  }
}

const SECTIONS = [
  ['buildings.counts', Uint16Array],
  ['buildings.heights', Uint16Array],
  ['buildings.ringBand', Uint8Array],
  ['buildings.colorIndex', Uint8Array],
  ['buildings.seeds', Uint32Array],
  ['buildings.coords', Int16Array],
  ['streets.counts', Uint16Array],
  ['streets.classes', Uint8Array],
  ['streets.coords', Int16Array],
  ['boundary.counts', Uint16Array],
  ['boundary.coords', Int16Array],
  ['cover.counts', Uint16Array],
  ['cover.classes', Uint8Array],
  ['cover.coords', Int16Array],
] as const

type SectionName = (typeof SECTIONS)[number][0]
type Typed = Uint8Array | Uint16Array | Int16Array | Uint32Array

const align4 = (n: number) => (n + 3) & ~3

function getSection(data: CityData, name: SectionName): Typed {
  const [group, key] = name.split('.') as [keyof Omit<CityData, 'header'>, string]
  return (data[group] as Record<string, Typed>)[key]
}

export function encodeCity(data: CityData): Uint8Array {
  // Offsets depend on header length, which depends on offsets: lay out the
  // sections relative to zero first, then shift once the header size is known.
  const rel = {} as Record<SectionName, { offset: number; length: number }>
  let cursor = 0
  for (const [name] of SECTIONS) {
    const arr = getSection(data, name)
    rel[name] = { offset: cursor, length: arr.length }
    cursor = align4(cursor + arr.byteLength)
  }

  let headerBytes = new Uint8Array()
  let base = 0
  for (let pass = 0; pass < 3; pass++) {
    const sections = Object.fromEntries(
      Object.entries(rel).map(([k, v]) => [k, { offset: v.offset + base, length: v.length }]),
    ) as CityHeader['sections']
    headerBytes = new TextEncoder().encode(JSON.stringify({ ...data.header, sections }))
    const nextBase = align4(8 + headerBytes.length)
    if (nextBase === base) break
    base = nextBase
  }

  const out = new Uint8Array(base + cursor)
  const view = new DataView(out.buffer)
  out.set(new TextEncoder().encode(MAGIC), 0)
  view.setUint32(4, headerBytes.length, true)
  out.set(headerBytes, 8)
  for (const [name] of SECTIONS) {
    const arr = getSection(data, name)
    out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), base + rel[name].offset)
  }
  return out
}

export function decodeCity(buffer: ArrayBuffer): CityData {
  const bytes = new Uint8Array(buffer)
  const magic = new TextDecoder().decode(bytes.subarray(0, 4))
  if (magic !== MAGIC) throw new Error(`city.bin: bad magic ${JSON.stringify(magic)}`)
  const headerLen = new DataView(buffer).getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen))) as CityHeader
  if (header.version !== 3 || !header.sections) throw new Error(`city.bin: unsupported version ${header.version}`)

  const get = <T extends Typed>(name: SectionName, Ctor: new (b: ArrayBuffer, o: number, l: number) => T): T => {
    const s = header.sections![name]
    return new Ctor(buffer, s.offset, s.length)
  }
  return {
    header,
    buildings: {
      counts: get('buildings.counts', Uint16Array),
      heights: get('buildings.heights', Uint16Array),
      ringBand: get('buildings.ringBand', Uint8Array),
      colorIndex: get('buildings.colorIndex', Uint8Array),
      seeds: get('buildings.seeds', Uint32Array),
      coords: get('buildings.coords', Int16Array),
    },
    streets: {
      counts: get('streets.counts', Uint16Array),
      classes: get('streets.classes', Uint8Array),
      coords: get('streets.coords', Int16Array),
    },
    boundary: {
      counts: get('boundary.counts', Uint16Array),
      coords: get('boundary.coords', Int16Array),
    },
    cover: {
      counts: get('cover.counts', Uint16Array),
      classes: get('cover.classes', Uint8Array),
      coords: get('cover.coords', Int16Array),
    },
  }
}
