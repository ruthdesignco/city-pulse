import { CanvasTexture, SRGBColorSpace } from 'three'

// Scene background, not a mesh dome: a plain Texture assigned to
// scene.background renders as its own fullscreen pre-pass, entirely outside
// normal depth-tested geometry. The mesh-dome approach (camera-centered
// sphere, BackSide, depthTest/Write off, renderOrder -1) left a dark band
// unaccounted for between the clouds and the skyline -- proven NOT to be the
// dome's own fragment output by forcing it to solid magenta and seeing the
// band stay dark regardless. Something in the normal depth-tested draw order
// was overwriting it there. This sidesteps that whole class of bug.
//
// A vertical-only gradient (no horizontal variation) is the right tradeoff
// for this camera: CameraRig only ever varies polar angle in a narrow band
// and orbits azimuth around TARGET, so a flat screen-space gradient reads
// correctly under azimuth orbit (no horizontal sky variation to get wrong)
// and only approximates pitch changes within that narrow range -- same
// "art-directed, not physically simulated" tradeoff as the fixed sun
// position in sun.ts.
const WIDTH = 2
const HEIGHT = 512

// Only the top ~15-20% of this texture is ever actually visible (Ground.tsx's
// plane and its fog cover the rest before the texture would show through),
// so the zenith-to-horizon blend needs to mostly finish within that same
// top slice -- holding the old ZENITH_HOLD (0.45) past it meant almost the
// entire visible strip was flat zenith blue, then the horizon tone only
// showed up as a late, abrupt hand-off right at the ground's edge.
const ZENITH_HOLD = 0.02
const HORIZON_START = 0.11

export function createSkyBackgroundTexture(horizon: string, zenith: string, sunColor: string, sunScreenY: number): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!

  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT)
  gradient.addColorStop(0, zenith)
  gradient.addColorStop(ZENITH_HOLD, zenith)
  gradient.addColorStop(HORIZON_START, horizon)
  gradient.addColorStop(1, horizon)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // Soft warm glow band near the sun's approximate screen height -- a 2px-
  // wide canvas has no horizontal extent to localize it, so this reads as a
  // warm horizontal band rather than a sun disc, which is fine: it's an
  // atmospheric accent, not a pixel-accurate sun position. Partial alpha, not
  // full-strength sunColor: at full strength this washed the zenith blue out
  // to near-white across most of the visible strip.
  const glowRadius = HEIGHT * 0.12
  const glowY = sunScreenY * HEIGHT
  const glow = ctx.createRadialGradient(WIDTH / 2, glowY, 0, WIDTH / 2, glowY, glowRadius)
  glow.addColorStop(0, sunColor)
  glow.addColorStop(1, `${sunColor}00`)
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.45
  ctx.fillStyle = glow
  ctx.fillRect(0, glowY - glowRadius, WIDTH, glowRadius * 2)
  ctx.globalAlpha = 1

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}
