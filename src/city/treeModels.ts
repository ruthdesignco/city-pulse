// Low poly street trees, built in code (no model files). One model per
// TreeKind (treeSpecies.ts), each in two levels of detail (treeLod.ts):
//
//   near  ~80-triangle lumpy crown on a 6-sided trunk; palms get fronds
//   far   an 8-triangle crown on a 3-sided trunk, same silhouette and shading
//
// Broad and columnar trees are unit sized (height 1, crown radius 1) and
// scaled per instance by treeSize(): (crown, height, crown). Palms are built
// at their real size in meters, since a palm's size doesn't come from its
// DBH, and scaled per instance only by a small uniform jitter.
//
// Crown normals point out from the crown's center rather than per facet, so
// a canopy lights as one soft volume, the way foliage reads from a distance;
// the near and far crowns then shade alike and the switch doesn't show.
//
// Per-vertex attributes for the shader (Trees.tsx): aCrown (1 foliage, 0
// trunk) and aTone, a darkening toward the crown's underside that stands in
// for the shade inside a real canopy.

import { BufferAttribute, BufferGeometry, CylinderGeometry, IcosahedronGeometry, OctahedronGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TreeKind, treeSize } from './treeSpecies.ts'

export type TreeLevel = 'near' | 'far'

// How dark the underside of a crown is, as a multiplier.
export const CROWN_UNDERSIDE = 0.7

// Deterministic 0..1 from a direction, so shared vertices of the
// non-indexed crown move together and the surface stays closed.
function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(Math.round(x * 1000) * 12.9898 + Math.round(y * 1000) * 78.233 + Math.round(z * 1000) * 37.719) * 43758.5453
  return s - Math.floor(s)
}

function withAttrs(g: BufferGeometry, crown: number, tone: (y: number) => number): BufferGeometry {
  g.deleteAttribute('uv')
  const pos = g.getAttribute('position')
  const n = pos.count
  const aCrown = new Float32Array(n).fill(crown)
  const aTone = new Float32Array(n)
  for (let i = 0; i < n; i++) aTone[i] = tone(pos.getY(i))
  g.setAttribute('aCrown', new BufferAttribute(aCrown, 1))
  g.setAttribute('aTone', new BufferAttribute(aTone, 1))
  return g
}

interface Ellipsoid {
  cy: number // center height
  rx: number // horizontal radius
  ry: number // vertical radius
  taper?: number // narrower toward the top (columnar), 0..1
  lumps?: number // radial jitter, 0..1
}

// A crown from a unit polyhedron mapped onto an ellipsoid, normals out
// from its center (the ellipsoid's own normals).
function crown(detail: 'near' | 'far', e: Ellipsoid): BufferGeometry {
  const g = detail === 'near' ? new IcosahedronGeometry(1, 1) : new OctahedronGeometry(1, 0)
  const pos = g.getAttribute('position')
  const normal = g.getAttribute('normal')
  const lumps = detail === 'near' ? (e.lumps ?? 0.12) : 0
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i)
    const sy = pos.getY(i)
    const sz = pos.getZ(i)
    const k = 1 + lumps * (2 * hash3(sx, sy, sz) - 1)
    const narrow = 1 - (e.taper ?? 0) * Math.max(0, sy)
    const ax = e.rx * narrow
    pos.setXYZ(i, sx * ax * k, e.cy + sy * e.ry * k, sz * ax * k)
    const nx = sx / ax
    const ny = sy / e.ry
    const nz = sz / ax
    const l = Math.hypot(nx, ny, nz)
    normal.setXYZ(i, nx / l, ny / l, nz / l)
  }
  const bottom = e.cy - e.ry
  return withAttrs(g, 1, (y) => CROWN_UNDERSIDE + (1 - CROWN_UNDERSIDE) * Math.min(1, Math.max(0, (y - bottom) / (2 * e.ry))))
}

function trunk(detail: TreeLevel, radius: number, top: number, taper = 0.75): BufferGeometry {
  const g = new CylinderGeometry(radius * taper, radius, top, detail === 'near' ? 6 : 3, 1, true)
  g.translate(0, top / 2, 0)
  return withAttrs(g, 0, () => 1)
}

