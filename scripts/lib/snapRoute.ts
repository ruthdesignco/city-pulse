// Snap a GTFS route shape onto the street centerlines the city draws
// (city.bin, from OpenStreetMap), so vehicles drive on the asphalt instead
// of beside it: GTFS shapes are traced separately and wander a few meters
// off OSM's centerlines, onto sidewalks and into buildings.
//
//   1. Sample the shape every SAMPLE_M. Each sample snaps to the nearest
//      street segment within SNAP_M that runs the same way (within
//      ALIGN_DEG), preferring the street it was already on (dual
//      carriageways, parallel ways). Samples near no such street (tunnels,
//      rights-of-way, outside the drawn streets) keep their GTFS position.
//   2. Consecutive samples on one street form a run. Where the route turns
//      from one street onto another, the two runs meet at the streets'
//      intersection (the few samples cutting the corner are dropped).
//   3. Corners are rounded with a TURN_RADIUS_M arc (less where the legs
//      are short), as a bus or train actually turns.
//
// Each output vertex carries the class of the street it's on (StreetClass,
// or OFF_STREET), for the lane offset at runtime (src/transit/lanes.ts).

import { type Pt, simplifyLine } from './geometry.ts'

export const OFF_STREET = 3
export const SAMPLE_M = 4
export const SNAP_M = 15
export const ALIGN_DEG = 25
// Keep to the street a sample was on unless another is this much nearer.
const STICKY_M = 3
// A corner's intersection may be this far from either run's end.
const CORNER_REACH_M = 30
// Off-street stretches shorter than this between two snapped runs are the
// corner being cut, not a real departure from the streets.
const CORNER_GAP_M = 30
export const TURN_RADIUS_M = 14
const ARC_STEP_DEG = 10
const SIMPLIFY_M = 0.3
// Each snapped sample must land at least this far ahead (along the shape's
// own direction) of the last one kept: where OSM ways overlap or a street
// changes from one way to the next, a projection can fall behind, and the
// line would double back.
const MIN_PROGRESS_M = 0.5
// Corners that only fit an arc tighter than this keep their vertex.
const MIN_RADIUS_M = 4
// Turns gentler than this keep their vertex.
const MIN_TURN_DEG = 8
const CELL_M = 25

export interface Street {
  line: Pt[]
  cls: number
}

interface Segment {
  street: number
  ax: number
  az: number
  ux: number // unit direction
  uz: number
  len: number
  cls: number
}

export class StreetIndex {
  readonly segments: Segment[] = []
  private readonly grid = new Map<string, number[]>()

  constructor(streets: Street[]) {
    streets.forEach((st, k) => {
      for (let i = 0; i < st.line.length - 1; i++) {
        const [ax, az] = st.line[i]
        const [bx, bz] = st.line[i + 1]
        const len = Math.hypot(bx - ax, bz - az)
        if (len < 1e-6) continue
        const id = this.segments.push({ street: k, ax, az, ux: (bx - ax) / len, uz: (bz - az) / len, len, cls: st.cls }) - 1
        // Every cell the segment's box, padded by SNAP_M, touches.
        const x0 = Math.floor((Math.min(ax, bx) - SNAP_M) / CELL_M)
        const x1 = Math.floor((Math.max(ax, bx) + SNAP_M) / CELL_M)
        const z0 = Math.floor((Math.min(az, bz) - SNAP_M) / CELL_M)
        const z1 = Math.floor((Math.max(az, bz) + SNAP_M) / CELL_M)
        for (let x = x0; x <= x1; x++)
          for (let z = z0; z <= z1; z++) {
            const key = `${x},${z}`
            const list = this.grid.get(key)
            if (list) list.push(id)
            else this.grid.set(key, [id])
          }
      }
    })
  }

  near(x: number, z: number): number[] {
    return this.grid.get(`${Math.floor(x / CELL_M)},${Math.floor(z / CELL_M)}`) ?? []
  }
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
const lengthOf = (pts: Pt[]) => pts.slice(1).reduce((n, p, i) => n + dist(p, pts[i]), 0)

// Points every `step` along the line, each with its segment's direction.
function resample(line: Pt[], step: number): { p: Pt; ux: number; uz: number }[] {
  const out: { p: Pt; ux: number; uz: number }[] = []
  let next = 0 // distance into the current segment of the next sample
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i]
    const [bx, bz] = line[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 1e-9) continue
    const ux = (bx - ax) / len
    const uz = (bz - az) / len
    for (; next < len; next += step) out.push({ p: [ax + ux * next, az + uz * next], ux, uz })
    next -= len
    if (i === line.length - 2) out.push({ p: [bx, bz], ux, uz })
  }
  return out
}

interface Run {
  street: number // -1: off street
  cls: number
  pts: Pt[]
}

