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
//   (the tiles' cover), drawn into a 5 m map, shown instead of paving.
//   Contact: the ground darkens along the foot of every building, most in
//   alleys and light wells with walls close on both sides: the footprints
//   drawn into a CONTACT_CELL_M map (by height: a low shed shades less)
//   and blurred over about CONTACT_REACH_M. Baked in place of SSAO, which
//   cost too much at Retina size (quality.ts) and is now ?quality=high's.
//
// Every map is a tile's own (stream/tileBuild.ts, built off the main
// thread), placed by uniforms (uGroundUv, uContactUv), so one shader serves
// every tile. The first two are on the tile's 5 m terrain grid: the normals
// with the occlusion in alpha (normalsAo), and the cover's classes in red
// (grass), green (wood) and blue (rock; sand is half of it). Off the
// city's land (Daly City's edge, Alcatraz) the normals and occlusion come
// from ground smoothed over SMOOTH_RADIUS_M: there the 1 m lidar's piers,
// pads and rubble only mottled the land, which reads as distant city
// (landShading.ts).

import { Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RedFormat, type Vector4 } from 'three'
import { type CityParts, HEIGHT_QUANTUM } from './format.ts'
import { Terrain } from './terrain.ts'

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

export const CONTACT_CELL_M = 2
export const CONTACT_REACH_M = 8 // the darkening fades out about this far from a wall
export const CONTACT_MAX = 0.32 // the most it darkens, in a narrow alley
const CONTACT_FULL_HEIGHT_M = 10 // buildings this tall or more shade fully
// How fast the darkening saturates with the blurred footprint cover (0.5
// right at a lone wall, more between walls).
const CONTACT_GAIN = 3

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

// Where a tile's maps lie: sample (i, j) at (x0 + i * cell, z0 + j * cell),
// at texel (i, j)'s center.
export interface Grid {
  x0: number
  z0: number
  cell: number
  nx: number
  nz: number
}

// The uv of scene (x, z) on a grid's texture, as uv = xz * (a.x, a.y) +
// (a.z, a.w): the shaders' uGroundUv and uContactUv, set per tile.
export function gridUv(g: Grid): [number, number, number, number] {
  return [1 / (g.cell * g.nx), 1 / (g.cell * g.nz), (0.5 - g.x0 / g.cell) / g.nx, (0.5 - g.z0 / g.cell) / g.nz]
}

// A 2D canvas in a worker or the page; null where there's none (tests).
function canvas2d(w: number, h: number): OffscreenCanvasRenderingContext2D | null {
  if (typeof OffscreenCanvas === 'undefined') return null
  return new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })
}

// Rings (x, z interleaved, `counts` points each) traced onto a canvas over
// `grid` (cells `cell` m, sample centers at (i + 0.5)).
function trace(g: OffscreenCanvasRenderingContext2D, grid: Grid, counts: Uint16Array, coords: Float32Array, k: number, c: number): number {
  const n = counts[k]
  g.beginPath()
  for (let i = 0; i < n; i++, c += 2) {
    const px = (coords[c] - grid.x0) / grid.cell + 0.5
    const pz = (coords[c + 1] - grid.z0) / grid.cell + 0.5
    if (i === 0) g.moveTo(px, pz)
    else g.lineTo(px, pz)
  }
  g.closePath()
  return c
}

// The cover outlines (a tile's and its neighbors', which meet it at its
// edges) drawn over the grid, one channel per class (additive: overlapping
// outlines of one class stay at full, of different classes mix).
export function coverPixels(covers: CityParts['cover'][], grid: Grid): Uint8Array {
  const { nx, nz } = grid
  const g = canvas2d(nx, nz)
  if (!g) return new Uint8Array(nx * nz * 4)
  g.globalCompositeOperation = 'lighter'
  // By CoverClass: the wooded parks' land and fields show as grass (their
  // trees stand on it); their water and clearings not at all.
  const fill = ['rgb(255,0,0)', 'rgb(0,255,0)', 'rgb(0,0,255)', 'rgb(64,0,128)', 'rgb(255,0,0)', null, 'rgb(255,0,0)', null]
  for (const { counts, classes, coords } of covers) {
    let c = 0
    for (let k = 0; k < counts.length; k++) {
      c = trace(g, grid, counts, coords, k, c)
      const style = classes[k] < fill.length ? fill[classes[k]] : fill[0]
      if (!style) continue
      g.fillStyle = style
      g.fill()
    }
  }
  return new Uint8Array(g.getImageData(0, 0, nx, nz).data.buffer)
}

// The contact map's grid for a tile: over the tile and its own buildings
// (some reach past its edge), CONTACT_CELL_M cells, with room for the
// darkening's reach all round.
export function contactGrid(rect: [number, number, number, number], b: CityParts['buildings']): Grid {
  let [minX, minZ, maxX, maxZ] = rect
  for (let c = 0; c < b.coords.length; c += 2) {
    minX = Math.min(minX, b.coords[c])
    maxX = Math.max(maxX, b.coords[c])
    minZ = Math.min(minZ, b.coords[c + 1])
    maxZ = Math.max(maxZ, b.coords[c + 1])
  }
  const pad = CONTACT_REACH_M + CONTACT_CELL_M
  const x0 = Math.floor((minX - pad) / CONTACT_CELL_M) * CONTACT_CELL_M
  const z0 = Math.floor((minZ - pad) / CONTACT_CELL_M) * CONTACT_CELL_M
  return { x0, z0, cell: CONTACT_CELL_M, nx: Math.ceil((maxX + pad - x0) / CONTACT_CELL_M) + 1, nz: Math.ceil((maxZ + pad - z0) / CONTACT_CELL_M) + 1 }
}

