// Light intensities derived, not eyeballed, so palette values mean what they
// say: a sunlit, upward-facing surface renders at (close to) its palette
// color. Verified end to end by `npm run calibrate`.
//
// three.js lights are physical: a Lambert surface of albedo A under
// irradiance E reflects radiance A * E / pi. So the sun and sky together
// must deliver E = pi on a horizontal surface for radiance to equal A:
//
//   sun:  SUN_INTENSITY * sin(elevation) * sunColor     (direct, on the ground)
//   sky:  SKY_INTENSITY * SKY_LIGHT_COLOR               (hemisphere light, full sky)
//
// split SUN_SHARE / (1 - SUN_SHARE) by luminance. A low golden-hour sun puts
// most of its light on walls facing it, so the sky carries a big share of
// the ground's light; shadowed ground then sits at 1 - SUN_SHARE of sunlit.
//
// The sky's color isn't picked, it's solved for: whatever makes sun + sky
// sum to neutral white on sunlit ground, so a gray swatch renders gray
// rather than taking the sun's warmth. Against palette.sun's gold that comes
// out a soft blue -- what a clear sky's fill light really is -- so shadows
// read slightly cool and only faces the sun hits read warm.
// Tone mapping is Khronos PBR Neutral (App.tsx), which leaves values up to
// ~0.8 nearly untouched and only rolls off highlights -- unlike ACES Filmic,
// which crushed the midtones this scene is made of.

import { Color } from 'three'
import { palette } from '../city/palette.ts'
import { SUN_ELEVATION_DEG } from './sun.ts'

export const SUN_SHARE = 0.55

const luminance = (hex: string) => {
  const c = new Color(hex)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

const sinElevation = Math.sin((SUN_ELEVATION_DEG * Math.PI) / 180)

const sun = new Color(palette.sun)
export const SUN_INTENSITY = (SUN_SHARE * Math.PI) / (sinElevation * luminance(palette.sun))

// The sun's irradiance on the ground, per channel, as a fraction of pi.
const sunOnGround = sun.clone().multiplyScalar((SUN_INTENSITY * sinElevation) / Math.PI)
// The rest of white, from the sky; luminance 1, intensity carries the level.
const skyNeeded = new Color(1 - sunOnGround.r, 1 - sunOnGround.g, 1 - sunOnGround.b)
const skyLuminance = 0.2126 * skyNeeded.r + 0.7152 * skyNeeded.g + 0.0722 * skyNeeded.b
export const SKY_LIGHT_COLOR = skyNeeded.clone().multiplyScalar(1 / skyLuminance)
export const SKY_INTENSITY = skyLuminance * Math.PI

// The irradiance on a sunlit horizontal surface, per channel, divided by pi:
// what a palette color is multiplied by before tone mapping. (1, 1, 1) means
// it renders as itself.
export function sunlitGain(): Color {
  return sun
    .clone()
    .multiplyScalar((SUN_INTENSITY * sinElevation) / Math.PI)
    .add(SKY_LIGHT_COLOR.clone().multiplyScalar(SKY_INTENSITY / Math.PI))
}