// Step 1: the shape as runs of points snapped to one street, or not snapped.
function snapRuns(line: Pt[], index: StreetIndex): Run[] {
  const cosAlign = Math.cos((ALIGN_DEG * Math.PI) / 180)
  const runs: Run[] = []
  let current = -1
  let lastKept: Pt | null = null
  for (const { p, ux, uz } of resample(line, SAMPLE_M)) {
    type Hit = { seg: Segment; q: Pt; d: number }
    let best = null as Hit | null
    let same = null as Hit | null
    for (const id of index.near(p[0], p[1])) {
      const seg = index.segments[id]
      // Streets are two-way here: only the line's direction matters.
      if (Math.abs(seg.ux * ux + seg.uz * uz) < cosAlign) continue
      const t = Math.min(seg.len, Math.max(0, (p[0] - seg.ax) * seg.ux + (p[1] - seg.az) * seg.uz))
      const q: Pt = [seg.ax + seg.ux * t, seg.az + seg.uz * t]
      const d = dist(p, q)
      if (d > SNAP_M) continue
      if (!best || d < best.d) best = { seg, q, d }
      if (seg.street === current && (!same || d < same.d)) same = { seg, q, d }
    }
    const pick = same && best && same.d <= best.d + STICKY_M ? same : best
    const street = pick ? pick.seg.street : -1
    const q = pick ? pick.q : p
    if (lastKept && (q[0] - lastKept[0]) * ux + (q[1] - lastKept[1]) * uz < MIN_PROGRESS_M) continue
    lastKept = q
    const last = runs[runs.length - 1]
    if (last && last.street === street) last.pts.push(q)
    else runs.push({ street, cls: pick ? pick.seg.cls : OFF_STREET, pts: [q] })
    current = street
  }
  // A short off-street stretch between two streets is the corner being cut.
  const kept = runs.filter(
    (r, i) => !(r.street === -1 && i > 0 && i < runs.length - 1 && runs[i - 1].street !== -1 && runs[i + 1].street !== -1 && lengthOf(r.pts) < CORNER_GAP_M),
  )
  // Merge neighbors on the same street that the drop brought together.
  const merged: Run[] = []
  for (const r of kept) {
    const last = merged[merged.length - 1]
    if (last && last.street === r.street) last.pts.push(...r.pts)
    else merged.push({ ...r, pts: [...r.pts] })
  }
  return merged.map((r) => (r.street === -1 || r.pts.length < 3 ? r : { ...r, pts: simplifyLine(r.pts, SIMPLIFY_M) }))
}

// Where the lines through a0->a1 and b0->b1 cross, if they aren't parallel.
function crossing(a0: Pt, a1: Pt, b0: Pt, b1: Pt): Pt | null {
  const rx = a1[0] - a0[0]
  const rz = a1[1] - a0[1]
  const sx = b1[0] - b0[0]
  const sz = b1[1] - b0[1]
  const den = rx * sz - rz * sx
  if (Math.abs(den) < 1e-6 * Math.hypot(rx, rz) * Math.hypot(sx, sz)) return null
  const t = ((b0[0] - a0[0]) * sz - (b0[1] - a0[1]) * sx) / den
  return [a0[0] + rx * t, a0[1] + rz * t]
}

interface Vertex {
  p: Pt
  cls: number
}

// Step 2: one line from the runs. Two snapped runs on different streets
// meet at the streets' intersection: the first is cut back to it, the
// second starts from it.
function joinRuns(runs: Run[]): Vertex[] {
  const pts = runs.map((r) => [...r.pts])
  const corners: (Pt | null)[] = runs.map(() => null)
  for (let i = 0; i < runs.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (runs[i].street === -1 || runs[i + 1].street === -1 || a.length < 2 || b.length < 2) continue
    const c = crossing(a[a.length - 2], a[a.length - 1], b[0], b[1])
    if (!c || dist(c, a[a.length - 1]) > CORNER_REACH_M || dist(c, b[0]) > CORNER_REACH_M) continue
    // Drop the first run's points past the corner and the second's before it.
    while (a.length > 1) {
      const [p, q] = [a[a.length - 2], a[a.length - 1]]
      if ((q[0] - c[0]) * (q[0] - p[0]) + (q[1] - c[1]) * (q[1] - p[1]) <= 0) break
      a.pop()
    }
    while (b.length > 1) {
      const [p, q] = [b[0], b[1]]
      if ((p[0] - c[0]) * (q[0] - p[0]) + (p[1] - c[1]) * (q[1] - p[1]) >= 0) break
      b.shift()
    }
    corners[i] = c
  }
  const out: Vertex[] = []
  const push = (p: Pt, cls: number) => {
    if (!out.length || dist(out[out.length - 1].p, p) > 0.05) out.push({ p, cls })
  }
  runs.forEach((r, i) => {
    for (const p of pts[i]) push(p, r.cls)
    const c = corners[i]
    if (c) push(c, r.cls)
  })
  return out
}

