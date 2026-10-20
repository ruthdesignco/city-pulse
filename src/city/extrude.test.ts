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

  it('carries wall position, wall length, height and a seed per vertex for the windows', () => {
    const f = (v: number) => Array.from(g.facade.slice(v * 4, v * 4 + 4))
    // First wall of the 10 x 10 m, 20 m building: from (0,0) to (10,0).
    const [u0, len0, h0, seed] = f(0)
    expect([u0, len0, h0]).toEqual([0, 10, 20])
    expect(f(1).slice(0, 3)).toEqual([10, 10, 20]) // bottom right
    expect(f(2).slice(0, 3)).toEqual([10, 10, 20]) // top right
    expect(f(3).slice(0, 3)).toEqual([0, 10, 20]) // top left
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThan(1)
    // Every vertex of a building shares its seed; roofs have no wall length.
    for (let v = 0; v < 20; v++) expect(f(v)[3]).toBe(seed)
    expect(f(16)[1]).toBe(0)
    // The other building gets its own seed.
    expect(f(g.facade.length / 4 - 1)[3]).not.toBe(seed)
  })

  it('carries a pinned facade material per vertex, 0 for everything else', () => {
    const pinned = extrudeBuildings(buildings, 600, [{ building: 1, material: 3 }])
    const first = 4 * 4 + 4 // the first building's vertices
    for (let v = 0; v < first; v++) expect(pinned.material[v]).toBe(0)
    for (let v = first; v < pinned.material.length; v++) expect(pinned.material[v]).toBe(3)
    expect(g.material.every((m) => m === 0)).toBe(true)
  })

  it('marks storefronts only on walls that front a street, never on roofs', () => {
    // A street along x at z = -12 m (1 m past the square's south wall's
    // sidewalk), so only that wall (z = 0, facing -z) fronts it. Major,
    // where 90% of buildings get one: try seeds until one does.
    const streets = { counts: Uint16Array.from([2]), classes: Uint8Array.from([0]), coords: Int16Array.from([-1000, -120, 1000, -120]) }
    let marked: number[] = []
    for (let dx = 0; dx < 50 && marked.length === 0; dx++) {
      const moved = { ...buildings, coords: buildings.coords.map((c, i) => (i < 8 && i % 2 === 0 ? c + dx * 10 : c)) }
      const m = extrudeBuildings(moved, 600, [], streets)
      marked = []
      for (let v = 0; v < m.storefront.length; v++) if (m.storefront[v]) marked.push(v)
      for (const v of marked) {
        expect(m.normals[3 * v + 1]).toBe(0)
        expect(m.normals[3 * v + 2]).toBeCloseTo(-1, 6)
      }
    }
    expect(marked).toHaveLength(4)
  })
})

