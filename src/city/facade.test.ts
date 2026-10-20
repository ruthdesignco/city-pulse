import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { BuildingColorType } from '../../scripts/lib/buildingColor.ts'
import { palette } from './palette.ts'
import { FACADES, FACADE_COLOR, glassShare } from './facade.ts'

const luminance = (hex: string) => {
  const c = new Color(hex)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}
const [neutral, residential, tower] = [FACADES[BuildingColorType.Neutral], FACADES[BuildingColorType.Residential], FACADES[BuildingColorType.Tower]]

describe('facades', () => {
  it('has one facade per building family', () => {
    expect(FACADES).toHaveLength(Object.keys(BuildingColorType).length)
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
    for (const f of FACADES) for (const wall of palette.buildingColors) expect(luminance(f.glass)).toBeLessThan(luminance(wall))
    const g = new Color(tower.glass)
    expect(g.b).toBeGreaterThan(g.r)
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