// Step 3: round every corner with an arc of TURN_RADIUS_M, or less where
// the legs either side are too short for it (each arc uses at most half of
// a leg).
// Vertices in a straight line with both neighbors (within STRAIGHT_DEG) add
// nothing, and would shorten the legs a corner can round over. (A class
// change there moves to the next vertex; the lane offset eases across the
// leg instead of stepping.)
const STRAIGHT_DEG = 0.5
function dropStraight(v: Vertex[]): Vertex[] {
  const cos = Math.cos((STRAIGHT_DEG * Math.PI) / 180)
  const out: Vertex[] = [v[0]]
  for (let i = 1; i < v.length - 1; i++) {
    const p = out[out.length - 1]
    const c = v[i]
    const n = v[i + 1]
    const l0 = dist(p.p, c.p)
    const l1 = dist(c.p, n.p)
    const straight = l0 > 1e-6 && l1 > 1e-6 && ((c.p[0] - p.p[0]) * (n.p[0] - c.p[0]) + (c.p[1] - p.p[1]) * (n.p[1] - c.p[1])) / (l0 * l1) >= cos
    if (!(straight && c.cls === n.cls)) out.push(c)
  }
  if (v.length > 1) out.push(v[v.length - 1])
  return out
}

// Spurs and jags left where runs meet (overlapping OSM ways, a corner placed
// a little past a run's end): a vertex the line doubles back from, or a
// sharp turn on a leg too short to be a real one. Removed until none are left.
const SPIKE_DEG = 150
const JAG_DEG = 60
const JAG_LEG_M = 4
function dropSpikes(v: Vertex[]): Vertex[] {
  const cosSpike = Math.cos((SPIKE_DEG * Math.PI) / 180)
  const cosJag = Math.cos((JAG_DEG * Math.PI) / 180)
  let out = v
  for (let changed = true; changed && out.length > 2; ) {
    changed = false
    const next: Vertex[] = [out[0]]
    for (let i = 1; i < out.length - 1; i++) {
      const p = next[next.length - 1].p
      const c = out[i].p
      const n = out[i + 1].p
      const l0 = dist(p, c)
      const l1 = dist(c, n)
      const cos = l0 > 1e-6 && l1 > 1e-6 ? ((c[0] - p[0]) * (n[0] - c[0]) + (c[1] - p[1]) * (n[1] - c[1])) / (l0 * l1) : 1
      if (l0 < 1e-6 || cos < cosSpike || (cos < cosJag && Math.min(l0, l1) < JAG_LEG_M)) {
        changed = true
        continue
      }
      next.push(out[i])
    }
    next.push(out[out.length - 1])
    out = next
  }
  return out
}

function roundCorners(v: Vertex[]): Vertex[] {
  if (v.length < 3) return v
  const out: Vertex[] = [v[0]]
  for (let i = 1; i < v.length - 1; i++) {
    const [px, pz] = v[i - 1].p
    const [cx, cz] = v[i].p
    const [nx, nz] = v[i + 1].p
    const l0 = Math.hypot(cx - px, cz - pz)
    const l1 = Math.hypot(nx - cx, nz - cz)
    if (l0 < 1e-6 || l1 < 1e-6) continue
    const ax = (cx - px) / l0
    const az = (cz - pz) / l0
    const bx = (nx - cx) / l1
    const bz = (nz - cz) / l1
    const turn = Math.acos(Math.min(1, Math.max(-1, ax * bx + az * bz)))
    if (turn < (MIN_TURN_DEG * Math.PI) / 180 || turn > Math.PI - 0.05) {
      out.push(v[i])
      continue
    }
    const half = Math.tan(turn / 2)
    const t = Math.min(TURN_RADIUS_M * half, l0 / 2, l1 / 2)
    const r = t / half
    if (r < MIN_RADIUS_M) {
      out.push(v[i])
      continue
    }
    // The arc's center sits r to the inside of the turn from the entry tangent point.
    const side = ax * bz - az * bx > 0 ? 1 : -1
    const sx = cx - ax * t
    const sz = cz - az * t
    const ox = sx - az * side * r
    const oz = sz + ax * side * r
    const a0 = Math.atan2(sz - oz, sx - ox)
    const steps = Math.max(2, Math.ceil(turn / ((ARC_STEP_DEG * Math.PI) / 180)))
    for (let k = 0; k <= steps; k++) {
      const a = a0 + side * turn * (k / steps)
      // First half of the arc on the street coming in, second on the one going out.
      out.push({ p: [ox + Math.cos(a) * r, oz + Math.sin(a) * r], cls: 2 * k <= steps ? v[i].cls : v[i + 1].cls })
    }
  }
  out.push(v[v.length - 1])
  return out
}

export function snapRoute(line: Pt[], index: StreetIndex): { pts: Pt[]; cls: number[] } {
  if (line.length < 2) return { pts: line, cls: line.map(() => OFF_STREET) }
  const v = roundCorners(dropStraight(dropSpikes(joinRuns(snapRuns(line, index)))))
  // A last light simplification (each kept point keeps its class).
  const cls = new Map(v.map((x) => [x.p, x.cls]))
  const pts = simplifyLine(
    v.map((x) => x.p),
    SIMPLIFY_M,
  )
  return { pts, cls: pts.map((p) => cls.get(p) ?? OFF_STREET) }
}
