// A tileable water normal map for the Bay (BayWater.tsx), generated at
// startup rather than shipped as an image: no file to license or download.
//
// The height field is a sum of sine waves with whole-number wave counts
// across the tile, so it wraps seamlessly; normals come from its exact
// gradient. Waves mostly run one way (a breeze off the Pacific), with a
// spread of directions and lengths so the tiling doesn't read as a grid.
// Encoded like any tangent-space normal map: R = x, G = z (across the
// surface), B = up, each mapped from [-1, 1] to [0, 255]. three's Water
// shader reads it as noise.xzy.

import { DataTexture, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat } from 'three'

export const WATER_NORMALS_SIZE = 256
const WAVES = 48
// How steep the ripples are: higher is choppier.
const SLOPE = 0.3
const SEED = 7

interface Wave {
  kx: number
  ky: number
  amp: number
  phase: number
}

// Small seeded PRNG (mulberry32), so every load gets the same water.
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function waves(): Wave[] {
  const rand = random(SEED)
  const out: Wave[] = []
  while (out.length < WAVES) {
    // Wave counts 2..24 across the tile, mostly along one heading (+-50 deg).
    const count = 2 + rand() * 22
    const heading = 0.6 + (rand() - 0.5) * 1.75
    const kx = Math.round(count * Math.cos(heading))
    const ky = Math.round(count * Math.sin(heading))
    if (kx === 0 && ky === 0) continue
    // Shorter waves are smaller (amplitude ~ wavelength): equal slope per wave.
    out.push({ kx, ky, amp: 1 / Math.hypot(kx, ky), phase: rand() * Math.PI * 2 })
  }
  return out
}

// Normals for a size x size tile, as RGBA bytes.
export function waterNormalData(size = WATER_NORMALS_SIZE): Uint8Array {
  const ws = waves()
  // Each wave's slope amplitude is 2*pi; scale the sum to an RMS of ~SLOPE.
  const norm = SLOPE / (Math.PI * Math.sqrt(2 * ws.length))
  const data = new Uint8Array(size * size * 4)
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      let dx = 0
      let dy = 0
      for (const w of ws) {
        const c = Math.cos((2 * Math.PI * (w.kx * i + w.ky * j)) / size + w.phase) * w.amp * 2 * Math.PI
        dx += c * w.kx
        dy += c * w.ky
      }
      // normal = (-dh/dx, -dh/dy, 1), normalized.
      const nx = -dx * norm
      const ny = -dy * norm
      const len = Math.hypot(nx, ny, 1)
      const k = (j * size + i) * 4
      data[k] = Math.round(((nx / len) * 0.5 + 0.5) * 255)
      data[k + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255)
      data[k + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255)
      data[k + 3] = 255
    }
  return data
}

export function createWaterNormals(): DataTexture {
  const t = new DataTexture(waterNormalData(), WATER_NORMALS_SIZE, WATER_NORMALS_SIZE, RGBAFormat)
  t.wrapS = t.wrapT = RepeatWrapping
  t.minFilter = LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.colorSpace = NoColorSpace
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}
