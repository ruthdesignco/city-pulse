import { Color, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { palette } from '../city/palette.ts'
import { SKY_PARAMS, SUN_DIRECTION, horizonColor, skyRadiance } from './skyModel.ts'
import { OPENING_POSITION, TARGET } from './view.ts'

const along = (azimuthDeg: number, elevationDeg: number) => {
  const a = (azimuthDeg * Math.PI) / 180
  const e = (elevationDeg * Math.PI) / 180
  return new Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a))
}
const sky = (azimuthDeg: number, elevationDeg: number) => skyRadiance(along(azimuthDeg, elevationDeg), SUN_DIRECTION, SKY_PARAMS, SUN_DIRECTION.y)
const luminance = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

describe('the sky model', () => {
  it('is brightest toward the sun and bluer overhead than at the horizon', () => {
    const sunAzimuth = (Math.atan2(SUN_DIRECTION.x, -SUN_DIRECTION.z) * 180) / Math.PI
    expect(luminance(sky(sunAzimuth, 2))).toBeGreaterThan(luminance(sky(sunAzimuth + 180, 2)))
    const [hr, , hb] = sky(sunAzimuth + 180, 0)
    const [zr, , zb] = sky(sunAzimuth + 180, 60)
    expect(zb / zr).toBeGreaterThan(hb / hr)
  })

  it('sets the haze: palette.sky is its horizon color in the opening view', () => {
    const azimuth = Math.atan2(TARGET[0] - OPENING_POSITION[0], -(TARGET[2] - OPENING_POSITION[2]))
    const model = horizonColor(azimuth)
    const hex = new Color(palette.sky)
    for (const k of ['r', 'g', 'b'] as const) expect(Math.abs(model[k] - hex[k])).toBeLessThan(0.01)
  })
})
