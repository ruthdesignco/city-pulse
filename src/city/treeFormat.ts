// src/data/trees.bin: the baked street trees. Written by scripts/bake-trees.ts,
// read by the app (Trees.tsx); both go through this module.
//
//   bytes 0-3   "CPT1"
//   bytes 4-7   u32 LE: header JSON byte length
//   then        header JSON (utf8), padded to a 4-byte boundary
//   then        coords  Int16[2n]  x, z interleaved, COORD_QUANTUM m, scene space
//               kind    Uint8[n]   treeSpecies.ts TreeKind
//               tone    Uint8[n]   treeSpecies.ts TreeTone
//               dbh     Uint8[n]   trunk diameter, whole inches, 0 = unknown
//               ring    Uint8[n]   ring position 0-255 (ring.ts: 0 inside the
//                                  neighborhoods, 255 at the ring's edge)
//
// Every array is `header.count` long (coords twice that), in that order, so
// the offsets follow from the count.

import type { LatLng } from '../geo/projection.ts'

export const TREES_MAGIC = 'CPT1'

export interface TreesHeader {
  version: 1
  count: number
  origin: LatLng
  attribution: string
  source: string // dataset URL
  dataAsOf: string | null // the inventory's data_as_of, newest row
  bakedAt: string
  // Provenance: a sha256 of the inventory rows read, and the city.bin these
  // trees were placed against (footprints, roadway, bake area).
  inputSha256?: string
  city?: { bakedAt: string; sha256: string }
}

export interface TreesData {
  header: TreesHeader
  coords: Int16Array
  kind: Uint8Array
  tone: Uint8Array
  dbh: Uint8Array
  ring: Uint8Array
}

const align4 = (n: number) => (n + 3) & ~3

export function encodeTrees(data: TreesData): Uint8Array {
  const n = data.header.count
  for (const [name, arr, len] of [
    ['coords', data.coords, 2 * n],
    ['kind', data.kind, n],
    ['tone', data.tone, n],
    ['dbh', data.dbh, n],
    ['ring', data.ring, n],
  ] as const) {
    if (arr.length !== len) throw new Error(`trees.bin: ${name} has ${arr.length} entries, expected ${len}`)
  }
  const header = new TextEncoder().encode(JSON.stringify(data.header))
  const base = align4(8 + header.length)
  const out = new Uint8Array(base + 4 * n + 4 * n)
  out.set(new TextEncoder().encode(TREES_MAGIC), 0)
  new DataView(out.buffer).setUint32(4, header.length, true)
  out.set(header, 8)
  out.set(new Uint8Array(data.coords.buffer, data.coords.byteOffset, data.coords.byteLength), base)
  let at = base + 4 * n
  for (const arr of [data.kind, data.tone, data.dbh, data.ring]) {
    out.set(arr, at)
    at += n
  }
  return out
}

export function decodeTrees(buffer: ArrayBuffer): TreesData {
  const bytes = new Uint8Array(buffer)
  const magic = new TextDecoder().decode(bytes.subarray(0, 4))
  if (magic !== TREES_MAGIC) throw new Error(`trees.bin: bad magic ${JSON.stringify(magic)}`)
  const headerLen = new DataView(buffer).getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen))) as TreesHeader
  if (header.version !== 1) throw new Error(`trees.bin: unsupported version ${header.version}`)
  const n = header.count
  const base = align4(8 + headerLen)
  if (buffer.byteLength < base + 8 * n) throw new Error(`trees.bin: truncated (${buffer.byteLength} bytes for ${n} trees)`)
  const u8 = (k: number) => new Uint8Array(buffer, base + 4 * n + k * n, n)
  return { header, coords: new Int16Array(buffer, base, 2 * n), kind: u8(0), tone: u8(1), dbh: u8(2), ring: u8(3) }
}
