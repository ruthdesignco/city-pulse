// The city seen from afar, in one small file (public/tiles/far-<hash>.bin,
// from scripts/bake-far.ts, listed in the city index's `far`): for every
// tile, its buildings merged into low prisms, one per block of touching
// buildings at their area-weighted height, the towers kept as their own;
// the woods' canopy as FAR_CANOPY_CELL_M cells; and where each landmark
// model stands. It's what's drawn before a tile's own files arrive, and
// for tiles too far off to need them (stream/lod.ts).
//
//   bytes 0-3   "CPF1"
//   bytes 4-7   u32 LE: header JSON byte length
//   then        header JSON (utf8), padded to a 4-byte boundary
//   then        gzip of the sections (FAR_SECTIONS), each 4-byte aligned,
//               lengths in header.lengths; every tile's run of each, in
//               header.tiles order
//
// Prism outlines are coded as the tiles' (format.ts packCoords), from their
// tile's corner; header.tiles[k].coordBytes is each tile's share.

import { HEIGHT_QUANTUM, TILE_M, packCoords, unpackCoords } from './format.ts'

export const FAR_MAGIC = 'CPF1'
export const FAR_CANOPY_CELL_M = 20
export const FAR_CANOPY_CELLS = TILE_M / FAR_CANOPY_CELL_M // per side

export interface FarTileInfo {
  i: number
  j: number
  prisms: number
  coordBytes: number
  canopy: number
}

export interface FarHeader {
  version: 1
  tiles: FarTileInfo[]
  // The ground under each landmark model (registry.ts landmarkGround), m.
  landmarkY: Record<string, number>
  bakedAt: string
  lengths?: Record<FarSection, number>
}

export interface FarTile {
  i: number
  j: number
  prisms: {
    counts: Uint16Array
    coords: Float32Array // scene m, x, z interleaved
    base: Float32Array // m: the lowest ground under each
    height: Float32Array // m above base to its top
    colorIndex: Uint8Array // as the buildings' (format.ts)
    ring: Float32Array // 0..1 (ring.ts)
  }
  canopy: {
    cells: Uint16Array // a + b * FAR_CANOPY_CELLS, cell (a, b) from the tile's corner
    ground: Float32Array // m, under each cell's center
  }
}

export interface FarData {
  header: FarHeader
  tiles: FarTile[]
}

const FAR_SECTIONS = [
  ['prisms.counts', Uint16Array],
  ['prisms.coords', Uint8Array],
  ['prisms.base', Int16Array],
  ['prisms.height', Uint16Array],
  ['prisms.colorIndex', Uint8Array],
  ['prisms.ring', Uint8Array],
  ['canopy.cells', Uint16Array],
  ['canopy.ground', Int16Array],
] as const

type FarSection = (typeof FAR_SECTIONS)[number][0]
type Typed = Uint8Array | Uint16Array | Int16Array

const align4 = (n: number) => (n + 3) & ~3

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(body).arrayBuffer())
}

function cat<T extends Typed>(parts: T[], Ctor: new (n: number) => T): T {
  const out = new Ctor(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    ;(out as unknown as { set(a: T, at: number): void }).set(p, at)
    at += p.length
  }
  return out
}

const toInt16 = (a: Float32Array) => Int16Array.from(a, (v) => Math.round(v / HEIGHT_QUANTUM))
const toUint16 = (a: Float32Array) => Uint16Array.from(a, (v) => Math.round(v / HEIGHT_QUANTUM))

