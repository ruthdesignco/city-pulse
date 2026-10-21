import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BackSide, BufferAttribute, BufferGeometry, Color, DataTexture, DoubleSide, LinearFilter, type Mesh, type MeshStandardMaterial, RGBAFormat, ShapeUtils, Vector2, Vector3 } from 'three'
import { registerHeightFog, sceneUniforms } from '../scene/sceneUniforms.ts'
import { TARGET } from '../scene/view.ts'
import { BayWater } from './BayWater.tsx'
import { palette } from './palette.ts'
import { type GroundShading, SHADING_PARS, coverCode, groundShading, shadingCode } from './groundShading.ts'
import { LOD_STEPS, buildTile, lodFor, tileRanges } from './groundTiles.ts'
import { LAND_TILE_M, createLandMaterial, createLandTexture } from './landTexture.ts'
import { ModelBuilder, type V3 } from './landmarks/build.ts'
import { landPars, landUniforms } from './landShading.ts'
import { CELL_M as PAVING_CELL_M, EDGE_BLEND_M, bakeDistance, buildPaving } from './paving.ts'
import type { Terrain } from './terrain.ts'
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
// The flat land plane itself, under the backdrop where they meet at its
// tapered edge (and under the water inside the backdrop's box).
const LAND_PLANE_Y = -2
// The ground sits this far under the true terrain height; everything placed
// on the terrain (streets 0.2 up, building bases) a little above it.
const TERRAIN_Y = -0.2

// The paving's colors as a texture over its grid, with a transparent texel
// all round, so it ends where the grid does; its alpha falls off with the
// paving's own fade past the ring's edge (paving.ts), so the land beyond
// (landShading.ts) shows through where the paving has gone to bare ground.
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
  const distance = bakeDistance(city)
  const ring = city.header.ringMeters
  for (let j = 0; j < p.nz; j++)
    for (let i = 0; i < p.nx; i++) {
      const k = (j * p.nx + i) * 3
      c.setRGB(p.color[k], p.color[k + 1], p.color[k + 2]).convertLinearToSRGB()
      const t = Math.min(1, Math.max(0, (distance(p.x0 + i * PAVING_CELL_M, p.z0 + j * PAVING_CELL_M) - ring) / EDGE_BLEND_M))
      data.set([c.r * 255, c.g * 255, c.b * 255, 255 * (1 - t * t * (3 - 2 * t))], ((j + 1) * w + i + 1) * 4)
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

function groundMaterial(city: LoadedCity, land: MeshStandardMaterial, paving: PavingTexture, shading: GroundShading): MeshStandardMaterial {
  const material = land.clone()
  material.side = DoubleSide // the tiles' skirts face either way
  // Only faces turned from the sun go into the shadow map: the ground can't
  // shadow itself where lit (a fine crosshatch of acne over bare land), and
  // the far side of a hill still casts its shadow down the slope beyond.
  material.shadowSide = BackSide
  const [px, pz, pw, ph] = paving.grid
  material.onBeforeCompile = (shader, renderer) => {
    land.onBeforeCompile(shader, renderer)
    shader.uniforms.uGroundNormals = { value: shading.normals }
    shader.uniforms.uGroundCover = { value: shading.cover }
    shader.uniforms.uLightDir = sceneUniforms.uLightDir
    shader.uniforms.uHillshade = sceneUniforms.uHillshade
    shader.uniforms.uPaving = { value: paving.texture }
    Object.assign(shader.uniforms, landUniforms(city))
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGround;\nvarying float vGroundY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position.xz;\nvGroundY = position.y;')
    const pavingUv = `( vGround - vec2( ${f(px)}, ${f(pz)} ) ) / vec2( ${f(pw)}, ${f(ph)} )`
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uPaving;\nvarying vec2 vGround;\nvarying float vGroundY;\n${SHADING_PARS}\n${landPars(city)}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec4 pave = texture2D( uPaving, ${pavingUv} );
vec4 paved = vec4( pow( pave.rgb, vec3( 2.2 ) ), pave.a );
vec4 landTexel = texture2D( uGroundNormals, ${shading.uv('vGround')} );
vec3 landN = vec3( landTexel.x * 2.0 - 1.0, landTexel.y, landTexel.z * 2.0 - 1.0 );
diffuseColor.rgb = landColor( vGround, vGroundY - ${f(TERRAIN_Y)}, landN, length( vViewPosition ) );
diffuseColor.rgb = mix( diffuseColor.rgb, paved.rgb, paved.a );
${shadingCode(shading, 'vGround')}
float steep = smoothstep( ${f(STEEP_FROM)}, ${f(STEEP_FULL)}, groundN.y );
diffuseColor.rgb = mix( diffuseColor.rgb, ${vec3(SLOPE_EARTH)} * groundShade, steep * paved.a );
${coverCode(shading, 'vGround', new Color(palette.sidewalk), new Color(palette.ground))}`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
normal = normalize( ( viewMatrix * vec4( normalize( vec3( groundN.x, max( groundN.y, 0.05 ), groundN.z ) ), 0.0 ) ).xyz );`,
      )
  }
  material.customProgramCacheKey = () => 'city-ground-v3'
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
          castShadow
          receiveShadow
          userData={{ noReflect: true }}
        />
      ))}
    </>
  )
}

