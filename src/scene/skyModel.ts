// Ported from three.js r186, examples/jsm/objects/Sky.js, under the MIT
// License reproduced here as it requires:
//
// The MIT License
//
// Copyright © 2010-2026 three.js authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// The Preetham daylight sky, the same model three's Sky object renders
// (three/examples/jsm/objects/Sky.js), evaluated on the CPU so the rest of
// the scene can agree with it: the fog color is the sky's own color at the
// horizon, so fogged ground meets the sky with no seam (Atmosphere.tsx).
// A line-for-line port of Sky.js's shader math (vertex and fragment, minus
// its cloud layer and sun disc), with the same parameter names.
//
// skyRadiance is linear radiance at Sky.js's own exposure (its 0.04
// factor); SKY_EXPOSURE scales it into this scene's units.

import { Color, Vector3 } from 'three'
import { SUN_POSITION } from './sun.ts'

export interface SkyParams {
  turbidity: number
  rayleigh: number
  mieCoefficient: number
  mieDirectionalG: number
}

const PI = Math.PI
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5]
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14]
const CUTOFF_ANGLE = 1.6110731556870734
const STEEPNESS = 1.5
const EE = 1000
const RAYLEIGH_ZENITH_LENGTH = 8.4e3
const MIE_ZENITH_LENGTH = 1.25e3
const THREE_OVER_SIXTEENPI = 0.05968310365946075
const ONE_OVER_FOURPI = 0.07957747154594767
// Sky.js adds this to every pixel (a faint blue floor for the night sky).
const FLOOR = [0, 0.0003, 0.00075]

function sunIntensity(zenithAngleCos: number): number {
  const c = Math.min(1, Math.max(-1, zenithAngleCos))
  return EE * Math.max(0, 1 - Math.exp(-((CUTOFF_ANGLE - Math.acos(c)) / STEEPNESS)))
}

// Linear RGB radiance of the sky looking along `direction`, with the sun
// along `sunDirection` (both unit vectors). `sunHeight` is the y of Sky.js's
// sunPosition uniform, which only feeds its sun-fade term.
export function skyRadiance(direction: Vector3, sunDirection: Vector3, p: SkyParams, sunHeight: number): [number, number, number] {
  // Vertex stage.
  const sunE = sunIntensity(sunDirection.y)
  const sunfade = 1 - Math.min(1, Math.max(0, 1 - Math.exp(sunHeight / 450000)))
  const rayleighCoefficient = p.rayleigh - (1 - sunfade)
  const betaR = TOTAL_RAYLEIGH.map((v) => v * rayleighCoefficient)
  const mie = 0.434 * (0.2 * p.turbidity * 10e-18)
  const betaM = MIE_CONST.map((v) => mie * v * p.mieCoefficient)

  // Fragment stage.
  const zenithAngle = Math.acos(Math.max(0, direction.y))
  const inverse = 1 / (Math.cos(zenithAngle) + 0.15 * Math.pow(93.885 - (zenithAngle * 180) / PI, -1.253))
  const sR = RAYLEIGH_ZENITH_LENGTH * inverse
  const sM = MIE_ZENITH_LENGTH * inverse

  const cosTheta = direction.dot(sunDirection)
  const x = cosTheta * 0.5 + 0.5
  const rPhase = THREE_OVER_SIXTEENPI * (1 + x * x)
  const g = p.mieDirectionalG
  const mPhase = ONE_OVER_FOURPI * ((1 - g * g) / Math.pow(1 - 2 * g * cosTheta + g * g, 1.5))
  const blend = Math.min(1, Math.max(0, Math.pow(1 - sunDirection.y, 5)))

  const out: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const fex = Math.exp(-(betaR[i] * sR + betaM[i] * sM))
    const scatter = (sunE * (betaR[i] * rPhase + betaM[i] * mPhase)) / (betaR[i] + betaM[i])
    let lin = Math.pow(scatter * (1 - fex), 1.5)
    lin *= 1 + (Math.pow(scatter * fex, 0.5) - 1) * blend
    out[i] = (lin + 0.1 * fex) * 0.04 + FLOOR[i]
  }
  return out
}

// ------------------------------------------------------- this scene's sky

