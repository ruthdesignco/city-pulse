import { describe, expect, it } from 'vitest'
import { DEFAULT_DBH_IN, TreeKind, TreeTone, classifySpecies, isNotATree, parseDbh, treeSize } from './treeSpecies.ts'

describe('classifySpecies', () => {
  it('groups by genus, from the scientific name before "::"', () => {
    expect(classifySpecies('Platanus x hispanica :: Sycamore, London Plane')).toEqual({ kind: TreeKind.Broad, tone: TreeTone.Bright })
    expect(classifySpecies('Lophostemon confertus :: Brisbane Box')).toEqual({ kind: TreeKind.Columnar, tone: TreeTone.Deep })
    expect(classifySpecies('Ginkgo biloba :: Maidenhair Tree')).toEqual({ kind: TreeKind.Columnar, tone: TreeTone.Bright })
    expect(classifySpecies("Ficus microcarpa nitida 'Green Gem' :: Indian Laurel Fig Tree 'Green Gem'").tone).toBe(TreeTone.Deep)
    expect(classifySpecies('Olea europaea :: Olive Tree').tone).toBe(TreeTone.Gray)
  })

  it('tells the palms apart, all in the palm green', () => {
    expect(classifySpecies('Washingtonia robusta :: Mexican Fan Palm')).toEqual({ kind: TreeKind.FanPalm, tone: TreeTone.Palm })
    expect(classifySpecies('Phoenix canariensis :: Canary Island Date Palm').kind).toBe(TreeKind.DatePalm)
    expect(classifySpecies('Syagrus romanzoffianum :: Queen Palm').kind).toBe(TreeKind.FeatherPalm)
    expect(classifySpecies('Cordyline australis :: Dracena Palm').kind).toBe(TreeKind.Cordyline)
  })

  it('makes unknown species broad and bright', () => {
    for (const s of ['Tree(s) ::', '::', ':: To Be Determine', '', 'constructor :: not a genus'])
      expect(classifySpecies(s)).toEqual({ kind: TreeKind.Broad, tone: TreeTone.Bright })
  })
})

describe('isNotATree', () => {
  it('drops empty and proposed sites and stumps, either side of "::"', () => {
    expect(isNotATree('Planting site (plant) :: Planting Site (plant)')).toBe(true)
    expect(isNotATree('Potential Site :: Potential Site')).toBe(true)
    expect(isNotATree('Stump (use Grinder) :: Stump (use Grinder)')).toBe(true)
    expect(isNotATree("Zelkova serrata 'JFS-KW1' :: Planting Site (plant)")).toBe(true)
    expect(isNotATree('Tree(s) ::')).toBe(false)
    expect(isNotATree('Magnolia grandiflora :: Southern Magnolia')).toBe(false)
  })
})

describe('parseDbh', () => {
  it('keeps whole inches 1-100 and treats the rest as unknown', () => {
    expect(parseDbh('8')).toBe(8)
    expect(parseDbh('12.4')).toBe(12)
    expect(parseDbh('100')).toBe(100)
    for (const v of [undefined, '', ' ', '0', '-3', '101', '9999', 'n/a']) expect(parseDbh(v)).toBe(0)
  })
})

describe('treeSize', () => {
  it('grows broad trees with DBH, within limits', () => {
    const small = treeSize(TreeKind.Broad, 3)
    const big = treeSize(TreeKind.Broad, 24)
    expect(big.height).toBeGreaterThan(small.height)
    expect(big.crown).toBeGreaterThan(small.crown)
    expect(big.height).toBeCloseTo(13, 0)
    expect(treeSize(TreeKind.Broad, 100)).toEqual({ height: 20, crown: 9 })
    expect(treeSize(TreeKind.Broad, 1).height).toBeGreaterThanOrEqual(3.5)
  })

  it('uses the default DBH when unknown', () => {
    expect(treeSize(TreeKind.Broad, 0)).toEqual(treeSize(TreeKind.Broad, DEFAULT_DBH_IN))
  })

  it('draws columnar trees narrower and a little taller than broad ones', () => {
    const b = treeSize(TreeKind.Broad, 10)
    const c = treeSize(TreeKind.Columnar, 10)
    expect(c.crown).toBeLessThan(0.6 * b.crown)
    expect(c.height).toBeGreaterThan(b.height)
  })

  it("sizes palms by genus, not DBH", () => {
    expect(treeSize(TreeKind.FanPalm, 3)).toEqual(treeSize(TreeKind.FanPalm, 30))
    expect(treeSize(TreeKind.FanPalm, 0).height).toBeGreaterThan(treeSize(TreeKind.DatePalm, 0).height)
  })
})
