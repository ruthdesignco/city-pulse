import { describe, expect, it } from 'vitest'
import { makeLine } from './shapes.ts'
import {
  TRAIL_INDICES_PER_SLOT,
  TRAIL_MAX_M,
  TRAIL_SAMPLES,
  TRAIL_TAIL_WIDTH,
  TRAIL_VERTS_PER_SLOT,
  trailIndex,
  trailLength,
  writeTrail,
} from './trails.ts'

const WHITE = { r: 1, g: 1, b: 1 }
// East 1 km along z = 0.
const STRAIGHT = makeLine('s#0', '14', 0, [0, 0, 1000, 0])
// East 300 m, then south 300 m (+z).
const CORNER = makeLine('c#0', '14', 0, [0, 0, 300, 0, 300, 300])

function buffers(slots = 2) {
  return {
    position: new Float32Array(slots * TRAIL_VERTS_PER_SLOT * 3),
    color: new Float32Array(slots * TRAIL_VERTS_PER_SLOT * 3),
  }
}

// Midpoint and half-width of sample pair i in `slot`.
function pair(out: ReturnType<typeof buffers>, slot: number, i: number) {
  const o = (slot * TRAIL_VERTS_PER_SLOT + i * 2) * 3
  const [lx, ly, lz, rx, ry, rz] = out.position.slice(o, o + 6)
  return { x: (lx + rx) / 2, y: (ly + ry) / 2, z: (lz + rz) / 2, w: Math.hypot(lx - rx, lz - rz) / 2, brightness: out.color[o] }
}

describe('trailLength', () => {
  it('is about 200 m at a typical Muni speed, zero when stopped, capped when fast', () => {
    expect(trailLength(2.7)).toBeCloseTo(202.5)
    expect(trailLength(0)).toBe(0)
    expect(trailLength(-1)).toBe(0)
    expect(trailLength(20)).toBe(TRAIL_MAX_M)
  })
})

describe('writeTrail', () => {
  it('runs back along the line from the head, narrowing and fading to the tail', () => {
    const out = buffers()
    expect(writeTrail(out, 1, STRAIGHT, 600, 200, 3, 1.5, WHITE, 0.8)).toBe(true)
    const head = pair(out, 1, 0)
    const tail = pair(out, 1, TRAIL_SAMPLES - 1)
    expect([head.x, head.z, head.y]).toEqual([600, 0, 1.5])
    expect([tail.x, tail.z]).toEqual([400, 0])
    expect(head.w).toBeCloseTo(3)
    expect(tail.w).toBeCloseTo(3 * TRAIL_TAIL_WIDTH)
    expect(head.brightness).toBeCloseTo(0.8)
    expect(tail.brightness).toBe(0)
    for (let i = 1; i < TRAIL_SAMPLES; i++) expect(pair(out, 1, i).brightness).toBeLessThan(pair(out, 1, i - 1).brightness)
    expect(out.position.slice(0, TRAIL_VERTS_PER_SLOT * 3).every((v) => v === 0)).toBe(true) // slot 0 untouched
  })

  it('follows the route around a corner instead of cutting it', () => {
    const out = buffers(1)
    writeTrail(out, 0, CORNER, 400, 200, 3, 1, WHITE, 1) // head 100 m south of the corner
    for (let i = 0; i < TRAIL_SAMPLES; i++) {
      const p = pair(out, 0, i)
      const onEastLeg = Math.abs(p.z) < 1e-3 && p.x <= 300 + 1e-3
      const onSouthLeg = Math.abs(p.x - 300) < 1e-3
      expect(onEastLeg || onSouthLeg).toBe(true)
    }
    expect(pair(out, 0, TRAIL_SAMPLES - 1)).toMatchObject({ x: 200, z: 0 })
  })

  it('stops at the start of the shape', () => {
    const out = buffers(1)
    writeTrail(out, 0, STRAIGHT, 50, 200, 3, 1, WHITE, 1)
    expect(pair(out, 0, TRAIL_SAMPLES - 1).x).toBeCloseTo(0)
  })

  it('writes nothing for a stopped bus, a bus at the shape start, or zero intensity', () => {
    const out = buffers(1)
    expect(writeTrail(out, 0, STRAIGHT, 600, 0, 3, 1, WHITE, 1)).toBe(false)
    expect(writeTrail(out, 0, STRAIGHT, 2, 200, 3, 1, WHITE, 1)).toBe(false)
    expect(writeTrail(out, 0, STRAIGHT, 600, 200, 3, 1, WHITE, 0)).toBe(false)
    expect(out.position.every((v) => v === 0)).toBe(true)
  })
})

describe('trailIndex', () => {
  it('stitches each slot into its own strip of quads', () => {
    const index = trailIndex(2)
    expect(index).toHaveLength(2 * TRAIL_INDICES_PER_SLOT)
    expect([...index.slice(0, 6)]).toEqual([0, 1, 2, 1, 3, 2])
    const second = index.slice(TRAIL_INDICES_PER_SLOT)
    expect(Math.min(...second)).toBe(TRAIL_VERTS_PER_SLOT)
    expect(Math.max(...second)).toBe(2 * TRAIL_VERTS_PER_SLOT - 1)
  })
})