// A clear San Francisco afternoon: a blue sky with a pale haze at the
// horizon, the model's own sun glow kept slight (little Mie scattering, in
// a narrow forward lobe) and a golden one added round a low sun (skyGrade),
// so the sky stays blue in most of a frame looking toward it. (Turbidity
// 12, Mie 0.06 at 0.8 lit the whole horizon within ~70 deg of a low sun
// brighter than white: the west views at 16:50 blew out.)
export const SKY_PARAMS: SkyParams = { turbidity: 6, rayleigh: 1.0, mieCoefficient: 0.0015, mieDirectionalG: 0.98 }
// Scales Sky.js's radiance into the scene's units, set so the haze at the
// horizon away from the sun reads about as bright as a sunlit pale wall
// (the same brightness the earlier, hazier sky was tuned to).
export const SKY_EXPOSURE = 0.5244
// Where the fog samples the sky: right at the horizon, the color Sky.js also
// paints below it, which is what fogged ground's far edge meets.
const HORIZON_ELEVATION_DEG = 0

export const SUN_DIRECTION = new Vector3(...SUN_POSITION).normalize()

// The sky's color (linear, scene units) at the horizon, looking toward
// compass bearing `azimuth` (radians; atan2(x, -z), 0 = north).
export function horizonColor(azimuth: number, out = new Color()): Color {
  const e = (HORIZON_ELEVATION_DEG * Math.PI) / 180
  const dir = new Vector3(Math.cos(e) * Math.sin(azimuth), Math.sin(e), -Math.cos(e) * Math.cos(azimuth))
  const [r, g, b] = skyRadiance(dir, SUN_DIRECTION, SKY_PARAMS, SUN_DIRECTION.y)
  return out.setRGB(r * SKY_EXPOSURE, g * SKY_EXPOSURE, b * SKY_EXPOSURE)
}

// ------------------------------------------------- the sky at any time of day

// What the dome shows for a given sun (SkyDome.tsx; skyState.ts computes it
// from the time): the Preetham sky at `exposure`, blended by `night` (0 day,
// 1 night) toward a night gradient, deep blue overhead and a faint warm
// city glow at the horizon. SkyDome's shader does the same per pixel.
export interface SkyLook {
  sunDirection: Vector3
  exposure: number
  night: number
  nightZenith: Color // linear, scene units
  nightHorizon: Color
  // The afterglow on the gradient: its color and strength, low on the
  // horizon toward the sun's bearing.
  glowColor: Color
  glow: number
  // A pale blue veil over the day sky (scene units), full from VEIL_FULL
  // (the y of the direction) up, none at the horizon: the overhead blue
  // that a sky with little haze scattering lacks (SKY_PARAMS).
  veil: Color
  // Cloud cover (weather.ts): how far the whole sky goes to a flat overcast
  // gradient, 0 clear .. 1 overcast.
  overcast: number
  overcastZenith: Color
  overcastHorizon: Color
}

// How the afterglow falls off: with angle from the sun's bearing, and with
// height above the horizon.
export const GLOW_BEARING_POWER = 3
export const GLOW_HEIGHT_POWER = 4

// The low sun's golden glow, added to the Preetham sky (whose own Mie
// scattering is kept slight, SKY_PARAMS, so the sky stays blue): a core a
// few degrees round the sun and a soft fringe out to ~30 deg, both GOLD,
// at full strength with the sun below GOLD_LOW[0] (the y of its direction)
// and gone above GOLD_LOW[1]; then the highlights eased (luminance up to
// KNEE_FROM as it is, compressed past it toward KNEE_MAX, hue kept), so the
// glow keeps its color instead of clipping to white. SkyDome.tsx's shader
// does the same (SKY_GRADE_GLSL).
export const GOLD = new Color(1, 0.64, 0.32)
export const GLOW_CORE_RAD = 0.08
export const GLOW_FRINGE_RAD = 0.3
export const GLOW_CORE = 2.2
export const GLOW_FRINGE = 0.7
const GOLD_LOW = [0.1, 0.55]
const GOLD_HUE = 0.75
const GOLD_HUE_RAD = 0.25
export const KNEE_FROM = 0.85
export const KNEE_MAX = 1.1

// How strongly the glow (and the warm haze, fogColorFor) shows at the sun's height.
export function lowSun(sun: Vector3): number {
  return 1 - Math.min(1, Math.max(0, (sun.y - GOLD_LOW[0]) / (GOLD_LOW[1] - GOLD_LOW[0])))
}

