import { BackSide, BufferAttribute, type BufferGeometry, Color, DataTexture, DoubleSide, LinearFilter, type MeshStandardMaterial, NearestFilter, RGBAFormat, RedFormat, Vector4 } from 'three'
import { sceneUniforms } from '../scene/sceneUniforms.ts'
import { TARGET } from '../scene/view.ts'
import { palette } from './palette.ts'
import { SHADING_PARS, type ShadingUniforms, coverCode, shadingCode } from './groundShading.ts'
import { LAND_TILE_M, createLandMaterial, createLandTexture } from './landTexture.ts'
import type { LandCover } from './landCover.ts'
import { landPars, landUniforms } from './landShading.ts'
import { CELL_M as PAVING_CELL_M, PAVING_SAMPLES } from './paving.ts'
import { TERRAIN_Y } from './stream/tileBuild.ts'

// The ground: each tile's terrain (terrain.ts), drawn at the detail its
// distance needs (groundTiles.ts, stream/TileStream.ts), textured as distant city
// like the land beyond it, under a cover of paving: everything between the
// roads and the buildings is concrete, the sidewalks' color, fading toward
// the haze in the ring and gone off the city's land (paving.ts, a texture
// per tile). Steep ground isn't paved: Telegraph Hill's quarried east face,
// the slopes under the Filbert and Greenwich steps turn to scrubby earth
// from STEEP_FROM (the slope's normal's y: ~20 deg) to STEEP_FULL (~35
// deg). Its shading comes from the tile's full 5 m normals
// (groundShading.ts), whatever the mesh's detail. Around and under it all:
// the backdrop's landforms, the Bay and the land plane (Ground.tsx).
const STEEP_FROM = 0.94
const STEEP_FULL = 0.82
const SLOPE_EARTH = new Color('#7a7c66')

// The land plane, in meters: its edge 100 km out, past the fog's full
// distance (Atmosphere.tsx) and the camera's far plane (App.tsx), so no
// edge ever shows; west of the backdrop the Pacific covers it (Ground.tsx).
// Flat, LAND_Y down: past the terrain's grid, which eases to sea level at
// its edges (bake-terrain.ts) and lies on top of it there.
export const LAND_M = 200000
// The flat land plane itself, under the backdrop where they meet at its
// tapered edge (and under the water inside the backdrop's box).
export const LAND_PLANE_Y = -2

// A tile's paving (paving.ts) as a texture, sample (i, j) at texel (i, j)'s
// center, and its uv (as groundShading.ts gridUv) for the shader.
export interface PavingTexture {
  texture: DataTexture
  uv: Vector4
}

export function pavingTexture(pixels: Uint8Array, x0: number, z0: number): PavingTexture {
  const n = PAVING_SAMPLES
  const texture = new DataTexture(pixels, n, n, RGBAFormat)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.needsUpdate = true
  return { texture, uv: new Vector4(1 / (PAVING_CELL_M * n), 1 / (PAVING_CELL_M * n), (0.5 - x0 / PAVING_CELL_M) / n, (0.5 - z0 / PAVING_CELL_M) / n) }
}

export const f = (v: number) => v.toFixed(5)
const vec3 = (c: Color) => `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`

