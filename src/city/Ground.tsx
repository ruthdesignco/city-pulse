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
      {/* Far wider than the city so its edge lies past the fog's far
          distance (11 km) and melts into the sky instead of drawing a line. */}
      <mesh position-z={-0.2}>
        <planeGeometry args={[40000, 40000]} />
        <meshStandardMaterial color={palette.ground} />
      </mesh>
      <mesh geometry={boundary} position-z={0.1}>
        <meshStandardMaterial color={palette.neighborhood} />
      </mesh>
    </group>
  )
}
