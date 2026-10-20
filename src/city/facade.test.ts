import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { BuildingColorType } from '../../scripts/lib/buildingColor.ts'
import { palette } from './palette.ts'
import { FACADES, FACADE_COLOR, STONE_TOWER, STONE_TOWER_SHARE, glassShare, isStoneTower } from './facade.ts'

const luminance = (hex: string) => {
  const c = new Color(hex)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}
const [neutral, residential, tower] = [FACADES[BuildingColorType.Neutral], FACADES[BuildingColorType.Residential], FACADES[BuildingColorType.Tower]]
const stone = FACADES[STONE_TOWER]

describe('facades', () => {
  it('has one facade per building family, plus stone towers', () => {
    expect(FACADES).toHaveLength(Object.keys(BuildingColorType).length + 1)
    expect(STONE_TOWER).toBe(Object.keys(BuildingColorType).length)
  })

  it('builds about a third of towers in stone, chosen per building', () => {
    // Evenly spread seeds, like extrude.ts's (a small LCG; sequences with
    // structure, like the golden ratio's, correlate with any hash).
    let x = 12345
    const seeds = Array.from({ length: 6000 }, () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296)
    const share = seeds.filter(isStoneTower).length / seeds.length
    expect(share).toBeGreaterThan(STONE_TOWER_SHARE - 0.03)
    expect(share).toBeLessThan(STONE_TOWER_SHARE + 0.03)
    expect(isStoneTower(0.123)).toBe(isStoneTower(0.123))
  })

  it('gives stone towers tower floors with punched windows, not curtain wall', () => {
    expect(stone.floorM).toBeCloseTo(tower.floorM, 1)
    expect(glassShare(stone.width, stone.height, false)).toBeLessThan(0.3)
    expect(stone.reflect).toBeLessThan(tower.reflect)
  })

  it('colors stone towers in warm masonry tones, not glass blue', () => {
    expect(palette.stoneTowerColors).toHaveLength(3)
    for (const hex of palette.stoneTowerColors) {
      const c = new Color(hex)
      expect(c.r).toBeGreaterThan(c.b)
      expect(luminance(hex)).toBeGreaterThan(luminance(stone.glass))
    }
  })

  it('stacks floors tightest on towers (~3.5 m) and sparsest on commercial', () => {
    expect(tower.floorM).toBeCloseTo(3.5, 1)
    expect(residential.floorM).toBeLessThan(neutral.floorM)
    expect(tower.spacingM).toBeLessThan(residential.spacingM)
  })

  it('makes towers mostly glass and residential mostly wall, punched', () => {
    expect(glassShare(tower.width, tower.height, false)).toBeGreaterThan(0.5)
    expect(glassShare(residential.width, residential.height, true)).toBeLessThan(0.25)
  })

  it('keeps panes darker than every wall they sit in, and towers cooler', () => {
    for (const f of FACADES) for (const wall of [...palette.buildingColors, ...palette.stoneTowerColors]) expect(luminance(f.glass)).toBeLessThan(luminance(wall))
    const g = new Color(tower.glass)
    expect(g.b).toBeGreaterThan(g.r)
  })

  it('reflects the sky on glass towers only, so punched windows stay dark in sun', () => {
    for (const f of [neutral, residential, stone]) {
      expect(f.reflect).toBe(0)
      expect(f.glint).toBeGreaterThanOrEqual(0.8)
    }
  })

  it('reflects the sky most on towers, with the sharpest glints', () => {
    expect(tower.reflect).toBeGreaterThan(neutral.reflect)
    expect(tower.reflect).toBeGreaterThan(residential.reflect)
    expect(tower.glint).toBeLessThan(Math.min(neutral.glint, residential.glint))
  })

  it('keeps every variation small enough that a window never fills its cell', () => {
    for (const f of FACADES) expect(f.width * (1 + f.varyWidth)).toBeLessThan(1)
    for (const f of FACADES) expect(f.sill + f.height).toBeLessThan(1)
  })

  it('only takes derivatives outside any branch', () => {
    expect(FACADE_COLOR).not.toMatch(/\bif\s*\(/)
  })
})
