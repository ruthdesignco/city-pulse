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

// A hazy San Francisco afternoon: high turbidity and Mie scattering, low
// Rayleigh, so the horizon is a gray-white haze under a muted blue, never
// the model's default deep saturated blue.
export const SKY_PARAMS: SkyParams = { turbidity: 12, rayleigh: 0.25, mieCoefficient: 0.06, mieDirectionalG: 0.8 }
// Scales Sky.js's radiance into the scene's units, set so the haze at the
// horizon (opposite the sun) reads about as bright as a sunlit pale wall.
export const SKY_EXPOSURE = 9
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
