// How the ground reads its shape and cover (Ground.tsx, Streets.tsx):
//
//   Hillshading: the ground lit by its slope against the sun (or moon),
//   relative to flat ground, so flat ground keeps its calibrated color and
//   a hillside facing the light brightens, one facing away darkens, even
//   where only a sliver of it shows between buildings
//   (sceneUniforms.ts uLightDir, uHillshade).
//   Valleys: soft ambient occlusion where the ground lies below its
//   surroundings (the 5 m heights against their blur over AO_RADIUS_M):
//   the foot of a slope, a hollow, a cut darkens a little.
//   Cover: OSM's parks, woods and scrub, rock and cliffs, sand
//   (city.bin cover), drawn into a 5 m map, shown instead of paving.
//
// Both maps are on the terrain's grid, built once per loaded city: the
// normals with the occlusion in alpha (normalsAo), and the cover's classes
// in red (grass), green (wood) and blue (rock; sand is half of it). Past
// the bake area the normals and occlusion come from ground smoothed over
// SMOOTH_RADIUS_M: there the 1 m lidar's piers, pads and rubble only
// mottled the land, which reads as distant city (landShading.ts).

import { Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat } from 'three'
import { COORD_QUANTUM } from './format.ts'
import { EDGE_BLEND_M, bakeDistance } from './paving.ts'
import { Terrain } from './terrain.ts'
import type { LoadedCity } from './useCity.ts'

export const AO_RADIUS_M = 40
const AO_DEPTH_M = 6 // this far below its surroundings is fully occluded
export const AO_MAX = 0.35 // the most a hollow darkens
// How strongly slope shading departs from flat ground's, at full sun.
export const HILLSHADE = 0.4
const SMOOTH_RADIUS_M = 60
// With the sun low (light elevation sin from LOW_SUN_TO down to
// LOW_SUN_FROM), slopes facing away shade by up to LOW_SUN_BOOST more, so
// the hills read in long morning and evening light; slopes facing the sun
// brighten no more than at noon (more washed pavement out to white).
export const LOW_SUN_BOOST = 0.5
const LOW_SUN_FROM = 0.2
const LOW_SUN_TO = 0.7

export const COVER_COLORS = {
  grass: new Color('#7c8d5c'),
  wood: new Color('#5c6847'),
  rock: new Color('#8a8475'),
}

// Box blur of a grid along rows then columns, `r` samples each way.
function blur(src: Float32Array, nx: number, nz: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const at = (a: number, n: number) => Math.min(n - 1, Math.max(0, a))
  for (let j = 0; j < nz; j++) {
    let sum = 0
    for (let i = -r; i <= r; i++) sum += src[j * nx + at(i, nx)]
    for (let i = 0; i < nx; i++) {
      tmp[j * nx + i] = sum / (2 * r + 1)
      sum += src[j * nx + at(i + r + 1, nx)] - src[j * nx + at(i - r, nx)]
    }
  }
  for (let i = 0; i < nx; i++) {
    let sum = 0
    for (let j = -r; j <= r; j++) sum += tmp[at(j, nz) * nx + i]
    for (let j = 0; j < nz; j++) {
      out[j * nx + i] = sum / (2 * r + 1)
      sum += tmp[at(j + r + 1, nz) * nx + i] - tmp[at(j - r, nz) * nx + i]
    }
  }
  return out
}

// How much each sample is occluded, 0 (open) .. AO_MAX: how far it lies
// below the (twice box-blurred, so smooth) ground around it.
export function occlusion(t: Terrain): Float32Array {
  const { nx, nz, cell, quantum } = t.header
  const h = new Float32Array(nx * nz)
  for (let k = 0; k < h.length; k++) h[k] = t.heights[k] * quantum
  const r = Math.max(1, Math.round(AO_RADIUS_M / cell / 2))
  const around = blur(blur(h, nx, nz, r), nx, nz, r)
  const out = new Float32Array(h.length)
  for (let k = 0; k < h.length; k++) out[k] = AO_MAX * Math.min(1, Math.max(0, (around[k] - h[k]) / AO_DEPTH_M))
  return out
}

