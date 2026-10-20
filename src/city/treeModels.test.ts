import { Box3 } from 'three'
import { describe, expect, it } from 'vitest'
import { CROWN_VARIANTS, isUnitSized, treeGeometry, variantsOf } from './treeModels.ts'
import { TREE_KINDS, TreeKind, treeSize } from './treeSpecies.ts'

const kinds = Array.from({ length: TREE_KINDS }, (_, k) => k as TreeKind)
const triangles = (kind: TreeKind, level: 'near' | 'far') => treeGeometry(kind, level).getAttribute('position').count / 3

describe('tree models', () => {
  it('carries the shader attributes on every vertex', () => {
    for (const kind of kinds)
      for (const level of ['near', 'far'] as const) {
        const g = treeGeometry(kind, level)
        const n = g.getAttribute('position').count
        expect(g.getAttribute('aCrown').count).toBe(n)
        expect(g.getAttribute('aTone').count).toBe(n)
        expect(g.getAttribute('normal').count).toBe(n)
      }
  })

  it('keeps the far models a fraction of the near ones', () => {
    for (const kind of kinds) {
      expect(triangles(kind, 'near')).toBeLessThanOrEqual(200)
      expect(triangles(kind, 'far')).toBeLessThanOrEqual(16)
      expect(triangles(kind, 'far')).toBeLessThan(triangles(kind, 'near') / 4)
    }
  })

  it('stands on the ground, unit sized or at the palm\'s real height', () => {
    for (const kind of kinds)
      for (const level of ['near', 'far'] as const) {
        const box = new Box3().setFromBufferAttribute(treeGeometry(kind, level).getAttribute('position') as never)
        expect(box.min.y).toBeCloseTo(0, 5)
        const height = isUnitSized(kind) ? 1 : treeSize(kind, 0).height
        expect(box.max.y).toBeGreaterThan(0.85 * height)
        expect(box.max.y).toBeLessThan(1.15 * height)
      }
  })

  it('gives broad and columnar crowns distinct shape variants, palms one', () => {
    for (const kind of [TreeKind.Broad, TreeKind.Columnar]) {
      expect(variantsOf(kind)).toBe(CROWN_VARIANTS)
      const shapes = new Set(
        Array.from({ length: CROWN_VARIANTS }, (_, v) => Array.from(treeGeometry(kind, 'near', v).getAttribute('position').array.slice(0, 600)).join()),
      )
      expect(shapes.size).toBe(CROWN_VARIANTS)
    }
    expect(variantsOf(TreeKind.FanPalm)).toBe(1)
  })
})
