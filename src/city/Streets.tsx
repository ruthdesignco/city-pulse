import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Color } from 'three'
import { COORD_QUANTUM, StreetClass, type CityData } from './format.ts'
import { palette } from './palette.ts'
import { ringDim, ringPosition } from './ring.ts'
import { useCity } from './useCity.ts'

// Lift lines just off the ground so they don't z-fight with it.
const STREET_Y = 0.3

const SKY = new Color(palette.sky)

const CLASS_COLOR: Record<number, Color> = {
  [StreetClass.Major]: new Color(palette.streetMajor),
  [StreetClass.Minor]: new Color(palette.streetMinor),
  [StreetClass.Local]: new Color(palette.streetLocal),
}

// Streets in the context ring fade toward the sky like the ring's buildings
// (ring.ts), per vertex, so a street crossing the boundary fades along its length.
function buildGeometry(city: CityData): BufferGeometry {
  const { streets, boundary } = city
  const ringMeters = city.header.ringMeters
  const color = new Color()
  const shade = (base: Color, x: number, z: number, out: Float32Array, at: number) =>
    color.copy(base).lerp(SKY, ringDim(ringPosition(boundary, ringMeters, x, z))).toArray(out, at)

  let segments = 0
  for (const n of streets.counts) segments += n - 1
  const positions = new Float32Array(segments * 6)
  const colors = new Float32Array(segments * 6)
  let c = 0
  let p = 0
  let s = 0
  streets.counts.forEach((n, k) => {
    const base = CLASS_COLOR[streets.classes[k]] ?? CLASS_COLOR[StreetClass.Local]
    for (let i = 0; i < n - 1; i++, c += 2) {
      const x0 = streets.coords[c] * COORD_QUANTUM
      const z0 = streets.coords[c + 1] * COORD_QUANTUM
      const x1 = streets.coords[c + 2] * COORD_QUANTUM
      const z1 = streets.coords[c + 3] * COORD_QUANTUM
      positions.set([x0, STREET_Y, z0, x1, STREET_Y, z1], p)
      p += 6
      shade(base, x0, z0, colors, s)
      shade(base, x1, z1, colors, s + 3)
      s += 6
    }
    c += 2 // skip the last point of this line
  })
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(positions, 3))
  g.setAttribute('color', new BufferAttribute(colors, 3))
  return g
}

export function Streets() {
  const city = useCity()
  const geometry = useMemo(() => buildGeometry(city), [city])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors />
    </lineSegments>
  )
}
