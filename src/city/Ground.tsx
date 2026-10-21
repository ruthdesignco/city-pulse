import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Color, DataTexture, DoubleSide, LinearFilter, type Mesh, type MeshStandardMaterial, RGBAFormat, Vector3 } from 'three'
import { registerHeightFog, sceneUniforms } from '../scene/sceneUniforms.ts'
import { TARGET } from '../scene/view.ts'
import { BayWater } from './BayWater.tsx'
import { palette } from './palette.ts'
import { type GroundShading, SHADING_PARS, coverCode, groundShading, shadingCode } from './groundShading.ts'
import { LOD_STEPS, buildTile, lodFor, tileRanges } from './groundTiles.ts'
import { LAND_TILE_M, createLandMaterial, createLandTexture } from './landTexture.ts'
import { CELL_M as PAVING_CELL_M, bareLand, buildPaving } from './paving.ts'
import { buildShoreFeather } from './shore.ts'
import { type Terrain, drape } from './terrain.ts'
import { type LoadedCity, useCity } from './useCity.ts'

// The ground: the terrain (terrain.ts) in tiles that draw at the detail
// their distance needs (groundTiles.ts), textured as distant city like the
// land beyond it, under a cover of paving over the bake area: everything
// between the roads and the buildings is concrete, the sidewalks' color,
// fading toward the haze in the ring and into bare ground past its edge
// (paving.ts, sampled every 20 m into a texture). Steep ground isn't paved:
// Telegraph Hill's quarried east face, the slopes under the Filbert and
// Greenwich steps turn to scrubby earth from STEEP_FROM (the slope's
// normal's y: ~20 deg) to STEEP_FULL (~35 deg). Its shading comes from the
// full 5 m grid's normals (groundNormals), whatever the tile's detail.
const STEEP_FROM = 0.94
const STEEP_FULL = 0.82
const SLOPE_EARTH = new Color('#7a7c66')

// The land plane, in meters: its edge 20 km out, past the fog's full
// distance (Atmosphere.tsx) from anywhere the orbit can take the camera.
// Flat, LAND_Y down: past the terrain's grid, which eases to sea level at
// its edges (bake-terrain.ts) and lies on top of it there.
const LAND_M = 40000
const LAND_Y = -0.6
// The ground sits this far under the true terrain height; everything placed
// on the terrain (streets 0.2 up, building bases) a little above it.
const TERRAIN_Y = -0.2

// The paving's colors as a texture over its grid, with a transparent texel
// all round, so it ends where the grid does.
interface PavingTexture {
  texture: DataTexture
  grid: [number, number, number, number] // x, z of the texture's corner; its width, depth (m)
}

function pavingTexture(city: LoadedCity): PavingTexture {
  const p = buildPaving(city, 0)
  const w = p.nx + 2
  const h = p.nz + 2
  const data = new Uint8Array(w * h * 4)
  const c = new Color()
  for (let j = 0; j < p.nz; j++)
    for (let i = 0; i < p.nx; i++) {
      const k = (j * p.nx + i) * 3
      c.setRGB(p.color[k], p.color[k + 1], p.color[k + 2]).convertLinearToSRGB()
      data.set([c.r * 255, c.g * 255, c.b * 255, 255], ((j + 1) * w + i + 1) * 4)
    }
  const texture = new DataTexture(data, w, h, RGBAFormat)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.needsUpdate = true
  // The grid's sample (i, j) is texel (i + 1, j + 1), at that texel's center.
  return { texture, grid: [p.x0 - 1.5 * PAVING_CELL_M, p.z0 - 1.5 * PAVING_CELL_M, w * PAVING_CELL_M, h * PAVING_CELL_M] }
}

const f = (v: number) => v.toFixed(5)
const vec3 = (c: Color) => `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`

function groundMaterial(land: MeshStandardMaterial, paving: PavingTexture, shading: GroundShading): MeshStandardMaterial {
  const material = land.clone()
  material.side = DoubleSide // the tiles' skirts face either way
  const [px, pz, pw, ph] = paving.grid
  material.onBeforeCompile = (shader, renderer) => {
    land.onBeforeCompile(shader, renderer)
    shader.uniforms.uGroundNormals = { value: shading.normals }
    shader.uniforms.uGroundCover = { value: shading.cover }
    shader.uniforms.uLightDir = sceneUniforms.uLightDir
    shader.uniforms.uHillshade = sceneUniforms.uHillshade
    shader.uniforms.uPaving = { value: paving.texture }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position.xz;')
    const pavingUv = `( vGround - vec2( ${f(px)}, ${f(pz)} ) ) / vec2( ${f(pw)}, ${f(ph)} )`
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uPaving;\nvarying vec2 vGround;\n${SHADING_PARS}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec4 pave = texture2D( uPaving, ${pavingUv} );
vec4 paved = vec4( pow( pave.rgb, vec3( 2.2 ) ), pave.a );
diffuseColor.rgb = mix( diffuseColor.rgb, paved.rgb, paved.a );
${shadingCode(shading, 'vGround')}
float steep = smoothstep( ${f(STEEP_FROM)}, ${f(STEEP_FULL)}, groundN.y );
diffuseColor.rgb = mix( diffuseColor.rgb, ${vec3(SLOPE_EARTH)} * groundTexel.a, steep * paved.a );
${coverCode(shading, 'vGround', new Color(palette.sidewalk), new Color(palette.ground))}`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
normal = normalize( ( viewMatrix * vec4( normalize( vec3( groundN.x, max( groundN.y, 0.05 ), groundN.z ) ), 0.0 ) ).xyz );`,
      )
  }
  material.customProgramCacheKey = () => 'city-ground-v2'
  return material
}

