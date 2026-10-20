import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { LANDMARK_MATERIALS } from './landmarkMaterials.ts'
import { PinnedMaterial } from '../../src/city/facade.ts'
import { decodeCity } from '../../src/city/format.ts'
import { palette } from '../../src/city/palette.ts'

const luminance = (hex: string) => {
  const c = new Color(hex)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

describe('landmark materials', () => {
  it('pins the glass towers as glass, 555 California as granite, Transamerica as pale stone', () => {
    expect(LANDMARK_MATERIALS).toEqual({
      'Salesforce Tower': PinnedMaterial.Glass,
      '181 Fremont Tower': PinnedMaterial.Glass,
      'Millennium Tower': PinnedMaterial.Glass,
      'One Rincon Hill': PinnedMaterial.Glass,
      '555 California Street': PinnedMaterial.Granite,
      'Transamerica Pyramid': PinnedMaterial.PaleStone,
    })
  })

  it('uses distinct codes, with 0 left for the random choice', () => {
    const codes = Object.values(PinnedMaterial)
    expect(new Set(codes).size).toBe(codes.length)
    expect(PinnedMaterial.Auto).toBe(0)
  })

  it('makes granite dark stone and the pale stone the lightest masonry in the city', () => {
    expect(luminance(palette.landmarkGranite)).toBeLessThan(Math.min(...palette.stoneTowerColors.map(luminance)))
    expect(luminance(palette.landmarkPaleStone)).toBeGreaterThan(Math.max(...palette.stoneTowerColors.map(luminance)))
    const granite = new Color(palette.landmarkGranite)
    expect(granite.r).toBeGreaterThan(granite.b) // carnelian: red-brown, not gray
  })

  it('is baked into the shipped city.bin: every landmark pinned, by its own name', () => {
    const buf = readFileSync(join(import.meta.dirname, '../../public/city.bin'))
    const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    const pins = city.header.pinnedMaterials ?? []
    for (const [name, material] of Object.entries(LANDMARK_MATERIALS)) {
      const pin = pins.find((p) => p.name === name)
      expect(pin, name).toBeDefined()
      expect(pin!.material, name).toBe(material)
      expect(pin!.building, name).toBeLessThan(city.buildings.counts.length)
    }
  })
})