// The terrain with each sample eased by `smooth` (0..1 per sample) toward
// its surroundings over SMOOTH_RADIUS_M.
function smoothed(t: Terrain, smooth: Float32Array): Terrain {
  const { nx, nz, cell } = t.header
  const h = new Float32Array(nx * nz)
  for (let k = 0; k < h.length; k++) h[k] = t.heights[k]
  const r = Math.max(1, Math.round(SMOOTH_RADIUS_M / cell / 2))
  const around = blur(blur(h, nx, nz, r), nx, nz, r)
  const out = new Int16Array(h.length)
  for (let k = 0; k < h.length; k++) out[k] = Math.round(h[k] + smooth[k] * (around[k] - h[k]))
  return new Terrain(t.header, out)
}

// How much to smooth each sample of the city's terrain: none over the bake
// area, fully past the paving's outer blend (on a coarse lattice, eased
// between).
function smoothing(city: LoadedCity): Float32Array {
  const { x0, z0, cell, nx, nz } = city.terrain.header
  const distance = bakeDistance(city)
  const ring = city.header.ringMeters
  const step = 8
  const cx = Math.ceil((nx - 1) / step) + 1
  const cz = Math.ceil((nz - 1) / step) + 1
  const coarse = new Float32Array(cx * cz)
  for (let b = 0; b < cz; b++)
    for (let a = 0; a < cx; a++) {
      const t = Math.min(1, Math.max(0, (distance(x0 + a * step * cell, z0 + b * step * cell) - ring) / EDGE_BLEND_M))
      coarse[b * cx + a] = t * t * (3 - 2 * t)
    }
  const out = new Float32Array(nx * nz)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = Math.min(cx - 2, Math.floor(i / step))
      const b = Math.min(cz - 2, Math.floor(j / step))
      const u = i / step - a
      const v = j / step - b
      const top = coarse[b * cx + a] * (1 - u) + coarse[b * cx + a + 1] * u
      const bottom = coarse[(b + 1) * cx + a] * (1 - u) + coarse[(b + 1) * cx + a + 1] * u
      out[j * nx + i] = top * (1 - v) + bottom * v
    }
  return out
}

// The ground's normal at every sample, packed for a texture (x and z
// centered on 128, y as 0..255), with 255 x (1 - occlusion) in alpha.
// `smooth`: how much to smooth each sample first (smoothed), if at all.
export function normalsAo(terrain: Terrain, smooth?: Float32Array): Uint8Array {
  const t = smooth ? smoothed(terrain, smooth) : terrain
  const { nx, nz, cell } = t.header
  const ao = occlusion(t)
  const out = new Uint8Array(nx * nz * 4)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const sx = (t.at(i + 1, j) - t.at(i - 1, j)) / (2 * cell)
      const sz = (t.at(i, j + 1) - t.at(i, j - 1)) / (2 * cell)
      const l = Math.hypot(sx, 1, sz)
      const k = j * nx + i
      out[4 * k] = Math.round((-sx / l) * 127.5 + 127.5)
      out[4 * k + 1] = Math.round((1 / l) * 255)
      out[4 * k + 2] = Math.round((-sz / l) * 127.5 + 127.5)
      out[4 * k + 3] = Math.round(255 * (1 - ao[k]))
    }
  return out
}

// The cover outlines drawn on a canvas over the terrain's grid, one
// channel per class (additive: overlapping outlines of one class stay at
// full, of different classes mix).
function coverPixels(city: LoadedCity): Uint8Array {
  const { x0, z0, cell, nx, nz } = city.terrain.header
  const canvas = document.createElement('canvas')
  canvas.width = nx
  canvas.height = nz
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) return new Uint8Array(nx * nz * 4)
  g.globalCompositeOperation = 'lighter'
  const fill = ['rgb(255,0,0)', 'rgb(0,255,0)', 'rgb(0,0,255)', 'rgb(64,0,128)']
  const { counts, classes, coords } = city.cover
  let c = 0
  counts.forEach((n, k) => {
    g.beginPath()
    for (let i = 0; i < n; i++, c += 2) {
      const px = (coords[c] * COORD_QUANTUM - x0) / cell + 0.5
      const pz = (coords[c + 1] * COORD_QUANTUM - z0) / cell + 0.5
      if (i === 0) g.moveTo(px, pz)
      else g.lineTo(px, pz)
    }
    g.closePath()
    g.fillStyle = fill[classes[k]] ?? fill[0]
    g.fill()
  })
  return new Uint8Array(g.getImageData(0, 0, nx, nz).data.buffer)
}