// The land plane's UVs for a tile's vertices (centered on TARGET, rotated
// -90 deg about x: its v runs to -z), so the two meet seamlessly.
function withLandUv(g: BufferGeometry) {
  const pos = g.getAttribute('position')
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    uv[2 * i] = (pos.getX(i) - TARGET[0] + LAND_M / 2) / LAND_M
    uv[2 * i + 1] = (-pos.getZ(i) + TARGET[2] + LAND_M / 2) / LAND_M
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2))
}

// The ground's tiles, each switching detail with the camera's distance.
function GroundTiles({ terrain, material }: { terrain: Terrain; material: MeshStandardMaterial }) {
  const tiles = useMemo(() => tileRanges(terrain), [terrain])
  const cache = useMemo(() => tiles.map(() => new Map<number, BufferGeometry>()), [tiles])
  const meshes = useRef<(Mesh | null)[]>([])
  const shown = useRef<number[]>([])
  const p = useMemo(() => new Vector3(), [])
  useEffect(
    () => () => {
      for (const c of cache) for (const g of c.values()) g.dispose()
    },
    [cache],
  )
  const geometryFor = (k: number, lod: number) => {
    let g = cache[k].get(lod)
    if (!g) {
      g = buildTile(terrain, tiles[k], LOD_STEPS[lod], TERRAIN_Y)
      withLandUv(g)
      cache[k].set(lod, g)
    }
    return g
  }
  useFrame(({ camera }) => {
    const { x0, z0, cell } = terrain.header
    tiles.forEach((r, k) => {
      const mesh = meshes.current[k]
      if (!mesh) return
      // The camera's distance to the nearest point of the tile.
      const cx = Math.min(Math.max(camera.position.x, x0 + r.i0 * cell), x0 + r.i1 * cell)
      const cz = Math.min(Math.max(camera.position.z, z0 + r.j0 * cell), z0 + r.j1 * cell)
      p.set(cx, terrain.heightAt(cx, cz), cz)
      const lod = lodFor(p.distanceTo(camera.position))
      if (shown.current[k] === lod) return
      shown.current[k] = lod
      mesh.geometry = geometryFor(k, lod)
    })
  })
  return (
    <>
      {tiles.map((_, k) => (
        <mesh
          key={k}
          ref={(el) => {
            meshes.current[k] = el
          }}
          geometry={geometryFor(k, LOD_STEPS.length - 1)}
          material={material}
          receiveShadow
          userData={{ noReflect: true }}
        />
      ))}
    </>
  )
}

// The soft shoreline over unbaked land (shore.ts): over the water, under
// the sidewalks.
const SHORE_Y = 0.17

function buildShoreGeometry(city: LoadedCity): BufferGeometry {
  const { position, color, index } = buildShoreFeather(bareLand(city), SHORE_Y)
  const normal = new Float32Array(position.length)
  drape(city.terrain, position, normal)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(position, 3))
  g.setAttribute('normal', new BufferAttribute(normal, 3))
  g.setAttribute('color', new BufferAttribute(color, 4))
  g.setIndex(new BufferAttribute(index, 1))
  g.computeBoundingSphere()
  return g
}

// The Bay (bay.ts, BayWater.tsx): real waterfront, drawn over the ground
// (the context ring reaches into the water at Mission Bay) but under the
// sidewalks and roads, so the piers' streets and the Bay Bridge approach
// stay on top.
const WATER_Y = 0.15

export function Ground() {
  const city = useCity()
  const shore = useMemo(() => buildShoreGeometry(city), [city])
  const land = useMemo(() => {
    const t = createLandTexture()
    t.repeat.set(LAND_M / LAND_TILE_M, LAND_M / LAND_TILE_M)
    return createLandMaterial(t)
  }, [])
  const paving = useMemo(() => pavingTexture(city), [city])
  const shading = useMemo(() => groundShading(city), [city])
  const ground = useMemo(() => groundMaterial(land, paving, shading), [land, paving, shading])
  useEffect(() => () => shore.dispose(), [shore])
  useEffect(() => () => paving.texture.dispose(), [paving])
  useEffect(
    () => () => {
      shading.normals.dispose()
      shading.cover.dispose()
    },
    [shading],
  )
  useEffect(() => () => ground.dispose(), [ground])
  useEffect(
    () => () => {
      land.map?.dispose()
      land.dispose()
    },
    [land],
  )

  return (
    <>
      <group rotation-x={-Math.PI / 2}>
        {/* Land beyond the baked city -- San Francisco and the peninsula
            carry on to the south and west -- textured as distant city blocks
            (landTexture.ts) that the fog (Atmosphere.tsx) fades into the
            sky's haze with distance. Centered on TARGET. */}
        <mesh position={[TARGET[0], -TARGET[2], LAND_Y]} material={land} receiveShadow userData={{ noReflect: true }}>
          <planeGeometry args={[LAND_M, LAND_M]} />
        </mesh>
        <BayWater y={WATER_Y} />
      </group>
      <GroundTiles terrain={city.terrain} material={ground} />
      <mesh geometry={shore} receiveShadow userData={{ noReflect: true }}>
        <meshStandardMaterial onBeforeCompile={registerHeightFog} vertexColors transparent depthWrite={false} side={DoubleSide} roughness={0.95} polygonOffset polygonOffsetFactor={-0.9} polygonOffsetUnits={-3.5} />
      </mesh>
    </>
  )
}
