// A tiny low-poly mesh builder for the landmark models: flat-shaded faces
// (each with its own vertices and normal), a color per face, and a `glow`
// code per face that the landmark shader uses (Landmarks.tsx):
//
//   Glow.None     plain surface
//   Glow.Windows  rows of windows: a darker band per floor by day, lit on
//                 the office schedule at night (windowLight.ts)
//   Glow.Flood    floodlit at night
//   Glow.Opening  an opening into a lit interior: dark by day, warm at night
//
// Models are built in their own frame (x along the footprint's local x,
// y up, z along its local z, origin at the footprint's center on the
// ground) and placed with place().

import { BufferAttribute, BufferGeometry, Color } from 'three'

export const Glow = { None: 0, Windows: 1, Flood: 2, Opening: 3 } as const
export type Glow = (typeof Glow)[keyof typeof Glow]

export type V3 = [number, number, number]

export class ModelBuilder {
  readonly position: number[] = []
  readonly normal: number[] = []
  readonly color: number[] = []
  readonly glow: number[] = []
  private readonly c = new Color()

  // A flat convex polygon, wound counterclockwise seen from outside.
  face(points: V3[], color: string, glow: Glow = Glow.None) {
    if (points.length < 3) return
    const [a, b, c] = points
    const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const l = Math.hypot(...n) || 1
    this.c.set(color)
    for (let i = 1; i < points.length - 1; i++)
      for (const p of [points[0], points[i], points[i + 1]]) {
        this.position.push(...p)
        this.normal.push(n[0] / l, n[1] / l, n[2] / l)
        this.color.push(this.c.r, this.c.g, this.c.b)
        this.glow.push(glow)
      }
  }

  // The side walls between two closed outlines (same length, counterclockwise
  // seen from above): a prism, frustum or any loft.
  loft(lower: V3[], upper: V3[], color: string, glow: Glow = Glow.None) {
    const n = lower.length
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      this.face([lower[i], lower[j], upper[j], upper[i]], color, glow)
    }
  }

  // A horizontal cap over a closed outline, facing up (or down).
  cap(outline: V3[], color: string, up = true, glow: Glow = Glow.None) {
    this.face(up ? outline : [...outline].reverse(), color, glow)
  }
}

// A regular polygon (or a fluted one, alternating radii) at height y,
// counterclockwise seen from above: x = r cos a, z = -r sin a.
export function ring(sides: number, r: number, y: number, inner = r, phase = 0): V3[] {
  const out: V3[] = []
  for (let i = 0; i < sides; i++) {
    const a = phase + (2 * Math.PI * i) / sides
    const rr = i % 2 === 0 ? r : inner
    out.push([rr * Math.cos(a), y, -rr * Math.sin(a)])
  }
  return out
}

// A rectangle at height y, half sizes hx along x and hz along z,
// counterclockwise seen from above.
export function rect(hx: number, hz: number, y: number, cx = 0, cz = 0): V3[] {
  return [
    [cx - hx, y, cz + hz],
    [cx + hx, y, cz + hz],
    [cx + hx, y, cz - hz],
    [cx - hx, y, cz - hz],
  ]
}

export interface Placed {
  x: number
  z: number
  angle: number // the footprint's local x, radians from scene +x (registry.ts)
  y?: number // the ground's height under it (0 on flat ground)
}

// The model in scene space, in one geometry: turned so its x runs along the
// footprint's local x, and moved to its center. `ring` is its ring position
// (ring.ts), for the fade toward the haze.
export function place(m: ModelBuilder, at: Placed, ring = 0): BufferGeometry {
  const c = Math.cos(at.angle)
  const s = Math.sin(at.angle)
  const y0 = at.y ?? 0
  const pos = new Float32Array(m.position.length)
  const nor = new Float32Array(m.normal.length)
  for (let i = 0; i < m.position.length; i += 3) {
    const [x, y, z] = [m.position[i], m.position[i + 1], m.position[i + 2]]
    // Local x -> (c, s) in scene (x, z); local z -> (-s, c).
    pos[i] = at.x + x * c - z * s
    pos[i + 1] = y0 + y
    pos[i + 2] = at.z + x * s + z * c
    const [nx, ny, nz] = [m.normal[i], m.normal[i + 1], m.normal[i + 2]]
    nor[i] = nx * c - nz * s
    nor[i + 1] = ny
    nor[i + 2] = nx * s + nz * c
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('normal', new BufferAttribute(nor, 3))
  g.setAttribute('color', new BufferAttribute(Float32Array.from(m.color), 3))
  g.setAttribute('glow', new BufferAttribute(Float32Array.from(m.glow), 1))
  g.setAttribute('ring', new BufferAttribute(new Float32Array(m.glow.length).fill(ring), 1))
  return g
}
