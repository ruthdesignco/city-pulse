// The ground mesh over the terrain (terrain.ts), in tiles that each draw at
// the detail their distance needs: every terrain sample (5 m) up close,
// every 2nd, 4th or 8th further out. A coarser tile's samples are lowered
// by the most the cells around them rise above the true ground, so it
// never pokes through what's placed on the true ground (streets, building
// bases), and each
// tile hangs a skirt from its edges to hide the cracks where neighbors
// differ in detail. Its cells split along the same diagonal heightAt uses.
//
// The ground's shading comes from a normal map of the full 5 m grid
// (groundShading.ts), not from these vertices, so a coarse tile still
// shows every slope.

import { BufferAttribute, BufferGeometry } from 'three'
import type { Terrain } from './terrain.ts'

export const TILE_CELLS = 128
export const LOD_STEPS = [1, 2, 4, 8] as const
// A tile takes the first step whose distance (m, from the camera to the
// tile's nearest point) it's within; past the last, the coarsest.
export const LOD_DISTANCE_M = [700, 1600, 3500]
// Deep enough to also hide the step where the city's terrain meets the
// backdrop's coarser hills at its edge (Ground.tsx).
const SKIRT_M = 30

export interface TileRange {
  i0: number
  j0: number
  i1: number // last sample, inclusive
  j1: number
}

export function tileRanges(t: Terrain): TileRange[] {
  const { nx, nz } = t.header
  const out: TileRange[] = []
  for (let j0 = 0; j0 < nz - 1; j0 += TILE_CELLS)
    for (let i0 = 0; i0 < nx - 1; i0 += TILE_CELLS) out.push({ i0, j0, i1: Math.min(nx - 1, i0 + TILE_CELLS), j1: Math.min(nz - 1, j0 + TILE_CELLS) })
  return out
}

export function lodFor(distance: number): number {
  const k = LOD_DISTANCE_M.findIndex((d) => distance < d)
  return k === -1 ? LOD_STEPS.length - 1 : k
}

// The sample positions a tile uses at `step`: every step-th, plus its last.
function axis(a0: number, a1: number, step: number): number[] {
  const out: number[] = []
  for (let a = a0; a < a1; a += step) out.push(a)
  out.push(a1)
  return out
}

// How far each coarse cell's surface (through samples `is` x `js`) rises
// above the true one anywhere in it, m (all 0 at full detail): cell (a, b)
// at a + b * (is.length - 1).
export function cellErrors(t: Terrain, r: TileRange, is: number[], js: number[]): Float32Array {
  const out = new Float32Array((is.length - 1) * (js.length - 1))
  if (is.length === r.i1 - r.i0 + 1 && js.length === r.j1 - r.j0 + 1) return out
  for (let b = 0; b < js.length - 1; b++)
    for (let a = 0; a < is.length - 1; a++) {
      const [ia, ib, ja, jb] = [is[a], is[a + 1], js[b], js[b + 1]]
      const h00 = t.at(ia, ja)
      const h10 = t.at(ib, ja)
      const h01 = t.at(ia, jb)
      const h11 = t.at(ib, jb)
      let worst = 0
      for (let j = ja; j <= jb; j++)
        for (let i = ia; i <= ib; i++) {
          const fu = (i - ia) / (ib - ia)
          const fv = (j - ja) / (jb - ja)
          const coarse = fu >= fv ? h00 + (h10 - h00) * fu + (h11 - h10) * fv : h00 + (h01 - h00) * fv + (h11 - h01) * fu
          worst = Math.max(worst, coarse - t.at(i, j))
        }
      out[b * (is.length - 1) + a] = worst
    }
  return out
}

// The most any cell rises above the true ground.
export function coarseError(t: Terrain, r: TileRange, is: number[], js: number[]): number {
  return cellErrors(t, r, is, js).reduce((m, v) => Math.max(m, v), 0)
}

// One tile at one level of detail: a grid of samples `y` below the
// terrain, each lowered by the most any cell it's a corner of rises above
// the true ground (so every cell's triangles lie at or under it: a coarse
// tile with a hill in it no longer sinks its flat waterfront under the
// Bay), with a skirt. Draw it
// double-sided: the skirt's walls face either way.
export function buildTile(t: Terrain, r: TileRange, step: number, y: number): BufferGeometry {
  const { position, index } = tileArrays(t, r, step, y)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(position, 3))
  g.setIndex(new BufferAttribute(index, 1))
  g.computeBoundingSphere()
  return g
}

// buildTile's vertices and triangles, for the tile worker (stream/tileBuild.ts).
export function tileArrays(t: Terrain, r: TileRange, step: number, y: number): { position: Float32Array; index: Uint16Array | Uint32Array } {
  const { x0, z0, cell } = t.header
  const is = axis(r.i0, r.i1, step)
  const js = axis(r.j0, r.j1, step)
  const errors = cellErrors(t, r, is, js)
  const w = is.length
  const h = js.length
  const drop = (a: number, b: number) => {
    let d = 0
    for (let cb = Math.max(0, b - 1); cb <= Math.min(h - 2, b); cb++) for (let ca = Math.max(0, a - 1); ca <= Math.min(w - 2, a); ca++) d = Math.max(d, errors[cb * (w - 1) + ca])
    return d
  }
  const border: number[] = []
  for (let a = 0; a < w; a++) border.push(a)
  for (let b = 1; b < h; b++) border.push(b * w + w - 1)
  for (let a = w - 2; a >= 0; a--) border.push((h - 1) * w + a)
  for (let b = h - 2; b >= 1; b--) border.push(b * w)
  const position = new Float32Array((w * h + border.length) * 3)
  for (let b = 0; b < h; b++)
    for (let a = 0; a < w; a++) position.set([x0 + is[a] * cell, t.at(is[a], js[b]) + y - drop(a, b), z0 + js[b] * cell], (b * w + a) * 3)
  const index: number[] = []
  for (let b = 0; b < h - 1; b++)
    for (let a = 0; a < w - 1; a++) {
      const p = b * w + a
      // Split (a, b)-(a + 1, b + 1), facing up, as terrain.ts heightAt.
      index.push(p, p + w + 1, p + 1, p, p + w, p + w + 1)
    }
  // The skirt: the border's samples again, SKIRT_M lower, walled to the border.
  border.forEach((v, k) => position.set([position[v * 3], position[v * 3 + 1] - SKIRT_M, position[v * 3 + 2]], (w * h + k) * 3))
  for (let k = 0; k < border.length; k++) {
    const a = border[k]
    const b = border[(k + 1) % border.length]
    const la = w * h + k
    const lb = w * h + ((k + 1) % border.length)
    index.push(a, lb, b, a, la, lb)
  }
  return { position, index: position.length / 3 > 65535 ? new Uint32Array(index) : new Uint16Array(index) }
}
