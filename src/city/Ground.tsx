import { useEffect, useMemo } from 'react'
import { Shape, ShapeGeometry, Vector2 } from 'three'
import { COORD_QUANTUM, type CityData } from './format.ts'
import { palette } from './palette.ts'
import { useCity } from './useCity.ts'

// Shapes are built in (x, -z) and rotated -90° about X, which maps shape
// (u, v) to scene (u, 0, -v); so v = -z lands the outline at scene z.
function buildBoundary(boundary: CityData['boundary']): ShapeGeometry {
  const shapes: Shape[] = []
  let c = 0
  for (const n of boundary.counts) {
    const pts: Vector2[] = []
    for (let i = 0; i < n; i++, c += 2) {
      pts.push(new Vector2(boundary.coords[c] * COORD_QUANTUM, -boundary.coords[c + 1] * COORD_QUANTUM))
    }
    shapes.push(new Shape(pts))
  }
  return new ShapeGeometry(shapes)
}

export function Ground() {
  const city = useCity()
  const boundary = useMemo(() => buildBoundary(city.boundary), [city])
  useEffect(() => () => boundary.dispose(), [boundary])

  return (
    <group rotation-x={-Math.PI / 2}>
      {/* A single plane again (an earlier pass here briefly added a second,
          flat-colored backdrop plane to hide a dark horizon band -- fixed,
          it just traded that bug for a flat tan plateau filling the same
          area, since every pixel out there was the exact same unlit hex).
          Large enough that its edge sits well past the fog's far distance,
          so it fades smoothly all the way out to the same color the sky
          background uses at its own horizon, and grazing-angle rays that
          miss this plane's edge entirely fall through to that same
          background directly -- no seam either way. palette.ground is now a
          mid-gray close to palette.sky's value already, so the fogged
          fade reads as continuous haze instead of a muddy dark-to-light
          transition (the old near-black ground was what made that
          transition read as a band in the first place). */}
      <mesh position-z={-0.2} receiveShadow>
        <planeGeometry args={[20000, 20000]} />
        <meshStandardMaterial color={palette.ground} />
      </mesh>
      <mesh geometry={boundary} position-z={0.1} receiveShadow>
        <meshStandardMaterial color={palette.neighborhood} />
      </mesh>
    </group>
  )
}
