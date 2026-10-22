// The color of land beyond the bake area (Ground.tsx: the backdrop, and the
// city's own terrain past the paving), from what's there (landCover.ts):
//
//   Urban (OSM residential, commercial, retail, industrial land use, and
//   untagged low, flat land, which around the Bay is city too: downtowns,
//   the ports, the airports) shows rooftops (urbanTexture): blocks of lots
//   in muted roof tones, a few yards, darker streets, averaging to
//   URBAN_MEAN, a neutral gray a little lighter than the city's ground. It
//   evens out to that mean between SMOOTH_FROM_M and SMOOTH_TO_M from the
//   camera, so far city reads smooth through the haze.
//   Natural land (OSM grass, scrub, woods, rock, and untagged hills: high or
//   steep ground) takes muted green-brown grass and scrub, greener on
//   north-facing slopes, darker woods, gray rock on cliffs and steep faces;
//   right at the water it eases to a shore tone, so coasts read soft.

import { Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace } from 'three'
import { palette } from './palette.ts'
import type { LandCover } from './landCover.ts'

const URBAN_MEAN = new Color(palette.ground).lerp(new Color(palette.building), 0.06).multiplyScalar(1.03)
// The rooftop tile: URBAN_TILE_M across, BLOCKS x BLOCKS blocks, turned
// URBAN_ANGLE off the scene's axes.
const URBAN_TILE_SIZE = 256
const URBAN_TILE_M = 800
const BLOCKS = 8
const URBAN_ANGLE = 0.14
const STREET = 0.12 // of a block's width
const SMOOTH_FROM_M = 2500
const SMOOTH_TO_M = 6500
// Roof tones relative to the mean (r, g, b factors), and how often each
// comes up; yards are the green.
const ROOFS: [number, [number, number, number]][] = [
  [5, [1.07, 1.07, 1.06]], // light gray
  [4, [1.0, 1.0, 1.0]], // gray
  [3, [1.07, 1.03, 0.97]], // pale beige
  [2, [0.88, 0.89, 0.9]], // dark gray
  [1, [1.02, 0.92, 0.86]], // muted terracotta
  [2, [0.86, 0.92, 0.8]], // yard
]
const STREET_TONE = 0.8

// Untagged land is wild above WILD_ABOVE_M (fully WILD_SPAN_M higher) or
// steeper than a WILD_SLOPE gradient (fully 0.1 steeper); urban land use
// on hills keeps a third of that (the Oakland hills' houses among trees).
const WILD_ABOVE_M = 130
const WILD_SPAN_M = 40
const WILD_SLOPE = 0.22
// Rock where the slope's normal's y falls from ROCK_FROM (~32 deg) to
// ROCK_FULL (~45 deg).
const ROCK_FROM = 0.85
const ROCK_FULL = 0.7
const SHORE_TO_M = 1.5

export const LAND_COLORS = {
  grass: new Color('#78765f'),
  scrubDry: new Color('#75725d'),
  scrubGreen: new Color('#5f654d'),
  wood: new Color('#4c5442'),
  rock: new Color('#7f7b73'),
  shore: new Color('#85827a'),
}

// Small seeded PRNG (mulberry32), so every load gets the same rooftops.
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

// The rooftop tile's colors (linear), normalized to mean URBAN_MEAN: each
// block a street's width in from its edges, split into two rows of 3 to 6
// lots, each lot a roof tone.
export function urbanTiles(size = URBAN_TILE_SIZE): Float32Array {
  const rand = random(7)
  const weights = ROOFS.reduce((s, [w]) => s + w, 0)
  const pick = () => {
    let r = rand() * weights
    for (const [w, tone] of ROOFS) if ((r -= w) < 0) return tone
    return ROOFS[0][1]
  }
  const cell = size / BLOCKS
  const lots = Array.from({ length: BLOCKS * BLOCKS }, () => {
    const n = 3 + Math.floor(rand() * 4)
    return [0, 1].map(() => Array.from({ length: n }, () => pick().map((v) => v * (1 + (rand() - 0.5) * 0.08))))
  })
  const out = new Float32Array(size * size * 3)
  const sum = [0, 0, 0]
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const u = (i % cell) / cell
      const v = (j % cell) / cell
      const street = u < STREET || v < STREET
      const block = lots[Math.floor(j / cell) * BLOCKS + Math.floor(i / cell)]
      const row = block[v < STREET + (1 - STREET) / 2 ? 0 : 1]
      const tone = street ? [STREET_TONE, STREET_TONE, STREET_TONE] : row[Math.min(row.length - 1, Math.floor(((u - STREET) / (1 - STREET)) * row.length))]
      for (let c = 0; c < 3; c++) {
        out[(j * size + i) * 3 + c] = tone[c]
        sum[c] += tone[c]
      }
    }
  const mean = [URBAN_MEAN.r, URBAN_MEAN.g, URBAN_MEAN.b]
  for (let k = 0; k < out.length; k++) out[k] *= (mean[k % 3] * size * size) / sum[k % 3]
  return out
}

