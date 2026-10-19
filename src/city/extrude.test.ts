import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { extrudeBuildings } from './extrude.ts'

// One 10 x 10 m square, 20 m tall, wound so signedArea(x, z) > 0, plus a
// triangle in the context ring. Coords in 0.1 m units, heights in 0.1 m.
const buildings = {
  counts: new Uint16Array([4, 3]),
  heights: new Uint16Array([200, 50]),
  ringBand: new Uint8Array([0, 75]),
  colorIndex: new Uint8Array([4, 8]),
  coords: new Int16Array([0, 0, 100, 0, 100, 100, 0, 100, 500, 500, 600, 500, 500, 600]),
}

function triangles(g: ReturnType<typeof extrudeBuildings>) {
  const p = (i: number) => new Vector3(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2])
  const n = (i: number) => new Vector3(g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2])
  const out = []
  for (let t = 0; t < g.index.length; t += 3) {
    const [a, b, c] = [g.index[t], g.index[t + 1], g.index[t + 2]]
    const face = new Vector3().subVectors(p(b), p(a)).cross(new Vector3().subVectors(p(c), p(a))).normalize()
    out.push({ a: p(a), b: p(b), c: p(c), face, normal: n(a) })
  }
  return out
}

describe('extrudeBuildings', () => {
  const g = extrudeBuildings(buildings)

  it('emits 4 vertices per wall edge plus one per roof vertex', () => {
    expect(g.positions.length / 3).toBe(4 * 4 + 4 + 3 * 4 + 3)
  })

  it('emits 2 triangles per wall edge plus n-2 per roof', () => {
    expect(g.index.length / 3).toBe(4 * 2 + 2 + 3 * 2 + 1)
  })

  it('puts roofs at the building height in meters', () => {
    const ys = new Set<number>()
    for (let i = 1; i < g.positions.length; i += 3) ys.add(Math.round(g.positions[i] * 10) / 10)
    expect([...ys].sort((a, b) => a - b)).toEqual([0, 5, 20])
  })

  it('winds every triangle counter-clockwise from outside (three.js front face)', () => {
    for (const t of triangles(g)) expect(t.face.dot(t.normal)).toBeGreaterThan(0.999)
  })

  it('points wall normals away from the footprint and roof normals up', () => {
    const center = new Vector3(5, 0, 5)
    for (const t of triangles(g).slice(0, 10)) {
      if (t.normal.y > 0.5) continue
      const mid = new Vector3().add(t.a).add(t.b).add(t.c).divideScalar(3).setY(0)
      expect(mid.sub(center).dot(t.normal)).toBeGreaterThan(0)
    }
    expect(triangles(g).filter((t) => t.normal.y > 0.999)).toHaveLength(3)
  })

  it('carries the ring band per vertex, normalized to 0..1 of the ring', () => {
    expect(g.ring[0]).toBe(0)
    expect(g.ring[g.ring.length - 1]).toBeCloseTo((75 * 4) / 600, 5)
  })

  it("carries each building's colorIndex per vertex", () => {
    expect(g.colorIndex[0]).toBe(4) // first building (4 counts -> 4*2+4=12 verts)
    expect(g.colorIndex[g.colorIndex.length - 1]).toBe(8) // second building
  })
})