// Mipmapped: without, the 5 m maps alias into a shimmering crosshatch on
// ground a kilometer or more off.
function texture(data: Uint8Array, w: number, h: number): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat)
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

export interface GroundShading {
  normals: DataTexture // normalsAo
  cover: DataTexture
  // GLSL for the texture coordinate of scene (x, z), given a vec2 expression.
  uv: (xz: string) => string
}

const built = new WeakMap<LoadedCity, GroundShading>()

export function groundShading(city: LoadedCity): GroundShading {
  let s = built.get(city)
  if (!s) {
    const { x0, z0, cell, nx, nz } = city.terrain.header
    const f = (v: number) => v.toFixed(5)
    s = {
      normals: texture(normalsAo(city.terrain, smoothing(city)), nx, nz),
      cover: texture(coverPixels(city), nx, nz),
      // Sample (i, j) is texel (i, j)'s center.
      uv: (xz) => `( ( ${xz} - vec2( ${f(x0)}, ${f(z0)} ) ) / ${f(cell)} + 0.5 ) / vec2( ${f(nx)}, ${f(nz)} )`,
    }
    built.set(city, s)
  }
  return s
}

const vec3 = (c: Color) => `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`

// GLSL declarations for the fragment shader.
export const SHADING_PARS = /* glsl */ `
uniform sampler2D uGroundNormals;
uniform sampler2D uGroundCover;
uniform vec3 uLightDir;
uniform float uHillshade;
`

// GLSL, after color_fragment: hillshading and occlusion on
// `diffuseColor.rgb` at the vec2 `xz`; leaves `groundN` (the ground's
// normal) and `groundShade` (the factor applied) for the code after it,
// which shades any color it lays over the ground by the same factor.
export function shadingCode(s: GroundShading, xz: string): string {
  return `
vec4 groundTexel = texture2D( uGroundNormals, ${s.uv(xz)} );
vec3 groundN = vec3( groundTexel.x * 2.0 - 1.0, groundTexel.y, groundTexel.z * 2.0 - 1.0 );
// Lit as flat ground is, plus HILLSHADE (more on the shaded side with the
// sun low) of the slope's difference from it.
float flatLit = max( uLightDir.y, 0.15 );
float slopeLit = clamp( ( dot( groundN, uLightDir ) - uLightDir.y ) / flatLit, -1.0, 1.0 );
float lowSun = 1.0 - smoothstep( ${LOW_SUN_FROM.toFixed(3)}, ${LOW_SUN_TO.toFixed(3)}, uLightDir.y );
float hillshade = ${HILLSHADE.toFixed(3)} * ( 1.0 + ${LOW_SUN_BOOST.toFixed(3)} * lowSun * step( slopeLit, 0.0 ) );
float groundShade = ( 1.0 + uHillshade * hillshade * slopeLit ) * groundTexel.a;
diffuseColor.rgb *= groundShade;
`
}

// GLSL, after shadingCode: the cover over the paving, where `paved` (a
// vec4: the paving's color and how much of it there is here) is.
export function coverCode(s: GroundShading, xz: string, sidewalk: Color, ground: Color): string {
  return `
vec4 coverTexel = texture2D( uGroundCover, ${s.uv(xz)} );
float coverSum = coverTexel.r + coverTexel.g + coverTexel.b;
vec3 coverColor = ( coverTexel.r * ${vec3(COVER_COLORS.grass)} + coverTexel.g * ${vec3(COVER_COLORS.wood)} + coverTexel.b * ${vec3(COVER_COLORS.rock)} ) / max( coverSum, 0.001 );
// In the ring, cover fades toward bare ground as the paving does there
// (paving.ts): how far the paving has gone from sidewalk to ground.
vec3 pavingSpan = ${vec3(ground)} - ${vec3(sidewalk)};
float ringFaded = clamp( dot( paved.rgb - ${vec3(sidewalk)}, pavingSpan ) / max( dot( pavingSpan, pavingSpan ), 1e-5 ), 0.0, 1.0 );
coverColor = mix( coverColor, ${vec3(ground)}, ringFaded );
diffuseColor.rgb = mix( diffuseColor.rgb, coverColor * groundShade, min( 1.0, coverSum ) * paved.a );
`
}
