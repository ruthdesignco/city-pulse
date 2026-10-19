import { describe, expect, it } from 'vitest'
import { BuildingColorType, buildingColorType, buildingVariant } from './buildingColor.ts'

describe('buildingColorType', () => {
  it('buckets residential tags as Residential, below tower height', () => {
    expect(buildingColorType('apartments', 12)).toBe(BuildingColorType.Residential)
    expect(buildingColorType('house', 8)).toBe(BuildingColorType.Residential)
  })

  it('buckets unknown, commercial and missing tags as Neutral', () => {
    expect(buildingColorType('yes', 12)).toBe(BuildingColorType.Neutral)
    expect(buildingColorType('commercial', 12)).toBe(BuildingColorType.Neutral)
    expect(buildingColorType(undefined, 12)).toBe(BuildingColorType.Neutral)
  })

  it('buckets tall buildings as Tower regardless of tag', () => {
    expect(buildingColorType('apartments', 65)).toBe(BuildingColorType.Tower)
    expect(buildingColorType(undefined, 100)).toBe(BuildingColorType.Tower)
  })

  it('is Tower exactly at the threshold, Neutral just under it', () => {
    expect(buildingColorType(undefined, 60)).toBe(BuildingColorType.Tower)
    expect(buildingColorType(undefined, 59.9)).toBe(BuildingColorType.Neutral)
  })
})

describe('buildingVariant', () => {
  it('is deterministic: the same OSM id always gets the same variant', () => {
    expect(buildingVariant('way/123456')).toBe(buildingVariant('way/123456'))
    expect(buildingVariant('relation/987')).toBe(buildingVariant('relation/987'))
  })

  it('always returns 0, 1 or 2', () => {
    for (const id of ['way/1', 'way/2', 'way/3', 'relation/1', 'way/999999999']) {
      expect(buildingVariant(id)).toBeGreaterThanOrEqual(0)
      expect(buildingVariant(id)).toBeLessThanOrEqual(2)
    }
  })

  it('spreads across all three variants over a range of ids, not just one', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 300; i++) seen.add(buildingVariant(`way/${i}`))
    expect(seen).toEqual(new Set([0, 1, 2]))
  })
})