// The landforms around the city (bake-backdrop.ts; 50 m): the Marin
// Headlands, Angel Island, Alcatraz, Yerba Buena Island, Twin Peaks, the
// East Bay hills, and the cities around the Bay. Colored by what's there
// (landShading.ts), fading into the haze with the fog. Under the city's own
// terrain the backdrop sinks out of sight (BACKDROP_UNDER_M), except along
// a cell's width at the terrain's edge, so the two meet (the tiles' skirts
// hide the step); over its outer BACKDROP_TAPER_M it eases to sea level,
// meeting the flat land beyond.
const BACKDROP_UNDER_M = 60
const BACKDROP_TAPER_M = 2000

function buildBackdropGeometry(city: LoadedCity): BufferGeometry {
  const b = city.backdrop
  const { x0, z0, cell, nx, nz } = b.header
  const t = city.terrain.header
  // Inside the city's terrain by at least a backdrop cell: hidden.
  const tx0 = t.x0 + cell
  const tz0 = t.z0 + cell
  const tx1 = t.x0 + (t.nx - 1) * t.cell - cell
  const tz1 = t.z0 + (t.nz - 1) * t.cell - cell
  const position = new Float32Array(nx * nz * 3)
  const normal = new Float32Array(nx * nz * 3)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const x = x0 + i * cell
      const z = z0 + j * cell
      const edge = Math.min(i, j, nx - 1 - i, nz - 1 - j) * cell
      const taper = Math.min(1, edge / BACKDROP_TAPER_M)
      let h = b.at(i, j) * taper * taper * (3 - 2 * taper)
      if (x > tx0 && x < tx1 && z > tz0 && z < tz1) h -= BACKDROP_UNDER_M
      position.set([x, h + LAND_Y, z], 3 * k)
      const sx = (b.at(i + 1, j) - b.at(i - 1, j)) / (2 * cell)
      const sz = (b.at(i, j + 1) - b.at(i, j - 1)) / (2 * cell)
      const l = Math.hypot(sx, 1, sz)
      normal.set([-sx / l, 1 / l, -sz / l], 3 * k)
    }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6)
  let n = 0
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      index.set([a, a + nx + 1, a + 1, a, a + nx, a + nx + 1], n)
      n += 6
    }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(position, 3))
  g.setAttribute('normal', new BufferAttribute(normal, 3))
  g.setIndex(new BufferAttribute(index, 1))
  withLandUv(g)
  g.computeBoundingSphere()
  return g
}

// The backdrop's material: the land's, colored by landColor from the
// backdrop's own (50 m) normals.
function backdropMaterial(city: LoadedCity, land: MeshStandardMaterial): MeshStandardMaterial {
  const material = land.clone()
  material.roughness = 1
  material.onBeforeCompile = (shader, renderer) => {
    land.onBeforeCompile(shader, renderer)
    Object.assign(shader.uniforms, landUniforms(city))
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLand;\nvarying vec3 vLandN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLand = vec3( position.xz, position.y - ${f(LAND_Y)} );\nvLandN = normal;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLand;\nvarying vec3 vLandN;\n${landPars(city)}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = landColor( vLand.xy, vLand.z, normalize( vLandN ), length( vViewPosition ) );')
  }
  material.customProgramCacheKey = () => 'backdrop-v1'
  return material
}

