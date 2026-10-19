import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { STALE_SELF_LIT } from '../transit/vehicleModels.ts'
import { palette } from './palette.ts'

// Relative luminance in linear light (Color converts the sRGB hex on set).
const luminance = (hex: string) => {
  const c = new Color(hex)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

describe('palette', () => {
  const streets = [palette.streetMajor, palette.streetMinor, palette.streetLocal]
  const live = [palette.muniBus, palette.muniRail, palette.muniCable]

  it('keeps a stale bus brighter than every street, so it never reads as missing', () => {
    for (const street of streets) expect(luminance(palette.muniStale)).toBeGreaterThan(luminance(street))
  })

  it('lights a fully stale model at least as bright as the stale marker, so it stays above the streets in shadow', () => {
    expect(STALE_SELF_LIT).toBeGreaterThanOrEqual(1)
  })

  it('keeps a stale bus dimmer than every live vehicle', () => {
    for (const color of live) expect(luminance(palette.muniStale)).toBeLessThan(luminance(color))
  })
})
