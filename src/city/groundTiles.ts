// The ground mesh over the terrain (terrain.ts), in tiles that each draw at
// the detail their distance needs: every terrain sample (5 m) up close,
// every 2nd, 4th or 8th further out. A coarser tile is lowered by the most
// it rises above the true ground anywhere in it, so it never pokes through
// what's placed on the true ground (streets, building bases), and each
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
const SKIRT_M = 6

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

// How far the coarse surface (through samples `is` x `js`) rises above the
// true one anywhere in the tile, m (0 at full detail).
export function coarseError(t: Terrain, r: TileRange, is: number[], js: number[]): number {
  if (is.length === r.i1 - r.i0 + 1 && js.length === r.j1 - r.j0 + 1) return 0
  let worst = 0
  for (let b = 0; b < js.length - 1; b++)
    for (let a = 0; a < is.length - 1; a++) {
      const [ia, ib, ja, jb] = [is[a], is[a + 1], js[b], js[b + 1]]
      const h00 = t.at(ia, ja)
      const h10 = t.at(ib, ja)
      const h01 = t.at(ia, jb)
      const h11 = t.at(ib, jb)
      for (let j = ja; j <= jb; j++)
        for (let i = ia; i <= ib; i++) {
          const fu = (i - ia) / (ib - ia)
          const fv = (j - ja) / (jb - ja)
          const coarse = fu >= fv ? h00 + (h10 - h00) * fu + (h11 - h10) * fv : h00 + (h01 - h00) * fv + (h11 - h01) * fu
          worst = Math.max(worst, coarse - t.at(i, j))
        }
    }
  return worst
}

// One tile at one level of detail: a grid of samples `y` below the
// terrain (and its own error lower still), with a skirt. Draw it
// double-sided: the skirt's walls face either way.
export function buildTile(t: Terrain, r: TileRange, step: number, y: number): BufferGeometry {
  const { x0, z0, cell } = t.header
  const is = axis(r.i0, r.i1, step)
  const js = axis(r.j0, r.j1, step)
  const drop = coarseError(t, r, is, js)
  const w = is.length
  const h = js.length
  const border: number[] = []
  for (let a = 0; a < w; a++) border.push(a)
  for (let b = 1; b < h; b++) border.push(b * w + w - 1)
  for (let a = w - 2; a >= 0; a--) border.push((h - 1) * w + a)
  for (let b = h - 2; b >= 1; b--) border.push(b * w)
  const position = new Float32Array((w * h + border.length) * 3)
  for (let b = 0; b < h; b++)
    for (let a = 0; a < w; a++) position.set([x0 + is[a] * cell, t.at(is[a], js[b]) + y - drop, z0 + js[b] * cell], (b * w + a) * 3)
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
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(position, 3))
  g.setIndex(new BufferAttribute(position.length / 3 > 65535 ? new Uint32Array(index) : new Uint16Array(index), 1))
  g.computeBoundingSphere()
  return g
}
