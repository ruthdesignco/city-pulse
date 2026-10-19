import { describe, expect, it } from 'vitest'
import { BuildingColorType, buildingColorType } from './buildingColor.ts'

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
