import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three'
import { TARGET } from '../scene/view.ts'
import type { CityData } from './format.ts'
import { BayWater } from './BayWater.tsx'
import { LAND_TILE_M, createLandMaterial, createLandTexture } from './landTexture.ts'
import { bareLand, buildPaving } from './paving.ts'
import { buildShoreFeather } from './shore.ts'
import { useCity } from './useCity.ts'

// Concrete paving over the whole bake area (paving.ts), between the ground
// plane (y -0.2) and the sidewalks (Streets.tsx, y 0.2), polygon-offset
// just under the sidewalks so it never z-fights them from far away.
const PAVING_Y = 0.1

function buildPavingGeometry(city: CityData): BufferGeometry {
  const { position, color, index } = buildPaving(city, PAVING_Y)
  const normal = new Float32Array(position.length)
  for (let i = 1; i < normal.length; i += 3) normal[i] = 1
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

function buildShoreGeometry(city: CityData): BufferGeometry {
  const { position, color, index } = buildShoreFeather(bareLand(city), SHORE_Y)
  const normal = new Float32Array(position.length)
  for (let i = 1; i < normal.length; i += 3) normal[i] = 1
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
const LAND_M = 40000

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
  const land = useMemo(() => {
    const t = createLandTexture()
    t.repeat.set(LAND_M / LAND_TILE_M, LAND_M / LAND_TILE_M)
    return createLandMaterial(t)
  }, [])
  useEffect(() => () => paving.dispose(), [paving])
  useEffect(() => () => shore.dispose(), [shore])
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
        <mesh position={[TARGET[0], -TARGET[2], -0.2]} material={land} receiveShadow userData={{ noReflect: true }}>
          <planeGeometry args={[LAND_M, LAND_M]} />
        </mesh>
        <BayWater y={WATER_Y} />
      </group>
      <mesh geometry={shore} receiveShadow userData={{ noReflect: true }}>
        <meshStandardMaterial vertexColors transparent depthWrite={false} side={DoubleSide} roughness={0.95} polygonOffset polygonOffsetFactor={-0.9} polygonOffsetUnits={-3.5} />
      </mesh>
      <mesh geometry={paving} receiveShadow userData={{ noReflect: true }}>
        <meshStandardMaterial vertexColors roughness={0.95} polygonOffset polygonOffsetFactor={-0.5} polygonOffsetUnits={-2} />
      </mesh>
    </>
  )
}
