// Low poly street trees, built in code (no model files). One model per
// TreeKind (treeSpecies.ts), each in two levels of detail (treeLod.ts):
//
//   near  a ~160-triangle crown of lumpy blobs (CROWN_VARIANTS layouts per
//         kind) on a 6-sided trunk; palms get fronds
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
export const CROWN_UNDERSIDE = 0.8

// Shape variants per broad or columnar kind: each tree gets one (Trees.tsx),
// so neighbors don't share a silhouette.
export const CROWN_VARIANTS = 4
export const variantsOf = (kind: TreeKind) => (isUnitSized(kind) ? CROWN_VARIANTS : 1)

// Deterministic 0..1 from a direction and a salt, so shared vertices of a
// non-indexed blob move together and its surface stays closed.
function hash3(x: number, y: number, z: number, salt = 0): number {
  const s = Math.sin(Math.round(x * 1000) * 12.9898 + Math.round(y * 1000) * 78.233 + Math.round(z * 1000) * 37.719 + salt * 17.13) * 43758.5453
  return s - Math.floor(s)
}

// A small seeded generator for laying out a variant's blobs.
function rng(seed: number): () => number {
  let a = (seed * 0x9e3779b9) >>> 0 || 1
  return () => {
    a ^= a << 13
    a ^= a >>> 17
    a ^= a << 5
    return (a >>> 0) / 4294967296
  }
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

const ellipsoidNormal = (x: number, y: number, z: number, e: Ellipsoid, cx = 0, cz = 0): [number, number, number] => {
  const nx = (x - cx) / (e.rx * e.rx)
  const ny = (y - e.cy) / (e.ry * e.ry)
  const nz = (z - cz) / (e.rx * e.rx)
  const l = Math.hypot(nx, ny, nz) || 1
  return [nx / l, ny / l, nz / l]
}

// One blob of foliage: a unit polyhedron mapped onto an ellipsoid at (cx,
// cz), lumpy. Normals lean out from `whole` (the crown it belongs to) as
// well as from the blob itself, so a crown of several blobs shades as one
// soft, uneven volume.
function blob(detail: 0 | 1 | 'far', e: Ellipsoid, cx = 0, cz = 0, salt = 0, whole: Ellipsoid = e): BufferGeometry {
  const g = detail === 'far' ? new OctahedronGeometry(1, 0) : new IcosahedronGeometry(1, detail)
  const pos = g.getAttribute('position')
  const normal = g.getAttribute('normal')
  const lumps = detail === 'far' ? 0 : (e.lumps ?? 0.12)
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i)
    const sy = pos.getY(i)
    const sz = pos.getZ(i)
    const k = 1 + lumps * (2 * hash3(sx, sy, sz, salt) - 1)
    const ax = e.rx * (1 - (e.taper ?? 0) * Math.max(0, sy))
    const x = cx + sx * ax * k
    const y = e.cy + sy * e.ry * k
    const z = cz + sz * ax * k
    pos.setXYZ(i, x, y, z)
    const own = ellipsoidNormal(sx * ax, e.cy + sy * e.ry, sz * ax, { ...e, rx: ax })
    const out = ellipsoidNormal(x, y, z, whole)
    const nx = own[0] + 2 * out[0]
    const ny = own[1] + 2 * out[1]
    const nz = own[2] + 2 * out[2]
    const l = Math.hypot(nx, ny, nz)
    normal.setXYZ(i, nx / l, ny / l, nz / l)
  }
  const bottom = whole.cy - whole.ry
  return withAttrs(g, 1, (y) => CROWN_UNDERSIDE + (1 - CROWN_UNDERSIDE) * Math.min(1, Math.max(0, (y - bottom) / (2 * whole.ry))))
}

// A crown near up: a lumpy core with four smaller lumpy blobs pushed out
// around its sides and top, laid out by `variant`, so the silhouette is
// irregular the way a real canopy's is. ~160 triangles. Far away: one
// 8-triangle ellipsoid of the same size.
function crown(detail: TreeLevel, e: Ellipsoid, variant = 0): BufferGeometry {
  if (detail === 'far') return blob('far', e)
  const r = rng(variant + 1)
  const parts = [blob(1, { ...e, rx: e.rx * 0.78, ry: e.ry * 0.8, lumps: 0.16 }, 0, 0, variant, e)]
  const start = 2 * Math.PI * r()
  for (let i = 0; i < 4; i++) {
    const a = start + (2 * Math.PI * i) / 4 + 0.6 * (r() - 0.5)
    const out = e.rx * (0.4 + 0.2 * r())
    const sub: Ellipsoid = {
      cy: e.cy + e.ry * (-0.25 + 0.65 * r()),
      rx: e.rx * (0.42 + 0.18 * r()),
      ry: e.ry * (0.5 + 0.15 * r()),
      taper: e.taper,
      lumps: 0.18,
    }
    parts.push(blob(0, sub, Math.cos(a) * out * (1 - (e.taper ?? 0) * 0.5), Math.sin(a) * out * (1 - (e.taper ?? 0) * 0.5), variant * 7 + i, e))
  }
  return merge(parts)
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
    parts.push(blob(1, { cy: top, rx: p.head, ry: p.head * 0.8, lumps: 0.1 }))
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

export function treeGeometry(kind: TreeKind, detail: TreeLevel, variant = 0): BufferGeometry {
  switch (kind) {
    case TreeKind.Broad:
      return merge([trunk(detail, 0.09, 0.45), crown(detail, { cy: 0.6, rx: 0.9, ry: 0.36 }, variant)])
    case TreeKind.Columnar:
      return merge([trunk(detail, 0.12, 0.3), crown(detail, { cy: 0.57, rx: 0.9, ry: 0.4, taper: 0.3 }, variant)])
    default:
      return palm(detail, kind)
  }
}

// Whether a kind's geometry is unit sized (scaled by treeSize) or in meters.
export const isUnitSized = (kind: TreeKind) => kind === TreeKind.Broad || kind === TreeKind.Columnar

// Fronds are single sheets: palms draw both sides.
export const isDoubleSided = (kind: TreeKind) => !isUnitSized(kind)