// A tile's ground: the land's material (one for the whole scene, landMaterial)
// with the tile's paving and maps.
export function tileGroundMaterial(landCover: LandCover, land: MeshStandardMaterial, paving: PavingTexture, shading: ShadingUniforms): MeshStandardMaterial {
  const material = land.clone()
  material.side = DoubleSide // the tiles' skirts face either way
  // Only faces turned from the sun go into the shadow map: the ground can't
  // shadow itself where lit (a fine crosshatch of acne over bare land), and
  // the far side of a hill still casts its shadow down the slope beyond.
  material.shadowSide = BackSide
  material.onBeforeCompile = (shader, renderer) => {
    land.onBeforeCompile(shader, renderer)
    Object.assign(shader.uniforms, shading)
    shader.uniforms.uLightDir = sceneUniforms.uLightDir
    shader.uniforms.uHillshade = sceneUniforms.uHillshade
    shader.uniforms.uPaving = { value: paving.texture }
    shader.uniforms.uPavingUv = { value: paving.uv }
    Object.assign(shader.uniforms, landUniforms(landCover))
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGround;\nvarying float vGroundY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position.xz;\nvGroundY = position.y;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uPaving;\nuniform vec4 uPavingUv;\nvarying vec2 vGround;\nvarying float vGroundY;\n${SHADING_PARS}\n${landPars(landCover)}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec4 pave = texture2D( uPaving, vGround * uPavingUv.xy + uPavingUv.zw );
vec4 paved = vec4( pow( pave.rgb, vec3( 2.2 ) ), pave.a );
vec4 landTexel = texture2D( uGroundNormals, vGround * uGroundUv.xy + uGroundUv.zw );
vec3 landN = vec3( landTexel.x * 2.0 - 1.0, landTexel.y, landTexel.z * 2.0 - 1.0 );
diffuseColor.rgb = landColor( vGround, vGroundY - ${f(TERRAIN_Y)}, landN, length( vViewPosition ) );
diffuseColor.rgb = mix( diffuseColor.rgb, paved.rgb, paved.a );
${shadingCode('vGround')}
float steep = smoothstep( ${f(STEEP_FROM)}, ${f(STEEP_FULL)}, groundN.y );
diffuseColor.rgb = mix( diffuseColor.rgb, ${vec3(SLOPE_EARTH)} * groundShade, steep * paved.a );
${coverCode('vGround', new Color(palette.sidewalk), new Color(palette.ground))}`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
normal = normalize( ( viewMatrix * vec4( normalize( vec3( groundN.x, max( groundN.y, 0.05 ), groundN.z ) ), 0.0 ) ).xyz );`,
      )
  }
  material.customProgramCacheKey = () => 'city-ground-v5'
  return material
}

// The land plane's UVs for a tile's vertices (centered on TARGET, rotated
// -90 deg about x: its v runs to -z), so the two meet seamlessly.
export function withLandUv(g: BufferGeometry) {
  const pos = g.getAttribute('position')
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    uv[2 * i] = (pos.getX(i) - TARGET[0] + LAND_M / 2) / LAND_M
    uv[2 * i + 1] = (-pos.getZ(i) + TARGET[2] + LAND_M / 2) / LAND_M
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2))
}

// Which tiles' own ground is drawn: a texel per tile over the index's
// tiles and a clear one round them, set by stream/TileStream.ts as tiles come and go.
export class GroundMask {
  readonly texture: DataTexture
  readonly uv: Vector4 // tile (i, j)'s texel from scene (x, z): xz * uv.xy + uv.zw
  private readonly data: Uint8Array
  private readonly i0: number
  private readonly j0: number
  private readonly w: number

  constructor(tiles: { i: number; j: number }[], tileM: number) {
    this.i0 = Math.min(...tiles.map((t) => t.i)) - 1
    this.j0 = Math.min(...tiles.map((t) => t.j)) - 1
    this.w = Math.max(...tiles.map((t) => t.i)) - this.i0 + 2
    const h = Math.max(...tiles.map((t) => t.j)) - this.j0 + 2
    this.data = new Uint8Array(this.w * h)
    this.texture = new DataTexture(this.data, this.w, h, RedFormat)
    this.texture.unpackAlignment = 1
    this.texture.magFilter = NearestFilter
    this.texture.minFilter = NearestFilter
    this.texture.needsUpdate = true
    this.uv = new Vector4(1 / (tileM * this.w), 1 / (tileM * h), -this.i0 / this.w, -this.j0 / h)
  }

  set(i: number, j: number, drawn: boolean) {
    this.setShare(i, j, drawn ? 1 : 0)
  }

  // A share of the way, 0..1 (TileStream.ts's near trees as they fade).
  setShare(i: number, j: number, share: number) {
    const k = (j - this.j0) * this.w + (i - this.i0)
    const v = Math.round(255 * Math.min(1, Math.max(0, share)))
    if (this.data[k] === v) return
    this.data[k] = v
    this.texture.needsUpdate = true
  }
}

// The land's material, for the land plane and, cloned, every tile's ground
// and the backdrop (tileGroundMaterial, backdropMaterial): one texture.
let landShared: MeshStandardMaterial | null = null
export function landMaterial(): MeshStandardMaterial {
  if (!landShared) {
    const t = createLandTexture()
    t.repeat.set(LAND_M / LAND_TILE_M, LAND_M / LAND_TILE_M)
    landShared = createLandMaterial(t)
  }
  return landShared
}
