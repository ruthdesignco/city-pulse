// The ground's height: USGS 3DEP elevations baked onto a grid
// (scripts/bake-terrain.ts, src/data/terrain.bin). Everything that stands on
// the ground asks heightAt(x, z) (buildings, streets, paving, trees,
// vehicles, landmarks, the camera), and the ground mesh is the same grid
// (Ground.tsx), each cell split into two triangles along the same diagonal
// heightAt uses, so whatever is placed with it sits exactly on the drawn
// ground.
//
//   bytes 0-3   "CPH1"
//   bytes 4-7   u32 LE: header JSON byte length
//   then        header JSON (utf8), padded to a 4-byte boundary
//   then        Int16[nx * nz] heights in `quantum` m, rows from minZ (north)
//
// Off the grid: the nearest edge's height (the bake tapers the edges to sea
// level, where the flat land beyond takes over).

export const TERRAIN_MAGIC = 'CPH1'

export interface TerrainHeader {
  version: 1
  x0: number // scene m, the first column
  z0: number // scene m, the first row (north)
  cell: number // m between samples
  nx: number
  nz: number
  quantum: number // m per Int16 unit
  source: string
  datum: string
  bakedAt: string
}

export class Terrain {
  readonly header: TerrainHeader
  readonly heights: Int16Array

  constructor(header: TerrainHeader, heights: Int16Array) {
    if (heights.length !== header.nx * header.nz) throw new Error('terrain: height count does not match the grid')
    this.header = header
    this.heights = heights
  }

  // The height of grid point (i, j), m.
  at(i: number, j: number): number {
    const { nx, nz, quantum } = this.header
    const ii = Math.min(nx - 1, Math.max(0, i))
    const jj = Math.min(nz - 1, Math.max(0, j))
    return this.heights[jj * nx + ii] * quantum
  }

  // The ground's height at scene (x, z): on the triangle of its cell that
  // the ground mesh draws (split from (i, j) to (i + 1, j + 1)).
  heightAt(x: number, z: number): number {
    const { x0, z0, cell, nx, nz } = this.header
    const u = Math.min(nx - 1, Math.max(0, (x - x0) / cell))
    const v = Math.min(nz - 1, Math.max(0, (z - z0) / cell))
    const i = Math.min(nx - 2, Math.floor(u))
    const j = Math.min(nz - 2, Math.floor(v))
    const fu = u - i
    const fv = v - j
    const h00 = this.at(i, j)
    const h11 = this.at(i + 1, j + 1)
    if (fu >= fv) return h00 + (this.at(i + 1, j) - h00) * fu + (h11 - this.at(i + 1, j)) * fv
    return h00 + (this.at(i, j + 1) - h00) * fv + (h11 - this.at(i, j + 1)) * fu
  }
}

// The ground's up-facing unit normal at (x, z), from its slope over a cell.
export function groundNormal(t: Terrain, x: number, z: number, out: [number, number, number] = [0, 1, 0]): [number, number, number] {
  const d = t.header.cell / 2
  const sx = (t.heightAt(x + d, z) - t.heightAt(x - d, z)) / (2 * d)
  const sz = (t.heightAt(x, z + d) - t.heightAt(x, z - d)) / (2 * d)
  const l = Math.hypot(sx, 1, sz)
  out[0] = -sx / l
  out[1] = 1 / l
  out[2] = -sz / l
  return out
}

// Lift a flat mesh's vertices (x, y, z) onto the ground: y += its height,
// and, with `normals`, each normal set to the ground's.
export function drape(t: Terrain, positions: Float32Array, normals?: Float32Array) {
  const n: [number, number, number] = [0, 1, 0]
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] += t.heightAt(positions[i], positions[i + 2])
    if (normals) normals.set(groundNormal(t, positions[i], positions[i + 2], n), i)
  }
}

// Points along a polyline no more than `step` apart, keeping its own.
export function densify(line: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < line.length; i++) {
    if (i > 0) {
      const [ax, az] = line[i - 1]
      const [bx, bz] = line[i]
      const k = Math.ceil(Math.hypot(bx - ax, bz - az) / step)
      for (let j = 1; j < k; j++) out.push([ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k])
    }
    out.push(line[i])
  }
  return out
}

// Flat ground at sea level: for tests, and before there's a terrain.bin.
export const FLAT: Terrain = new Terrain(
  { version: 1, x0: 0, z0: 0, cell: 1, nx: 2, nz: 2, quantum: 0.1, source: 'flat', datum: '', bakedAt: '' },
  new Int16Array(4),
)

const align4 = (n: number) => (n + 3) & ~3

export function encodeTerrain(t: Terrain): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(t.header))
  const base = align4(8 + json.length)
  const out = new Uint8Array(base + t.heights.byteLength)
  out.set(new TextEncoder().encode(TERRAIN_MAGIC), 0)
  new DataView(out.buffer).setUint32(4, json.length, true)
  out.set(json, 8)
  out.set(new Uint8Array(t.heights.buffer, t.heights.byteOffset, t.heights.byteLength), base)
  return out
}

export function decodeTerrain(buffer: ArrayBuffer): Terrain {
  const bytes = new Uint8Array(buffer)
  const magic = new TextDecoder().decode(bytes.subarray(0, 4))
  if (magic !== TERRAIN_MAGIC) throw new Error(`terrain.bin: bad magic ${JSON.stringify(magic)}`)
  const len = new DataView(buffer).getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as TerrainHeader
  if (header.version !== 1) throw new Error(`terrain.bin: unsupported version ${header.version}`)
  const base = align4(8 + len)
  return new Terrain(header, new Int16Array(buffer.slice(base, base + 2 * header.nx * header.nz)))
}
