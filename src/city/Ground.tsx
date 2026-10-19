import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Shape, ShapeGeometry, Vector2 } from 'three'
import { TARGET } from '../scene/view.ts'
import type { CityData } from './format.ts'
import { palette } from './palette.ts'
import { buildPaving } from './paving.ts'
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

// Shapes are built in (x, -z) and rotated -90° about X, which maps shape
// (u, v) to scene (u, 0, -v); so v = -z lands the outline at scene z.

// Downtown sits roughly north-northeast of TARGET (view.ts), and so does the
// real SF Bay from this part of the city -- the Embarcadero waterfront is
// just past the Financial District, and the East Bay hills sit across the
// water beyond that. Bay/Hills below are placed along that same heading by
// bearing+distance from TARGET rather than literal lat/lon, same
// "art-directed, not simulated" tradeoff as sun.ts's fixed sun position.
// Bearing convention matches Atmosphere.tsx's cloud placement: 0=south,
// 90=east, 180=north (atan2(x,z) of a unit direction).
function bearingPoint(bearingDeg: number, distanceM: number): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180
  return [TARGET[0] + distanceM * Math.sin(rad), TARGET[2] + distanceM * Math.cos(rad)]
}

// A hand-authored coastline, not a rectangle -- a few irregular points near
// downtown (where the shoreline actually is) closed by a wide arc far out
// past the fog's far distance, so the bay's own far edge is never visible,
// only the near shoreline against the city.
const BAY_NEAR: Array<[number, number]> = [
  [90, 2850],
  [112, 3200],
  [134, 2750],
  [156, 3450],
  [178, 3000],
  [200, 3700],
]
const BAY_FAR_DISTANCE = 7200

function buildBay(): ShapeGeometry {
  const points = [
    ...BAY_NEAR.map(([bearing, distance]) => bearingPoint(bearing, distance)),
    ...[...BAY_NEAR].reverse().map(([bearing]) => bearingPoint(bearing, BAY_FAR_DISTANCE)),
  ]
  const shape = new Shape(points.map(([x, z]) => new Vector2(x, -z)))
  return new ShapeGeometry(shape)
}

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
  const bay = useMemo(() => buildBay(), [])
  useEffect(() => () => paving.dispose(), [paving])
  useEffect(() => () => bay.dispose(), [bay])

  return (
    <>
      <group rotation-x={-Math.PI / 2}>
        {/* A single plane again (an earlier pass here briefly added a
            second, flat-colored backdrop plane to hide a dark horizon band
            -- fixed, it just traded that bug for a flat tan plateau filling
            the same area, since every pixel out there was the exact same
            unlit hex). Centered on TARGET, not world origin: it was
            centered at (0,0,0) before, ~1800 m off from where the camera
            actually orbits, so the plane's edge sat at very different
            distances in different view directions -- fully hidden by fog
            in some, showing as a visible slanted line in others. Large
            enough that its edge sits well past the fog's far distance in
            every direction now, so it fades smoothly all the way out to
            the same color the sky background uses at its own horizon. */}
        <mesh position={[TARGET[0], -TARGET[2], -0.2]} receiveShadow>
          <planeGeometry args={[24000, 24000]} />
          <meshStandardMaterial color={palette.ground} />
        </mesh>
        {/* Pale water, lifted just above the ground plane so it draws on
            top within its own outline. */}
        {/* Pale water, lifted just above the ground plane so it draws on
            top within its own outline. At this camera's low, close
            vantage, 2.8-7.5 km out compresses into a thin band near the
            horizon regardless of what's there -- the base ground plane and
            the hills below both do the same -- so this reads as a band of
            water along the horizon line, not a large lake filling the
            frame, which is the physically correct result, confirmed by a
            debug pass that force-colored it solid magenta. */}
        <mesh geometry={bay} position-z={-0.1} receiveShadow>
          <meshStandardMaterial color={palette.bay} />
        </mesh>
      </group>
      <mesh geometry={paving} receiveShadow>
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
