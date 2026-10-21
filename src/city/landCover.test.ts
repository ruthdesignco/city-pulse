import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { decodeLandCover, encodeLandCover } from './landCover.ts'
import { urbanTiles } from './landShading.ts'
import { palette } from './palette.ts'

describe('land cover', () => {
  it('round-trips the cover and the island buildings', async () => {
    const rgba = Uint8Array.from({ length: 3 * 2 * 4 }, (_, k) => (k * 37) % 256)
    const buildings = [{ ring: [[0, 0], [10, 0], [10, -10]] as [number, number][], height: 12, name: 'Main Prison' }]
    const header = { version: 1 as const, x0: -100, z0: 50, cell: 50, nx: 3, nz: 2, buildings, source: 'test', bakedAt: '' }
    const back = await decodeLandCover((await encodeLandCover({ header, rgba })).buffer as ArrayBuffer)
    expect(back.header).toEqual(header)
    expect([...back.rgba]).toEqual([...rgba])
  })

  it('draws distant rooftops a little lighter than the city ground on average', () => {
    const tiles = urbanTiles(64)
    const mean = [0, 1, 2].map((c) => tiles.filter((_, k) => k % 3 === c).reduce((a, b) => a + b, 0) / (64 * 64))
    const ground = new Color(palette.ground)
    const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
    const ratio = lum(mean[0], mean[1], mean[2]) / lum(ground.r, ground.g, ground.b)
    expect(ratio).toBeGreaterThan(1.05)
    expect(ratio).toBeLessThan(1.2)
  })
})
