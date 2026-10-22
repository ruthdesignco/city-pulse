// A tile's trees (public/tiles/trees-<i>_<j>-<hash>.bin, from
// scripts/bake-trees.ts; the tiles: format.ts, cityIndex.ts), read by the
// app (Trees.tsx); both go through this module.
//
//   bytes 0-3   "CPT1"
//   bytes 4-7   u32 LE: header JSON byte length
//   then        header JSON (utf8), padded to a 4-byte boundary
//   then        gzip of:
//               coords  Int16[2n]  x, z interleaved, COORD_QUANTUM m from
//                                  the tile's corner (header.x0, z0)
//               kind    Uint8[n]   treeSpecies.ts TreeKind
//               tone    Uint8[n]   treeSpecies.ts TreeTone
//               dbh     Uint8[n]   trunk diameter, whole inches, 0 = unknown
//               ring    Uint8[n]   ring position 0-255 (ring.ts: 0 inside the
//                                  neighborhoods, 255 at the ring's edge)
//
// Every array is `header.count` long (coords twice that), in that order, so
// the offsets follow from the count. Decoded, coords are scene meters.
// Version 3 (2026-10): one file per tile, from its corner, compressed;
// version 2 was one file for the city, Int16 in scene space.

import { COORD_QUANTUM } from './format.ts'

export const TREES_MAGIC = 'CPT1'

export interface TreesHeader {
  version: 3
  i: number
  j: number
  x0: number
  z0: number
  count: number
}

export interface TreesData {
  header: TreesHeader
  coords: Float32Array // scene meters, x, z interleaved
  kind: Uint8Array
  tone: Uint8Array
  dbh: Uint8Array
  ring: Uint8Array
}

const align4 = (n: number) => (n + 3) & ~3

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(body).arrayBuffer())
}

export async function encodeTrees(data: TreesData): Promise<Uint8Array> {
  const n = data.header.count
  for (const [name, arr, len] of [
    ['coords', data.coords, 2 * n],
    ['kind', data.kind, n],
    ['tone', data.tone, n],
    ['dbh', data.dbh, n],
    ['ring', data.ring, n],
  ] as const) {
    if (arr.length !== len) throw new Error(`trees: ${name} has ${arr.length} entries, expected ${len}`)
  }
  const { x0, z0 } = data.header
  const coords = new Int16Array(2 * n)
  for (let k = 0; k < 2 * n; k++) {
    const u = Math.round((data.coords[k] - (k % 2 ? z0 : x0)) / COORD_QUANTUM)
    if (u < -32768 || u > 32767) throw new Error(`trees: a tree ${(u * COORD_QUANTUM).toFixed(0)} m from its tile's corner is outside the Int16 range`)
    coords[k] = u
  }
  const body = new Uint8Array(8 * n)
  body.set(new Uint8Array(coords.buffer), 0)
  let at = 4 * n
  for (const arr of [data.kind, data.tone, data.dbh, data.ring]) {
    body.set(arr, at)
    at += n
  }
  const header = new TextEncoder().encode(JSON.stringify(data.header))
  const base = align4(8 + header.length)
  const packed = await pipe(body, new CompressionStream('gzip'))
  const out = new Uint8Array(base + packed.length)
  out.set(new TextEncoder().encode(TREES_MAGIC), 0)
  new DataView(out.buffer).setUint32(4, header.length, true)
  out.set(header, 8)
  out.set(packed, base)
  return out
}

export async function decodeTrees(buffer: ArrayBuffer): Promise<TreesData> {
  const bytes = new Uint8Array(buffer)
  const magic = new TextDecoder().decode(bytes.subarray(0, 4))
  if (magic !== TREES_MAGIC) throw new Error(`trees: bad magic ${JSON.stringify(magic)}`)
  const headerLen = new DataView(buffer).getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen))) as TreesHeader
  if (header.version !== 3) throw new Error(`trees: unsupported version ${header.version}`)
  const n = header.count
  const body = await pipe(bytes.subarray(align4(8 + headerLen)), new DecompressionStream('gzip'))
  if (body.length < 8 * n) throw new Error(`trees: truncated (${body.length} bytes for ${n} trees)`)
  const raw = new Int16Array(body.buffer, body.byteOffset, 2 * n)
  const coords = new Float32Array(2 * n)
  for (let k = 0; k < 2 * n; k++) coords[k] = (k % 2 ? header.z0 : header.x0) + raw[k] * COORD_QUANTUM
  const u8 = (k: number) => new Uint8Array(body.buffer, body.byteOffset + 4 * n + k * n, n)
  return { header, coords, kind: u8(0), tone: u8(1), dbh: u8(2), ring: u8(3) }
}
