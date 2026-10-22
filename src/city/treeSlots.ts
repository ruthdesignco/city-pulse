// A tile's trees (treeFormat.ts) set up for drawing (Trees.tsx), in the
// tile worker (stream/tileBuild.ts): grouped by kind and crown variant
// (treeModels.ts), each tree's transform and color worked out once, on the
// ground under its trunk (terrain.ts).
//
// Per-tree variation comes from a hash of the tree's baked position
// (treeKey): stable across reloads and across rebakes that add or drop
// other trees or widen the area, which an index-based hash wasn't.

import { Color, Object3D } from 'three'
import { palette } from './palette.ts'
import type { TreesData } from './treeFormat.ts'
import { isUnitSized, variantsOf } from './treeModels.ts'
import { TREE_KINDS, type TreeKind, treeSize } from './treeSpecies.ts'

const HEIGHT_JITTER = 0.2
const CROWN_JITTER = 0.22
// Crowns a little oval from above, not perfectly round.
const STRETCH_JITTER = 0.1
const LIGHTNESS_JITTER = 0.06
const HUE_JITTER = 0.015

export interface TreeGroup {
  kind: TreeKind
  variant: number
  xz: Float32Array // 2 per tree
  matrices: Float32Array // 16 per tree
  greens: Float32Array // 3 per tree, linear
  rings: Float32Array // 1 per tree, 0..1
}

function hash(i: number, salt: number): number {
  let h = Math.imul(i ^ (salt * 0x9e3779b9), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// A tree's identity for its variation: its quantized position.
function treeKey(data: TreesData, i: number): number {
  return Math.imul(data.coords[2 * i], 0x27d4eb2d) ^ Math.imul(data.coords[2 * i + 1], 0x165667b1)
}

// Every kind and variant, in a fixed order (Trees.tsx draws one mesh each),
// empty ones included.
export function treeGroups(data: TreesData, groundAt: (x: number, z: number) => number): TreeGroup[] {
  const members: { kind: TreeKind; variant: number; trees: number[] }[] = []
  const byKey = new Map<number, number[]>()
  for (let kind = 0 as TreeKind; kind < TREE_KINDS; kind++)
    for (let variant = 0; variant < variantsOf(kind); variant++) {
      const trees: number[] = []
      members.push({ kind, variant, trees })
      byKey.set(kind * 16 + variant, trees)
    }
  for (let i = 0; i < data.header.count; i++) {
    const kind = data.kind[i] as TreeKind
    byKey.get(kind * 16 + Math.floor(hash(treeKey(data, i), 6) * variantsOf(kind)))!.push(i)
  }
  const dummy = new Object3D()
  const greens = palette.treeGreens.map((c) => new Color(c))
  const c = new Color()
  const hsl = { h: 0, s: 0, l: 0 }
  return members.map(({ kind, variant, trees }) => {
    const n = trees.length
    const g: TreeGroup = { kind, variant, xz: new Float32Array(2 * n), matrices: new Float32Array(16 * n), greens: new Float32Array(3 * n), rings: new Float32Array(n) }
    trees.forEach((t, j) => {
      const { height, crown } = treeSize(kind, data.dbh[t])
      const key = treeKey(data, t)
      const s = 1 + HEIGHT_JITTER * (2 * hash(key, 1) - 1)
      const w = 1 + CROWN_JITTER * (2 * hash(key, 2) - 1)
      const oval = STRETCH_JITTER * (2 * hash(key, 7) - 1)
      const tx = data.coords[2 * t]
      const tz = data.coords[2 * t + 1]
      g.xz.set([tx, tz], 2 * j)
      dummy.position.set(tx, groundAt(tx, tz), tz)
      dummy.rotation.set(0, 2 * Math.PI * hash(key, 3), 0)
      if (isUnitSized(kind)) dummy.scale.set(crown * w * (1 + oval), height * s, crown * w * (1 - oval))
      else dummy.scale.setScalar(s)
      dummy.updateMatrix()
      dummy.matrix.toArray(g.matrices, 16 * j)
      c.copy(greens[data.tone[t]]).getHSL(hsl)
      c.setHSL(hsl.h + HUE_JITTER * (2 * hash(key, 4) - 1), hsl.s, hsl.l * (1 + LIGHTNESS_JITTER * (2 * hash(key, 5) - 1)))
      c.toArray(g.greens, 3 * j)
      g.rings[j] = data.ring[t] / 255
    })
    return g
  })
}