// One frond: a strip from the crown's center out to `length`, arching up
// then drooping `droop` below the top at its tip, `width` at its widest.
function frond(angle: number, top: number, length: number, droop: number, width: number): BufferGeometry {
  // [fraction along, height above the top as a fraction of droop, width]
  const stations = [
    [0, 0, 0.15],
    [0.45, 0.12, 1],
    [1, -1, 0.1],
  ]
  const position: number[] = []
  const normals: number[] = []
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  for (const [t, rise, w] of stations) {
    const r = t * length
    const y = top + rise * droop
    const hw = (w * width) / 2
    // Across the frond: perpendicular to its direction, horizontal.
    position.push(c * r - s * hw, y, s * r + c * hw, c * r + s * hw, y, s * r - c * hw)
    normals.push(0, 1, 0, 0, 1, 0)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  g.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5])
  return withAttrs(g.toNonIndexed(), 1, (y) => (y < top - droop * 0.5 ? CROWN_UNDERSIDE + 0.1 : 1))
}

interface PalmSpec {
  trunkRadius: number
  fronds: number
  droop: number
  width: number
  head: number // radius of the leaf-base ball at the top
}

// Height and frond length (crown radius) come from treeSize().
const PALMS: Record<number, PalmSpec> = {
  [TreeKind.FanPalm]: { trunkRadius: 0.22, fronds: 10, droop: 1.1, width: 1.3, head: 0.9 },
  [TreeKind.DatePalm]: { trunkRadius: 0.45, fronds: 14, droop: 2, width: 1.1, head: 1.2 },
  [TreeKind.FeatherPalm]: { trunkRadius: 0.16, fronds: 9, droop: 1.8, width: 0.8, head: 0.5 },
  [TreeKind.Cordyline]: { trunkRadius: 0.12, fronds: 7, droop: 0.4, width: 0.5, head: 0.5 },
}

function palm(detail: TreeLevel, kind: TreeKind): BufferGeometry {
  const p = PALMS[kind]
  const { height, crown: length } = treeSize(kind, 0)
  const top = height - p.droop * 0.3
  const parts = [trunk(detail, p.trunkRadius, top, 0.85)]
  if (detail === 'near') {
    for (let i = 0; i < p.fronds; i++) {
      const a = (2 * Math.PI * i) / p.fronds + 0.3 * Math.sin(i * 2.1)
      parts.push(frond(a, top, length * (0.85 + 0.15 * Math.cos(i * 1.7)), p.droop, p.width))
    }
    parts.push(crown('near', { cy: top, rx: p.head, ry: p.head * 0.8, lumps: 0.1 }))
  } else {
    // The frond spread as a flattened crown.
    parts.push(crown('far', { cy: top - p.droop * 0.3, rx: length * 0.8, ry: p.droop * 0.6 }))
  }
  return merge(parts)
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const indexless = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  const merged = mergeGeometries(indexless)
  for (const g of new Set([...parts, ...indexless])) g.dispose()
  if (!merged) throw new Error('treeModels: could not merge parts')
  return merged
}

export function treeGeometry(kind: TreeKind, detail: TreeLevel): BufferGeometry {
  switch (kind) {
    case TreeKind.Broad:
      return merge([trunk(detail, 0.09, 0.45), crown(detail, { cy: 0.62, rx: 1, ry: 0.38 })])
    case TreeKind.Columnar:
      return merge([trunk(detail, 0.12, 0.3), crown(detail, { cy: 0.58, rx: 1, ry: 0.42, taper: 0.3 })])
    default:
      return palm(detail, kind)
  }
}

// Whether a kind's geometry is unit sized (scaled by treeSize) or in meters.
export const isUnitSized = (kind: TreeKind) => kind === TreeKind.Broad || kind === TreeKind.Columnar

// Fronds are single sheets: palms draw both sides.
export const isDoubleSided = (kind: TreeKind) => !isUnitSized(kind)
