import { describe, expect, it } from 'vitest'
import { toScene } from '../geo/projection.ts'
import { inBay } from './bay.ts'
import { FEATHER_ALPHA, buildShoreFeather } from './shore.ts'

// Bare land west of x = 0 (scene meters), baked city east of it.
const bare = (x: number) => (x < 0 ? 1 : 0)
const f = buildShoreFeather(bare, 0.17)
const vertices = f.position.length / 3
const vertex = (v: number) => ({ x: f.position[v * 3], z: f.position[v * 3 + 2], alpha: f.color[v * 4 + 3] })

describe('buildShoreFeather', () => {
  it('fades to nothing at both edges, strongest on the waterline over bare land', () => {
    let peak = 0
    for (let v = 0; v < vertices; v++) {
      const { alpha } = vertex(v)
      if (v % 3 !== 1) expect(alpha).toBe(0)
      else peak = Math.max(peak, alpha)
    }
    expect(peak).toBeCloseTo(FEATHER_ALPHA)
  })

  it('puts its water edge over the Bay and its land edge on land', () => {
    const wharf = toScene(37.8072, -122.4225) // Aquatic Park, bare land
    let nearest = 0
    for (let v = 1; v < vertices; v += 3)
      if (Math.hypot(vertex(v).x - wharf.x, vertex(v).z - wharf.z) < Math.hypot(vertex(nearest + 1).x - wharf.x, vertex(nearest + 1).z - wharf.z)) nearest = v - 1
    expect(inBay(vertex(nearest + 2).x, vertex(nearest + 2).z)).toBe(true)
    expect(inBay(vertex(nearest).x, vertex(nearest).z)).toBe(false)
  })

  it('stays off the baked waterfront', () => {
    for (let v = 1; v < vertices; v += 3) if (vertex(v).x > 50) expect(vertex(v).alpha).toBe(0)
  })
})
