// Plane geometry for the city bake. Points are [x, z] in scene meters
// (see src/geo/projection.ts). Rings are open: no repeated closing point.

export type Pt = [number, number]

export function openRing(ring: Pt[]): Pt[] {
  const first = ring[0]
  const last = ring[ring.length - 1]
  return ring.length > 1 && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring
}

export function signedArea(ring: Pt[]): number {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return a / 2
}

export function centroid(ring: Pt[]): Pt {
  let a = 0
  let cx = 0
  let cz = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
    a += cross
    cx += (ring[j][0] + ring[i][0]) * cross
    cz += (ring[j][1] + ring[i][1]) * cross
  }
  if (a === 0) return ring[0]
  return [cx / (3 * a), cz / (3 * a)]
}

export function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]
    const [xj, zj] = ring[j]
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz))
}

export function distToRing(p: Pt, ring: Pt[]): number {
  let d = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) d = Math.min(d, distToSegment(p, ring[j], ring[i]))
  return d
}

// The bake area: inside any of the neighborhood rings, or within `meters` of
// one (the context ring).
export function inBakeArea(p: Pt, rings: Pt[][], meters: number): boolean {
  return rings.some((r) => pointInRing(p, r)) || rings.some((r) => distToRing(p, r) <= meters)
}

export interface Rect {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

// Liang-Barsky: the [t0, t1] part of segment a->b inside r, or null.
function clipSegment(a: Pt, b: Pt, r: Rect): [number, number] | null {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const p = [-dx, dx, -dz, dz]
  const q = [a[0] - r.minX, r.maxX - a[0], a[1] - r.minZ, r.maxZ - a[1]]
  let t0 = 0
  let t1 = 1
  for (let k = 0; k < 4; k++) {
    if (p[k] === 0) {
      if (q[k] < 0) return null
    } else {
      const t = q[k] / p[k]
      if (p[k] < 0) {
        if (t > t1) return null
        if (t > t0) t0 = t
      } else {
        if (t < t0) return null
        if (t < t1) t1 = t
      }
    }
  }
  return [t0, t1]
}

// Split a polyline into the runs inside r, cut at the exact boundary
// crossings so a long segment that crosses the edge isn't lost.
export function clipPolylineToRect(line: Pt[], r: Rect): Pt[][] {
  const out: Pt[][] = []
  let run: Pt[] = []
  const flush = () => {
    if (run.length >= 2) out.push(run)
    run = []
  }
  const push = (p: Pt) => {
    const last = run[run.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) run.push(p)
  }
  // Clamp crossings so float error can't put a point a hair outside r.
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const at = (a: Pt, b: Pt, t: number): Pt =>
    t === 0
      ? a
      : t === 1
        ? b
        : [clamp(a[0] + (b[0] - a[0]) * t, r.minX, r.maxX), clamp(a[1] + (b[1] - a[1]) * t, r.minZ, r.maxZ)]

  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]
    const b = line[i + 1]
    const c = clipSegment(a, b, r)
    if (!c) {
      flush()
      continue
    }
    if (c[0] > 0) flush() // entering from outside
    push(at(a, b, c[0]))
    push(at(a, b, c[1]))
    if (c[1] < 1) flush() // leaving
  }
  flush()
  return out
}

// Douglas-Peucker on an open polyline; always keeps both ends.
export function simplifyLine(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()!
    let maxD = 0
    let idx = -1
    for (let i = lo + 1; i < hi; i++) {
      const d = distToSegment(points[i], points[lo], points[hi])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (idx !== -1 && maxD > tolerance) {
      keep[idx] = 1
      stack.push([lo, idx], [idx, hi])
    }
  }
  return points.filter((_, i) => keep[i])
}

