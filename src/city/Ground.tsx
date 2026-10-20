import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three'
import { TARGET } from '../scene/view.ts'
import type { CityData } from './format.ts'
import { palette } from './palette.ts'
import { BayWater } from './BayWater.tsx'
import { LAND_TILE_M, createLandTexture } from './landTexture.ts'
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

// The land plane, in meters: far larger than the fog's reach, so its edge is
// never seen.
const LAND_M = 24000

// Shapes are built in (x, -z) and rotated -90° about X, which maps shape
// (u, v) to scene (u, 0, -v); so v = -z lands the outline at scene z.

// Hills are placed by bearing and distance from TARGET: 0 = south,
// 90 = east, 180 = north (atan2(x, z) of a unit direction).
function bearingPoint(bearingDeg: number, distanceM: number): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180
  return [TARGET[0] + distanceM * Math.sin(rad), TARGET[2] + distanceM * Math.cos(rad)]
}

// The Bay (bay.ts, BayWater.tsx): real waterfront, drawn over the ground and
// the paving (the context ring reaches into the water at Mission Bay) but
// under the sidewalks and roads, so the piers' streets and the Bay Bridge
// approach stay on top.
const WATER_Y = 0.15

// Low, soft hill silhouettes along the same heading, further out than the
// bay -- flattened spheres, not real terrain: the ground plane's z-buffer
// naturally clips each one's lower half at ground level, so only a rounded
// cap shows, and fog (shared with everything else here) fades them into the
// haze rather than needing their own blend.
interface Hill {
  bearingDeg: number
  distanceM: number
  radiusM: number
  heightM: number
}
// Radii kept well under half the ~27deg bearing spacing's arc distance
// (~3700 m at this range) so neighboring hills don't overlap -- they did at
// the first, larger radii, and overlapping low-poly spheres at nearly the
// same depth z-fought into visible banding.
const HILLS: Hill[] = [
  { bearingDeg: 92, distanceM: 7600, radiusM: 1100, heightM: 230 },
  { bearingDeg: 119, distanceM: 8200, radiusM: 1300, heightM: 280 },
  { bearingDeg: 146, distanceM: 7700, radiusM: 1150, heightM: 250 },
  { bearingDeg: 173, distanceM: 8300, radiusM: 1400, heightM: 310 },
  { bearingDeg: 200, distanceM: 7800, radiusM: 1100, heightM: 230 },
]

export function Ground() {
  const city = useCity()
  const paving = useMemo(() => buildPavingGeometry(city), [city])
  const shore = useMemo(() => buildShoreGeometry(city), [city])
  const land = useMemo(() => {
    const t = createLandTexture()
    t.repeat.set(LAND_M / LAND_TILE_M, LAND_M / LAND_TILE_M)
    return t
  }, [])
  useEffect(() => () => paving.dispose(), [paving])
  useEffect(() => () => shore.dispose(), [shore])
  useEffect(() => () => land.dispose(), [land])

  return (
    <>
      <group rotation-x={-Math.PI / 2}>
        {/* Land beyond the baked city -- San Francisco and the peninsula
            carry on to the south and west -- textured as distant city blocks
            (landTexture.ts) that the fog (Atmosphere.tsx) fades into the
            sky's haze with distance. Centered on TARGET. */}
        <mesh position={[TARGET[0], -TARGET[2], -0.2]} receiveShadow userData={{ noReflect: true }}>
          <planeGeometry args={[LAND_M, LAND_M]} />
          <meshStandardMaterial map={land} />
        </mesh>
        <BayWater y={WATER_Y} />
      </group>
      <mesh geometry={shore} receiveShadow userData={{ noReflect: true }}>
        <meshStandardMaterial vertexColors transparent depthWrite={false} side={DoubleSide} roughness={0.95} polygonOffset polygonOffsetFactor={-0.9} polygonOffsetUnits={-3.5} />
      </mesh>
      <mesh geometry={paving} receiveShadow userData={{ noReflect: true }}>
        <meshStandardMaterial vertexColors roughness={0.95} polygonOffset polygonOffsetFactor={-0.5} polygonOffsetUnits={-2} />
      </mesh>
      {HILLS.map((hill, i) => {
        const [x, z] = bearingPoint(hill.bearingDeg, hill.distanceM)
        return (
          <mesh key={i} position={[x, -0.2, z]} scale={[hill.radiusM, hill.heightM, hill.radiusM]}>
            <sphereGeometry args={[1, 24, 12]} />
            <meshStandardMaterial color={palette.hills} />
          </mesh>
        )
      })}
    </>
  )
}