export async function encodeFar(data: FarData): Promise<Uint8Array> {
  const tiles: FarTileInfo[] = []
  const coords: Uint8Array[] = []
  for (const t of data.tiles) {
    const packed = packCoords(t.prisms, t.i * TILE_M, t.j * TILE_M)
    coords.push(packed)
    tiles.push({ i: t.i, j: t.j, prisms: t.prisms.counts.length, coordBytes: packed.length, canopy: t.canopy.cells.length })
  }
  const sections: Record<FarSection, Typed> = {
    'prisms.counts': cat(data.tiles.map((t) => t.prisms.counts), Uint16Array),
    'prisms.coords': cat(coords, Uint8Array),
    'prisms.base': cat(data.tiles.map((t) => toInt16(t.prisms.base)), Int16Array),
    'prisms.height': cat(data.tiles.map((t) => toUint16(t.prisms.height)), Uint16Array),
    'prisms.colorIndex': cat(data.tiles.map((t) => t.prisms.colorIndex), Uint8Array),
    'prisms.ring': cat(data.tiles.map((t) => Uint8Array.from(t.prisms.ring, (r) => Math.round(Math.min(1, Math.max(0, r)) * 255))), Uint8Array),
    'canopy.cells': cat(data.tiles.map((t) => t.canopy.cells), Uint16Array),
    'canopy.ground': cat(data.tiles.map((t) => toInt16(t.canopy.ground)), Int16Array),
  }
  const lengths = {} as Record<FarSection, number>
  let size = 0
  for (const [name] of FAR_SECTIONS) {
    lengths[name] = sections[name].length
    size = align4(size + sections[name].byteLength)
  }
  const body = new Uint8Array(size)
  let at = 0
  for (const [name] of FAR_SECTIONS) {
    const a = sections[name]
    body.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at)
    at = align4(at + a.byteLength)
  }
  const json = new TextEncoder().encode(JSON.stringify({ ...data.header, tiles, lengths }))
  const base = align4(8 + json.length)
  const packed = await pipe(body, new CompressionStream('gzip'))
  const out = new Uint8Array(base + packed.length)
  out.set(new TextEncoder().encode(FAR_MAGIC), 0)
  new DataView(out.buffer).setUint32(4, json.length, true)
  out.set(json, 8)
  out.set(packed, base)
  return out
}

export async function decodeFar(buffer: ArrayBuffer): Promise<FarData> {
  const bytes = new Uint8Array(buffer)
  const magic = new TextDecoder().decode(bytes.subarray(0, 4))
  if (magic !== FAR_MAGIC) throw new Error(`far: bad magic ${JSON.stringify(magic)}`)
  const len = new DataView(buffer).getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as FarHeader
  if (header.version !== 1 || !header.lengths) throw new Error(`far: unsupported version ${header.version}`)
  const body = await pipe(bytes.subarray(align4(8 + len)), new DecompressionStream('gzip'))
  const s = {} as Record<FarSection, Typed>
  let at = 0
  for (const [name, Ctor] of FAR_SECTIONS) {
    const n = header.lengths[name]
    s[name] = new Ctor(body.buffer as ArrayBuffer, body.byteOffset + at, n)
    at = align4(at + n * Ctor.BYTES_PER_ELEMENT)
  }
  if (at > body.length) throw new Error('far: sections run past the data')
  const span = <T extends Typed>(a: T, from: number, n: number) => a.subarray(from, from + n) as T
  const tiles: FarTile[] = []
  let p = 0
  let cb = 0
  let c = 0
  for (const t of header.tiles) {
    const counts = span(s['prisms.counts'] as Uint16Array, p, t.prisms).slice()
    tiles.push({
      i: t.i,
      j: t.j,
      prisms: {
        counts,
        coords: unpackCoords(counts, span(s['prisms.coords'] as Uint8Array, cb, t.coordBytes), t.i * TILE_M, t.j * TILE_M),
        base: Float32Array.from(span(s['prisms.base'] as Int16Array, p, t.prisms), (v) => v * HEIGHT_QUANTUM),
        height: Float32Array.from(span(s['prisms.height'] as Uint16Array, p, t.prisms), (v) => v * HEIGHT_QUANTUM),
        colorIndex: span(s['prisms.colorIndex'] as Uint8Array, p, t.prisms).slice(),
        ring: Float32Array.from(span(s['prisms.ring'] as Uint8Array, p, t.prisms), (v) => v / 255),
      },
      canopy: {
        cells: span(s['canopy.cells'] as Uint16Array, c, t.canopy).slice(),
        ground: Float32Array.from(span(s['canopy.ground'] as Int16Array, c, t.canopy), (v) => v * HEIGHT_QUANTUM),
      },
    })
    p += t.prisms
    cb += t.coordBytes
    c += t.canopy
  }
  return { header, tiles }
}