// Buildings on the backdrop's islands (landCover.ts: Alcatraz's), as plain
// prisms in weathered concrete: walls from just under the lowest ground
// under each, roof its height above the ground's average there.
const ISLAND_WALL = '#b3ac9d'
const ISLAND_ROOF = '#958f84'

function buildIslandBuildings(city: LoadedCity): BufferGeometry {
  const m = new ModelBuilder()
  for (const { ring, height } of city.landCover.header.buildings) {
    const ground = ring.map(([x, z]) => city.backdrop.heightAt(x, z) + LAND_Y)
    const base = Math.min(...ground) - 1
    const top = ground.reduce((a, b) => a + b, 0) / ground.length + height
    m.loft(
      ring.map(([x, z]): V3 => [x, base, z]),
      ring.map(([x, z]): V3 => [x, top, z]),
      ISLAND_WALL,
    )
    // The roof, triangulated (footprints can be concave), facing up.
    for (const [a, b, c] of ShapeUtils.triangulateShape(
      ring.map(([x, z]) => new Vector2(x, z)),
      [],
    )) {
      const tri: V3[] = [a, b, c].map((v): V3 => [ring[v][0], top, ring[v][1]])
      const up = (tri[1][2] - tri[0][2]) * (tri[2][0] - tri[0][0]) - (tri[1][0] - tri[0][0]) * (tri[2][2] - tri[0][2])
      m.face(up > 0 ? tri : [tri[0], tri[2], tri[1]], ISLAND_ROOF)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(Float32Array.from(m.position), 3))
  g.setAttribute('normal', new BufferAttribute(Float32Array.from(m.normal), 3))
  g.setAttribute('color', new BufferAttribute(Float32Array.from(m.color), 3))
  g.computeBoundingSphere()
  return g
}

// The water's outline: the backdrop's box (BayWater.tsx).
function waterOutline(b: Terrain): [number, number][] {
  const { x0, z0, cell, nx, nz } = b.header
  const x1 = x0 + (nx - 1) * cell
  const z1 = z0 + (nz - 1) * cell
  return [
    [x0, z0],
    [x0, z1],
    [x1, z1],
    [x1, z0],
  ]
}

// The Bay (bay.ts, BayWater.tsx): real waterfront, drawn over the ground
// (the context ring reaches into the water at Mission Bay) but under the
// sidewalks and roads, so the piers' streets and the Bay Bridge approach
// stay on top.
const WATER_Y = 0.15

export function Ground() {
  const city = useCity()
  const backdrop = useMemo(() => buildBackdropGeometry(city), [city])
  const water = useMemo(() => waterOutline(city.backdrop), [city])
  const land = useMemo(() => {
    const t = createLandTexture()
    t.repeat.set(LAND_M / LAND_TILE_M, LAND_M / LAND_TILE_M)
    return createLandMaterial(t)
  }, [])
  const paving = useMemo(() => pavingTexture(city), [city])
  const shading = useMemo(() => groundShading(city), [city])
  const ground = useMemo(() => groundMaterial(city, land, paving, shading), [city, land, paving, shading])
  const backdropLand = useMemo(() => backdropMaterial(city, land), [city, land])
  const alcatraz = useMemo(() => buildIslandBuildings(city), [city])
  useEffect(() => () => backdrop.dispose(), [backdrop])
  useEffect(() => () => backdropLand.dispose(), [backdropLand])
  useEffect(() => () => alcatraz.dispose(), [alcatraz])
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
        <mesh position={[TARGET[0], -TARGET[2], LAND_PLANE_Y]} material={land} receiveShadow userData={{ noReflect: true }}>
          <planeGeometry args={[LAND_M, LAND_M]} />
        </mesh>
        <BayWater y={WATER_Y} outline={water} />
      </group>
      <GroundTiles terrain={city.terrain} material={ground} />
      <mesh geometry={backdrop} material={backdropLand} receiveShadow userData={{ noReflect: true }} />
      <mesh geometry={alcatraz} castShadow receiveShadow userData={{ noReflect: true }}>
        <meshStandardMaterial onBeforeCompile={registerHeightFog} vertexColors roughness={0.9} />
      </mesh>
    </>
  )
}
