import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Color, DoubleSide } from 'three'
import { registerHeightFog } from '../scene/sceneUniforms.ts'
import { TARGET } from '../scene/view.ts'
import { BayWater } from './BayWater.tsx'
import { LAND_TILE_M, createLandMaterial, createLandTexture } from './landTexture.ts'
import { bareLand, buildPaving } from './paving.ts'
import { buildShoreFeather } from './shore.ts'
import { type Terrain, drape, groundNormal } from './terrain.ts'
import { type LoadedCity, useCity } from './useCity.ts'

// Concrete paving over the whole bake area (paving.ts), between the ground
// (the terrain mesh, TERRAIN_Y) and the sidewalks (Streets.tsx, 0.2), all on
// the terrain (terrain.ts), polygon-offset just under the sidewalks so it
// never z-fights them from far away.
const PAVING_Y = 0.1
// Steep ground isn't paved: Telegraph Hill's quarried east face, the
// slopes under the Filbert and Greenwich steps. Paving turns to scrubby
// earth from STEEP_FROM (the slope's normal's y: ~20 deg) to STEEP_FULL
// (~35 deg).
const STEEP_FROM = 0.94
const STEEP_FULL = 0.82
const SLOPE_EARTH = new Color('#7a7c66')

function buildPavingGeometry(city: LoadedCity): BufferGeometry {
  const { position, color, index } = buildPaving(city, PAVING_Y)
  const normal = new Float32Array(position.length)
  drape(city.terrain, position, normal)
  const c = new Color()
  for (let i = 0; i < normal.length; i += 3) {
    const t = Math.min(1, Math.max(0, (STEEP_FROM - normal[i + 1]) / (STEEP_FROM - STEEP_FULL)))
    if (t > 0) c.fromArray(color, i).lerp(SLOPE_EARTH, t * t * (3 - 2 * t)).toArray(color, i)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(position, 3))
  g.setAttribute('normal', new BufferAttribute(normal, 3))
  g.setAttribute('color', new BufferAttribute(color, 3))
  g.setIndex(new BufferAttribute(index, 1))
  g.computeBoundingSphere()
  return g
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

// The land plane, in meters: its edge 20 km out, past the fog's full
// distance (Atmosphere.tsx) from anywhere the orbit can take the camera.
// Flat, LAND_Y down: past the terrain's grid, which eases to sea level at
// its edges (bake-terrain.ts) and lies on top of it there.
const LAND_M = 40000
const LAND_Y = -0.6
const TERRAIN_Y = -0.2

// The ground over the terrain's grid (terrain.ts): one vertex per sample,
// each cell split along the same diagonal heightAt uses, textured like the
// land plane and lined up with it (its UVs are the plane's).
function buildTerrainGeometry(t: Terrain): BufferGeometry {
  const { x0, z0, cell, nx, nz } = t.header
  const position = new Float32Array(nx * nz * 3)
  const normal = new Float32Array(nx * nz * 3)
  const uv = new Float32Array(nx * nz * 2)
  const n: [number, number, number] = [0, 1, 0]
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const x = x0 + i * cell
      const z = z0 + j * cell
      position.set([x, t.at(i, j) + TERRAIN_Y, z], 3 * k)
      normal.set(groundNormal(t, x, z, n), 3 * k)
      // The land plane is centered on TARGET, rotated -90 deg about x: its v runs to -z.
      uv[2 * k] = (x - TARGET[0] + LAND_M / 2) / LAND_M
      uv[2 * k + 1] = (-z + TARGET[2] + LAND_M / 2) / LAND_M
    }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6)
  let c = 0
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      index.set([a, a + nx + 1, a + 1, a, a + nx, a + nx + 1], c)
      c += 6
    }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(position, 3))
  g.setAttribute('normal', new BufferAttribute(normal, 3))
  g.setAttribute('uv', new BufferAttribute(uv, 2))
  g.setIndex(new BufferAttribute(index, 1))
  g.computeBoundingSphere()
  return g
}

// Shapes are built in (x, -z) and rotated -90° about X, which maps shape
// (u, v) to scene (u, 0, -v); so v = -z lands the outline at scene z.

// The Bay (bay.ts, BayWater.tsx): real waterfront, drawn over the ground and
// the paving (the context ring reaches into the water at Mission Bay) but
// under the sidewalks and roads, so the piers' streets and the Bay Bridge
// approach stay on top.
const WATER_Y = 0.15

export function Ground() {
  const city = useCity()
  const paving = useMemo(() => buildPavingGeometry(city), [city])
  const shore = useMemo(() => buildShoreGeometry(city), [city])
  const terrain = useMemo(() => buildTerrainGeometry(city.terrain), [city])
  const land = useMemo(() => {
    const t = createLandTexture()
    t.repeat.set(LAND_M / LAND_TILE_M, LAND_M / LAND_TILE_M)
    return createLandMaterial(t)
  }, [])
  useEffect(() => () => paving.dispose(), [paving])
  useEffect(() => () => shore.dispose(), [shore])
  useEffect(() => () => terrain.dispose(), [terrain])
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
      <mesh geometry={terrain} material={land} receiveShadow userData={{ noReflect: true }} />
      <mesh geometry={shore} receiveShadow userData={{ noReflect: true }}>
        <meshStandardMaterial onBeforeCompile={registerHeightFog} vertexColors transparent depthWrite={false} side={DoubleSide} roughness={0.95} polygonOffset polygonOffsetFactor={-0.9} polygonOffsetUnits={-3.5} />
      </mesh>
      <mesh geometry={paving} receiveShadow userData={{ noReflect: true }}>
        <meshStandardMaterial onBeforeCompile={registerHeightFog} vertexColors roughness={0.95} polygonOffset polygonOffsetFactor={-0.5} polygonOffsetUnits={-2} />
      </mesh>
    </>
  )
}
