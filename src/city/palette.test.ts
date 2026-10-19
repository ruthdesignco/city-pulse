import { Color } from 'three'
import { describe, expect, it } from 'vitest'
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

  it('keeps a stale bus dimmer than every live vehicle', () => {
    for (const color of live) expect(luminance(palette.muniStale)).toBeLessThan(luminance(color))
  })
})
