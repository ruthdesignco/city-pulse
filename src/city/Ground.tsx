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
      {/* Two planes, not one: palette.ground is deliberately dark (for
          street contrast near the camera), but this camera's shallow
          downward pitch means most of the upper frame is ground at steep
          grazing angles, kilometers out -- scene <fog> blends that LIT dark
          color toward the sky color with distance, but the blend reads as a
          muddy dark band for a wide stretch before it finishes, because a
          dark-albedo surface lit then fogged stays visibly dim through most
          of the transition (confirmed by isolating this plane with a white
          albedo instead, which fogged to a clean bright tan over the same
          distances -- it's the dark albedo slowing the visible fade, not a
          lighting or shadow bug). Capping the dark plane's extent so fog
          fully finishes (to the exact same palette.sky used below) before
          its edge, then backing it with a flat, unlit, already-sky-colored
          plane, skips that slow fade for anything beyond the near plane
          instead of trying to out-tune fog against a dark base color. */}
      <mesh position-z={-0.2} receiveShadow>
        <planeGeometry args={[9000, 9000]} />
        <meshStandardMaterial color={palette.ground} />
      </mesh>
      <mesh position-z={-0.4}>
        <planeGeometry args={[40000, 40000]} />
        <meshBasicMaterial color={palette.sky} fog />
      </mesh>
      <mesh geometry={boundary} position-z={0.1} receiveShadow>
        <meshStandardMaterial color={palette.neighborhood} />
      </mesh>
    </group>
  )
}
