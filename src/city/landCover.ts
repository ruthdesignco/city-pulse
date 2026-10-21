// What the land around the city is (src/data/landcover.bin, from
// bake-landcover.ts): OpenStreetMap's land use and natural cover over the
// backdrop's grid (bake-backdrop.ts), as soft fractions per sample, for the
// backdrop (Ground.tsx) and the city's own terrain past the bake area. Plus
// a few buildings where the backdrop has an island worth them (Alcatraz).
//
// Each sample is four bytes, 0..255 of it:
//   r  urban: residential, commercial, retail, industrial land use
//   g  grass: parks, meadow, grassland (and half of scrub)
//   b  wood: woods, forest (and half of scrub)
//   a  rock: bare rock, scree, cliffs (and half of sand)
// What's left is untagged land, colored by its slope and height alone.

const MAGIC = 'CPL1'

export interface LandBuilding {
  ring: [number, number][] // scene x, z, counterclockwise seen from above
  height: number // m above the lowest ground under it
  name?: string
}

export interface LandCoverHeader {
  version: 1
  x0: number
  z0: number
  cell: number
  nx: number
  nz: number
  buildings: LandBuilding[]
  source: string
  bakedAt: string
}

export interface LandCover {
  header: LandCoverHeader
  rgba: Uint8Array // nx * nz * 4, row by row from (x0, z0)
}

const align4 = (n: number) => (n + 3) & ~3

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(body).arrayBuffer())
}

export async function encodeLandCover(c: LandCover): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(c.header))
  const base = align4(8 + json.length)
  const packed = await pipe(c.rgba, new CompressionStream('gzip'))
  const out = new Uint8Array(base + packed.length)
  out.set(new TextEncoder().encode(MAGIC), 0)
  new DataView(out.buffer).setUint32(4, json.length, true)
  out.set(json, 8)
  out.set(packed, base)
  return out
}

export async function decodeLandCover(buffer: ArrayBuffer): Promise<LandCover> {
  const bytes = new Uint8Array(buffer)
  const magic = new TextDecoder().decode(bytes.subarray(0, 4))
  if (magic !== MAGIC) throw new Error(`landcover.bin: bad magic ${JSON.stringify(magic)}`)
  const len = new DataView(buffer).getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as LandCoverHeader
  if (header.version !== 1) throw new Error(`landcover.bin: unsupported version ${header.version}`)
  const rgba = await pipe(bytes.subarray(align4(8 + len)), new DecompressionStream('gzip'))
  if (rgba.length !== 4 * header.nx * header.nz) throw new Error('landcover.bin: wrong number of samples')
  return { header, rgba }
}
