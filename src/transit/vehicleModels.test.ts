import { describe, expect, it } from 'vitest'
import type { VehicleKind } from './fleet.ts'
import { MODEL_LENGTH_M, MODEL_WIDTH_M, buildVehicleGeometry } from './vehicleModels.ts'

const KINDS: VehicleKind[] = ['bus40', 'bus60', 'rail', 'cable']

describe('buildVehicleGeometry', () => {
  for (const kind of KINDS)
    describe(kind, () => {
      const g = buildVehicleGeometry(kind)
      g.computeBoundingBox()
      const b = g.boundingBox!

      it('stays low poly', () => {
        expect(g.index!.count / 3).toBeLessThanOrEqual(600)
      })

      it('is its real length along +x, centered, wheels on the ground', () => {
        expect(b.max.x - b.min.x).toBeCloseTo(MODEL_LENGTH_M[kind], 0)
        expect(b.max.x + b.min.x).toBeCloseTo(0, 0)
        expect(b.min.y).toBeCloseTo(0, 1)
        expect(b.max.z - b.min.z).toBeLessThan(MODEL_WIDTH_M[kind] + 0.5)
      })

      it('has accent faces to tint and glow, and colors on every vertex', () => {
        const accent = g.getAttribute('accent')
        expect(Array.from(accent.array as Float32Array).some((a) => a === 1)).toBe(true)
        expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count)
      })
    })

  it('makes the 60 ft bus half again as long as the 40 ft', () => {
    expect(MODEL_LENGTH_M.bus60 / MODEL_LENGTH_M.bus40).toBeCloseTo(1.5, 1)
  })
})
