import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { staleColor } from '../transit/vehicleModels.ts'
import { palette } from './palette.ts'

// Relative luminance in linear light (Color converts the sRGB hex on set).
const luminance = (c: string | Color) => {
  const l = typeof c === 'string' ? new Color(c) : c
  return 0.2126 * l.r + 0.7152 * l.g + 0.0722 * l.b
}
const saturation = (c: Color) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)

describe('palette', () => {
  // The colors that make up most of a vehicle's silhouette.
  const bodies = [palette.liveryBody, palette.liveryRail, palette.cableWood]

  it('reads roads as roads: sidewalks lighter than asphalt, lane lines lighter still', () => {
    expect(luminance(palette.sidewalk)).toBeGreaterThan(luminance(palette.asphalt))
    expect(luminance(palette.laneMarking)).toBeGreaterThan(luminance(palette.sidewalk))
  })

  it('keeps every vehicle body lighter than the asphalt it drives on, live or stale', () => {
    for (const body of bodies) {
      expect(luminance(body), body).toBeGreaterThan(luminance(palette.asphalt))
      expect(luminance(staleColor(body)), body).toBeGreaterThan(luminance(palette.asphalt))
    }
  })

  it('shows staleness as fading, not tinting: less saturated, never darker', () => {
    for (const body of bodies) {
      const live = new Color(body)
      const stale = staleColor(body)
      expect(saturation(stale), body).toBeLessThanOrEqual(saturation(live))
      expect(luminance(stale), body).toBeGreaterThanOrEqual(luminance(live) - 1e-6)
    }
  })
})