export function skyGrade(c: Color, direction: Vector3, sun: Vector3): Color {
  const a = Math.acos(Math.min(1, Math.max(-1, direction.dot(sun))))
  const glow = (GLOW_CORE * Math.exp(-a / GLOW_CORE_RAD) + GLOW_FRINGE * Math.exp(-a / GLOW_FRINGE_RAD)) * lowSun(sun) * Math.min(1, Math.max(0, direction.y * 20 + 1))
  c.r += GOLD.r * glow
  c.g += GOLD.g * glow
  c.b += GOLD.b * glow
  const l = lum3(c)
  if (l > KNEE_FROM) c.multiplyScalar((KNEE_FROM + (l - KNEE_FROM) / (1 + (l - KNEE_FROM) / (KNEE_MAX - KNEE_FROM))) / l)
  // Near the sun, the sky's own hue shifts toward the gold too.
  const w = GOLD_HUE * Math.exp(-a / GOLD_HUE_RAD) * lowSun(sun)
  const lc = lum3(c)
  const lg = lum3(GOLD)
  return c.lerp(new Color(GOLD.r * (lc / lg), GOLD.g * (lc / lg), GOLD.b * (lc / lg)), w)
}

export const SKY_GRADE_GLSL = /* glsl */ `
vec3 skyGrade( vec3 c, vec3 dir, vec3 sun ) {
  float a = acos( clamp( dot( dir, sun ), -1.0, 1.0 ) );
  float low = 1.0 - clamp( ( sun.y - ${GOLD_LOW[0].toFixed(3)} ) / ${(GOLD_LOW[1] - GOLD_LOW[0]).toFixed(3)}, 0.0, 1.0 );
  float glow = ( ${GLOW_CORE.toFixed(3)} * exp( -a / ${GLOW_CORE_RAD.toFixed(3)} ) + ${GLOW_FRINGE.toFixed(3)} * exp( -a / ${GLOW_FRINGE_RAD.toFixed(3)} ) ) * low * clamp( dir.y * 20.0 + 1.0, 0.0, 1.0 );
  c += vec3( ${GOLD.r.toFixed(3)}, ${GOLD.g.toFixed(3)}, ${GOLD.b.toFixed(3)} ) * glow;
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  if ( l > ${KNEE_FROM.toFixed(3)} ) c *= ( ${KNEE_FROM.toFixed(3)} + ( l - ${KNEE_FROM.toFixed(3)} ) / ( 1.0 + ( l - ${KNEE_FROM.toFixed(3)} ) / ${(KNEE_MAX - KNEE_FROM).toFixed(3)} ) ) / l;
  vec3 gold = vec3( ${GOLD.r.toFixed(3)}, ${GOLD.g.toFixed(3)}, ${GOLD.b.toFixed(3)} );
  float w = ${GOLD_HUE.toFixed(3)} * exp( -a / ${GOLD_HUE_RAD.toFixed(3)} ) * low;
  return mix( c, gold * dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) / dot( gold, vec3( 0.2126, 0.7152, 0.0722 ) ), w );
}
`

// The veil's color at the day's full exposure (linear), and where it's full.
export const VEIL = new Color(0.13, 0.2, 0.32)
export const VEIL_FULL = 0.35

export function skyColor(direction: Vector3, look: SkyLook, out = new Color()): Color {
  const base = new Color(...skyRadiance(direction, look.sunDirection, SKY_PARAMS, look.sunDirection.y)).multiplyScalar(look.exposure)
  const v = Math.min(1, Math.max(0, direction.y / VEIL_FULL))
  base.add(look.veil.clone().multiplyScalar(v * v * (3 - 2 * v)))
  const day = skyGrade(base, direction, look.sunDirection)
  const [r, g, b] = [day.r / look.exposure, day.g / look.exposure, day.b / look.exposure]
  const up = Math.sqrt(Math.min(1, Math.max(0, direction.y)))
  const n = look.night
  const flat = Math.hypot(direction.x, direction.z) || 1
  const sunFlat = Math.hypot(look.sunDirection.x, look.sunDirection.z) || 1
  const toward = Math.max(0, (direction.x * look.sunDirection.x + direction.z * look.sunDirection.z) / (flat * sunFlat))
  const glow = look.glow * toward ** GLOW_BEARING_POWER * (1 - up) ** GLOW_HEIGHT_POWER
  const nr = look.nightHorizon.r + (look.nightZenith.r - look.nightHorizon.r) * up + look.glowColor.r * glow
  const ng = look.nightHorizon.g + (look.nightZenith.g - look.nightHorizon.g) * up + look.glowColor.g * glow
  const nb = look.nightHorizon.b + (look.nightZenith.b - look.nightHorizon.b) * up + look.glowColor.b * glow
  out.setRGB(r * look.exposure * (1 - n) + nr * n, g * look.exposure * (1 - n) + ng * n, b * look.exposure * (1 - n) + nb * n)
  const o = look.overcast
  if (o === 0) return out
  return out.setRGB(
    out.r + (look.overcastHorizon.r + (look.overcastZenith.r - look.overcastHorizon.r) * up - out.r) * o,
    out.g + (look.overcastHorizon.g + (look.overcastZenith.g - look.overcastHorizon.g) * up - out.g) * o,
    out.b + (look.overcastHorizon.b + (look.overcastZenith.b - look.overcastHorizon.b) * up - out.b) * o,
  )
}

