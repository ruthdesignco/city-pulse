// The land beyond the baked city (Ground.tsx), textured to read as distant
// city rather than bare ground: a generated tile of city blocks in varied
// roof tones with darker streets between them, plus fine grain. Seen from
// kilometers out through the fog it reads as urban texture, not detail.
//
// Tones vary around palette.ground and the tile is normalized so its mean
// is exactly palette.ground (in linear light), the color the paving fades
// to at the bake area's edge (paving.ts): the textured land and the paving
// meet without a seam once mipmapping averages the tile out.

import { Color, DataTexture, LinearMipmapLinearFilter, MeshStandardMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace } from 'three'
import { registerHeightFog } from '../scene/sceneUniforms.ts'
import { palette } from './palette.ts'

export const LAND_TILE_SIZE = 256
// Meters of land one tile covers: 16 blocks of 100 m each way (BLOCKS must
// divide LAND_TILE_SIZE, or the block grid won't wrap).
export const LAND_TILE_M = 1600
const BLOCKS = 16
// Streets as a share of each block's width.
const STREET = 0.14
// Brightness of streets, and the spread of block tones, relative to the
// mean: kept low, so from afar it reads as mottled city, not a grid.
const STREET_TONE = 0.94
const BLOCK_SPREAD = 0.1
const GRAIN = 0.06
// Broad, soft patches across the tile (neighborhoods, parks, hills in
// shadow) that break up the block grid's regularity: a few sine waves with
// whole-number counts across the tile, so it still wraps seamlessly.
const MOTTLE = 0.14
const MOTTLE_WAVES = 6
const SEED = 11

// Small seeded PRNG (mulberry32), so every load gets the same land.
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

// Per-pixel brightness factors for one tile, normalized to mean 1.
export function landTones(size = LAND_TILE_SIZE): Float32Array {
  const rand = random(SEED)
  const blockTone = Array.from({ length: BLOCKS * BLOCKS }, () => 1 + (rand() - 0.5) * 2 * BLOCK_SPREAD)
  const waves = Array.from({ length: MOTTLE_WAVES }, () => ({
    kx: 1 + Math.floor(rand() * 4),
    ky: Math.floor(rand() * 7) - 3,
    phase: rand() * Math.PI * 2,
  }))
  const mottle = (i: number, j: number) =>
    (waves.reduce((s, w) => s + Math.sin((2 * Math.PI * (w.kx * i + w.ky * j)) / size + w.phase), 0) / Math.sqrt(MOTTLE_WAVES)) * MOTTLE
  const cell = size / BLOCKS
  const tones = new Float32Array(size * size)
  let sum = 0
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const street = (i % cell) / cell < STREET || (j % cell) / cell < STREET
      const block = blockTone[Math.floor(j / cell) * BLOCKS + Math.floor(i / cell)]
      const t = (street ? STREET_TONE : block) * (1 + (rand() - 0.5) * 2 * GRAIN) * (1 + mottle(i, j))
      tones[j * size + i] = t
      sum += t
    }
  const mean = sum / tones.length
  for (let k = 0; k < tones.length; k++) tones[k] /= mean
  return tones
}

export function createLandTexture(): DataTexture {
  const tones = landTones()
  const base = new Color(palette.ground) // linear
  const c = new Color()
  const srgb = { r: 0, g: 0, b: 0 }
  const data = new Uint8Array(tones.length * 4)
  for (let k = 0; k < tones.length; k++) {
    // Scale in linear light, store as sRGB bytes.
    c.setRGB(Math.min(1, base.r * tones[k]), Math.min(1, base.g * tones[k]), Math.min(1, base.b * tones[k]))
    c.getRGB(srgb, SRGBColorSpace)
    data.set([Math.round(srgb.r * 255), Math.round(srgb.g * 255), Math.round(srgb.b * 255), 255], k * 4)
  }
  const t = new DataTexture(data, LAND_TILE_SIZE, LAND_TILE_SIZE, RGBAFormat)
  t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.minFilter = LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

// The land's material: the tile sampled twice, at different scales and
// rotated against each other, and averaged, so neither copy's repeat lines
// up into a visible grid; then shaded by broad value noise in world meters
// (BROAD_M and BROAD_M / 3, +-BROAD_AMOUNT), patches far larger than any
// tile. Both keep the mean at palette.ground. Both fade out between
// SMOOTH_FROM_M and SMOOTH_TO_M from the camera, so land far off reads
// smooth through the haze rather than mottled.
const SECOND_SCALE = 0.61
const SECOND_ANGLE = 0.64 // radians, ~37 deg
const BROAD_M = 2600
const BROAD_AMOUNT = 0.12
const SMOOTH_FROM_M = 2500
const SMOOTH_TO_M = 6500

export function createLandMaterial(map: DataTexture): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ map, roughness: 0.95 })
  const c = Math.cos(SECOND_ANGLE).toFixed(4)
  const sn = Math.sin(SECOND_ANGLE).toFixed(4)
  const g = new Color(palette.ground)
  const mean = `vec3( ${g.r.toFixed(5)}, ${g.g.toFixed(5)}, ${g.b.toFixed(5)} )`
  material.onBeforeCompile = (shader) => {
    registerHeightFog(shader)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
float landHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float landNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( landHash( i ), landHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( landHash( i + vec2( 0.0, 1.0 ) ), landHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 tileA = texture2D( map, vMapUv );
vec4 tileB = texture2D( map, mat2( ${c}, ${sn}, -${sn}, ${c} ) * vMapUv * ${SECOND_SCALE.toFixed(4)} + vec2( 0.37, 0.71 ) );
vec2 meters = vMapUv * ${LAND_TILE_M.toFixed(1)};
float broad = 0.65 * landNoise( meters / ${BROAD_M.toFixed(1)} ) + 0.35 * landNoise( meters / ${(BROAD_M / 3).toFixed(1)} + 17.0 );
vec3 landTile = 0.5 * ( tileA.rgb + tileB.rgb ) * ( 1.0 + ${(2 * BROAD_AMOUNT).toFixed(3)} * ( broad - 0.5 ) );
diffuseColor.rgb *= mix( landTile, ${mean}, smoothstep( ${SMOOTH_FROM_M.toFixed(1)}, ${SMOOTH_TO_M.toFixed(1)}, length( vViewPosition ) ) );`,
      )
  }
  material.customProgramCacheKey = () => 'land-v2'
  return material
}