// Buildings' footprints (a tile's and its neighbors') over a contact grid,
// as how much each texel is darkened, 0..CONTACT_MAX (contact()), packed
// 0..255.
export function contactPixels(buildings: CityParts['buildings'][], grid: Grid): Uint8Array {
  const { nx, nz } = grid
  const g = canvas2d(nx, nz)
  if (!g) return new Uint8Array(nx * nz)
  for (const { counts, heights, coords } of buildings) {
    let c = 0
    for (let k = 0; k < counts.length; k++) {
      const v = Math.round(255 * Math.min(1, (heights[k] * HEIGHT_QUANTUM) / CONTACT_FULL_HEIGHT_M))
      c = trace(g, grid, counts, coords, k, c)
      g.fillStyle = `rgb(${v},${v},${v})`
      g.fill()
    }
  }
  const rgba = g.getImageData(0, 0, nx, nz).data
  const cover = new Float32Array(nx * nz)
  for (let k = 0; k < cover.length; k++) cover[k] = rgba[4 * k] / 255
  return contact(cover, nx, nz)
}

// From footprint cover (0..1 per texel) to darkening: twice box-blurred
// over half of CONTACT_REACH_M each way, saturating (CONTACT_GAIN).
export function contact(cover: Float32Array, nx: number, nz: number): Uint8Array {
  const r = Math.max(1, Math.round(CONTACT_REACH_M / CONTACT_CELL_M / 4))
  const around = blur(blur(cover, nx, nz, r), nx, nz, r)
  const out = new Uint8Array(nx * nz)
  for (let k = 0; k < out.length; k++) out[k] = Math.round(255 * CONTACT_MAX * (1 - Math.exp(-CONTACT_GAIN * around[k])))
  return out
}

// Mipmapped: without, the 5 m maps alias into a shimmering crosshatch on
// ground a kilometer or more off.
export function shadingTexture(data: Uint8Array, w: number, h: number, format: typeof RGBAFormat | typeof RedFormat = RGBAFormat): DataTexture {
  const t = new DataTexture(data, w, h, format)
  t.unpackAlignment = 1
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

// A tile's maps, as the ground, its streets and buildings sample them.
export interface GroundShading {
  normals: DataTexture // normalsAo
  cover: DataTexture
  contact: DataTexture // contactPixels, in red; one clear texel for tiles without
  groundUv: Vector4 // gridUv of the normals' and cover's grid
  contactUv: Vector4
}

// No contact shading: tiles drawn at middle distance.
export const NO_CONTACT = shadingTexture(new Uint8Array(1), 1, 1, RedFormat)

const vec3 = (c: Color) => `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`

// GLSL declarations for the fragment shader.
export const SHADING_PARS = /* glsl */ `
uniform sampler2D uGroundNormals;
uniform sampler2D uGroundCover;
uniform sampler2D uContactAo;
uniform vec4 uGroundUv;
uniform vec4 uContactUv;
uniform vec3 uLightDir;
uniform float uHillshade;
`

// The uniforms SHADING_PARS declares, for a tile's maps (the light's are
// the scene's: sceneUniforms.ts). Made once per tile and shared by its
// materials, so a map swapped in later (its contact shading, up close)
// reaches them all.
export type ShadingUniforms = ReturnType<typeof shadingUniforms>
export function shadingUniforms(s: GroundShading) {
  return {
    uGroundNormals: { value: s.normals },
    uGroundCover: { value: s.cover },
    uContactAo: { value: s.contact },
    uGroundUv: { value: s.groundUv },
    uContactUv: { value: s.contactUv },
  }
}

// GLSL, after color_fragment: hillshading and occlusion on
// `diffuseColor.rgb` at the vec2 `xz`; leaves `groundN` (the ground's
// normal) and `groundShade` (the factor applied) for the code after it,
// which shades any color it lays over the ground by the same factor.
export function shadingCode(xz: string): string {
  return `
vec4 groundTexel = texture2D( uGroundNormals, ${xz} * uGroundUv.xy + uGroundUv.zw );
vec3 groundN = vec3( groundTexel.x * 2.0 - 1.0, groundTexel.y, groundTexel.z * 2.0 - 1.0 );
// Lit as flat ground is, plus HILLSHADE (more on the shaded side with the
// sun low) of the slope's difference from it.
float flatLit = max( uLightDir.y, 0.15 );
float slopeLit = clamp( ( dot( groundN, uLightDir ) - uLightDir.y ) / flatLit, -1.0, 1.0 );
float lowSun = 1.0 - smoothstep( ${LOW_SUN_FROM.toFixed(3)}, ${LOW_SUN_TO.toFixed(3)}, uLightDir.y );
float hillshade = ${HILLSHADE.toFixed(3)} * ( 1.0 + ${LOW_SUN_BOOST.toFixed(3)} * lowSun * step( slopeLit, 0.0 ) );
float groundShade = ( 1.0 + uHillshade * hillshade * slopeLit ) * groundTexel.a * ( 1.0 - texture2D( uContactAo, ${xz} * uContactUv.xy + uContactUv.zw ).r );
diffuseColor.rgb *= groundShade;
`
}

// GLSL, after shadingCode: the cover over the paving, where `paved` (a
// vec4: the paving's color and how much of it there is here) is.
export function coverCode(xz: string, sidewalk: Color, ground: Color): string {
  return `
vec4 coverTexel = texture2D( uGroundCover, ${xz} * uGroundUv.xy + uGroundUv.zw );
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