// The sky at the horizon toward compass bearing `azimuth` (radians).
export function horizonColorFor(azimuth: number, look: SkyLook, out = new Color()): Color {
  return skyColor(new Vector3(Math.sin(azimuth), 0, -Math.cos(azimuth)), look, out)
}

// The far haze (Atmosphere.tsx), as the camera faces `azimuth`: the haze
// away from the sun (`haze`, hazeColor), and toward a low sun warmed toward
// GOLD and up to FOG_GLOW_MAX times as bright, never the glow's own
// brightness: distant hills and sea stand against the glow, darker, as
// silhouettes, instead of fading into it.
export const FOG_GLOW_MAX = 1.3
const FOG_TOWARD_POWER = 4
export function fogColorFor(azimuth: number, look: SkyLook, haze: Color, out = new Color()): Color {
  const sun = look.sunDirection
  const flat = Math.hypot(sun.x, sun.z) || 1
  const toward = Math.max(0, (Math.sin(azimuth) * sun.x - Math.cos(azimuth) * sun.z) / flat) ** FOG_TOWARD_POWER * lowSun(sun) * (1 - look.night)
  const warm = haze.clone().multiply(GOLD)
  warm.multiplyScalar((FOG_GLOW_MAX * lum3(haze)) / Math.max(1e-6, lum3(warm)))
  return out.copy(haze).lerp(warm, toward)
}

// The far sea's haze (sceneUniforms.ts uSeaFog), as the camera faces
// `azimuth`: the sky it mostly mirrors there (a few degrees up), SEA_FOG_SHADE darker, and toward a low
// sun no brighter than SEA_GLOW_MAX times the haze: a warm band under the
// glow, so the horizon reads as a line; the sun's glitter lights it
// (BayWater.tsx).
const SEA_FOG_SHADE = 0.85
const SEA_GLOW_MAX = 1.0
const SEA_FOG_ELEVATION = 0.05 // rad: the sky the sea mostly mirrors, a few degrees up
export function seaFogFor(azimuth: number, look: SkyLook, haze: Color, out = new Color()): Color {
  const e = SEA_FOG_ELEVATION
  skyColor(new Vector3(Math.cos(e) * Math.sin(azimuth), Math.sin(e), -Math.cos(e) * Math.cos(azimuth)), look, out).multiplyScalar(SEA_FOG_SHADE)
  const cap = SEA_GLOW_MAX * lum3(haze)
  const l = lum3(out)
  return l > cap ? out.multiplyScalar(cap / l) : out
}

const AROUND = Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8)
const lum3 = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

// The mean of the dimmer half of `colors`: the horizon's haze away from the
// sun's glare, which is what palette.sky always was.
function dimHalf(colors: Color[], out: Color): Color {
  const dim = [...colors].sort((a, b) => lum3(a) - lum3(b)).slice(0, colors.length / 2)
  out.setRGB(0, 0, 0)
  for (const c of dim) {
    out.r += c.r / dim.length
    out.g += c.g / dim.length
    out.b += c.b / dim.length
  }
  return out
}

// The haze the context ring fades toward: the horizon all the way around,
// away from the sun (the ring isn't seen from one direction).
export function hazeColor(look: SkyLook, out = new Color()): Color {
  return dimHalf(
    AROUND.map((a) => horizonColorFor(a, look)),
    out,
  )
}

// The same haze from the Preetham sky alone at exposure 1, for holding the
// sky's brightness steady as the sun moves (skyState.ts).
export function rawHorizonLuminance(sunDirection: Vector3): number {
  const colors = AROUND.map((a) => {
    const [r, g, b] = skyRadiance(new Vector3(Math.sin(a), 0, -Math.cos(a)), sunDirection, SKY_PARAMS, sunDirection.y)
    return new Color(r, g, b)
  })
  return lum3(dimHalf(colors, new Color()))
}