function urbanTexture(): DataTexture {
  const lin = urbanTiles()
  const data = new Uint8Array((lin.length / 3) * 4)
  const c = new Color()
  for (let k = 0; k < lin.length / 3; k++) {
    c.setRGB(Math.min(1, lin[3 * k]), Math.min(1, lin[3 * k + 1]), Math.min(1, lin[3 * k + 2])).convertLinearToSRGB()
    data.set([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), 255], 4 * k)
  }
  const t = new DataTexture(data, URBAN_TILE_SIZE, URBAN_TILE_SIZE, RGBAFormat)
  t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.minFilter = LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

export interface LandTextures {
  cover: DataTexture // the cover, sample (i, j) at texel (i, j)'s center
  urban: DataTexture
}

const built = new WeakMap<LandCover, LandTextures>()

export function landTextures(landCover: LandCover): LandTextures {
  let t = built.get(landCover)
  if (!t) {
    const { nx, nz } = landCover.header
    const cover = new DataTexture(landCover.rgba, nx, nz, RGBAFormat)
    cover.magFilter = LinearFilter
    cover.minFilter = LinearFilter
    cover.needsUpdate = true
    t = { cover, urban: urbanTexture() }
    built.set(landCover, t)
  }
  return t
}

// Sets the uniforms landPars declares.
export function landUniforms(landCover: LandCover) {
  const t = landTextures(landCover)
  return { uLandCover: { value: t.cover }, uLandUrban: { value: t.urban } }
}

const f = (v: number) => v.toFixed(5)
const vec3 = (c: Color) => `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`

// GLSL declarations (fragment shader): landColor( xz, height above sea
// level, the ground's normal, distance from the camera ).
export function landPars(landCover: LandCover): string {
  const { x0, z0, cell, nx, nz } = landCover.header
  const c = LAND_COLORS
  const cos = Math.cos(URBAN_ANGLE)
  const sin = Math.sin(URBAN_ANGLE)
  return /* glsl */ `
uniform sampler2D uLandCover;
uniform sampler2D uLandUrban;
vec3 landColor( vec2 xz, float h, vec3 n, float dist ) {
  vec4 cover = texture2D( uLandCover, ( ( xz - vec2( ${f(x0)}, ${f(z0)} ) ) / ${f(cell)} + 0.5 ) / vec2( ${f(nx)}, ${f(nz)} ) );
  float tagged = min( 1.0, cover.g + cover.b + cover.a );
  float slope = length( n.xz ) / max( n.y, 0.05 );
  float wild = clamp( max( ( h - ${f(WILD_ABOVE_M)} ) / ${f(WILD_SPAN_M)}, ( slope - ${f(WILD_SLOPE)} ) / 0.1 ), 0.0, 1.0 );
  float natural = max( tagged, wild * ( 1.0 - 0.67 * cover.r ) );
  float north = clamp( -n.z * 4.0 + 0.3, 0.0, 1.0 );
  vec3 untagged = mix( ${vec3(c.scrubDry)}, ${vec3(c.scrubGreen)}, north );
  vec3 wildColor = cover.g * mix( ${vec3(c.grass)}, ${vec3(c.scrubGreen)}, 0.5 * north ) + cover.b * ${vec3(c.wood)} + cover.a * ${vec3(c.rock)} + ( 1.0 - tagged ) * untagged;
  wildColor = mix( wildColor, ${vec3(c.rock)}, smoothstep( ${f(ROCK_FROM)}, ${f(ROCK_FULL)}, n.y ) );
  wildColor = mix( ${vec3(c.shore)}, wildColor, smoothstep( 0.0, ${f(SHORE_TO_M)}, h ) );
  vec2 roofUv = mat2( ${f(cos)}, ${f(sin)}, ${f(-sin)}, ${f(cos)} ) * xz / ${f(URBAN_TILE_M)};
  vec3 urban = mix( texture2D( uLandUrban, roofUv ).rgb, ${vec3(URBAN_MEAN)}, smoothstep( ${f(SMOOTH_FROM_M)}, ${f(SMOOTH_TO_M)}, dist ) );
  return mix( urban, wildColor, natural );
}
`
}