// Douglas-Peucker on a closed ring: split at the vertex farthest from the
// first one, simplify both halves as lines, then drop the first vertex too if
// it turned out to be collinear with its neighbours.
export function simplifyRing(ring: Pt[], tolerance: number): Pt[] {
  if (ring.length <= 3) return ring
  let far = 1
  let farD = 0
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1])
    if (d > farD) {
      farD = d
      far = i
    }
  }
  const a = simplifyLine(ring.slice(0, far + 1), tolerance)
  const b = simplifyLine([...ring.slice(far), ring[0]], tolerance)
  const out = [...a, ...b.slice(1, -1)]
  if (out.length > 3 && distToSegment(out[0], out[out.length - 1], out[1]) <= tolerance) out.shift()
  return out
}

const samePt = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1]

// Join multipolygon member ways end-to-end into closed rings. Shared OSM
// nodes project to bit-identical coordinates, so exact equality is safe.
export function stitchRings(ways: Pt[][]): { rings: Pt[][]; unclosed: number } {
  const pool = ways.filter((w) => w.length >= 2).map((w) => [...w])
  const rings: Pt[][] = []
  let unclosed = 0
  while (pool.length) {
    const chain = pool.pop()!
    let grew = true
    while (!samePt(chain[0], chain[chain.length - 1]) && grew) {
      grew = false
      const end = chain[chain.length - 1]
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i]
        if (samePt(w[0], end)) chain.push(...w.slice(1))
        else if (samePt(w[w.length - 1], end)) chain.push(...[...w].reverse().slice(1))
        else continue
        pool.splice(i, 1)
        grew = true
        break
      }
    }
    if (samePt(chain[0], chain[chain.length - 1]) && chain.length >= 4) rings.push(openRing(chain))
    else unclosed++
  }
  return { rings, unclosed }
}

const MAX_PLAUSIBLE_HEIGHT_M = 600

// OSM `height` / `min_height`: meters by default; also "m", "ft", and 10'6".
// Returns undefined for anything ambiguous rather than guessing.
export function parseHeight(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  let m: RegExpMatchArray | null
  let meters: number | undefined
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(m)?$/))) meters = Number(m[1])
  else if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:ft|')$/))) meters = Number(m[1]) * 0.3048
  else if ((m = s.match(/^(\d+)'\s*(\d+(?:\.\d+)?)"$/))) meters = (Number(m[1]) * 12 + Number(m[2])) * 0.0254
  if (meters === undefined || !(meters > 0) || meters > MAX_PLAUSIBLE_HEIGHT_M) return undefined
  return meters
}

// Convex hull (Andrew's monotone chain), counterclockwise in (x, z).
export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Pt[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Pt[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop()
    upper.push(p[i])
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

// The smallest-area rectangle around a ring (one side lies along a hull
// edge): its center, its axes turned `angle` radians from +x, normalized to
// within +-45 deg so local x stays the side nearest the scene's x axis, and
// its size along each.
export function minAreaRect(ring: Pt[]): { center: Pt; angle: number; sizeX: number; sizeZ: number } {
  const hull = convexHull(ring)
  let best = { area: Infinity, center: [0, 0] as Pt, angle: 0, sizeX: 0, sizeZ: 0 }
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i]
    const [bx, bz] = hull[(i + 1) % hull.length]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 1e-9) continue
    const ux = (bx - ax) / len
    const uz = (bz - az) / len
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const [x, z] of hull) {
      const u = x * ux + z * uz
      const v = -x * uz + z * ux
      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
    const area = (maxU - minU) * (maxV - minV)
    if (area < best.area) {
      const cu = (minU + maxU) / 2
      const cv = (minV + maxV) / 2
      best = { area, center: [cu * ux - cv * uz, cu * uz + cv * ux], angle: Math.atan2(uz, ux), sizeX: maxU - minU, sizeZ: maxV - minV }
    }
  }
  // Turn by quarter turns into (-45, 45] deg, swapping the sizes each time.
  let { angle, sizeX, sizeZ } = best
  while (angle > Math.PI / 4) {
    angle -= Math.PI / 2
    ;[sizeX, sizeZ] = [sizeZ, sizeX]
  }
  while (angle <= -Math.PI / 4) {
    angle += Math.PI / 2
    ;[sizeX, sizeZ] = [sizeZ, sizeX]
  }
  return { center: best.center, angle, sizeX, sizeZ }
}
