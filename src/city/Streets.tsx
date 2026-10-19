import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Color } from 'three'
import { COORD_QUANTUM, StreetClass, type CityData } from './format.ts'
import { palette } from './palette.ts'
import { useCity } from './useCity.ts'

// Lift lines just off the ground so they don't z-fight with it.
const STREET_Y = 0.3

const CLASS_COLOR: Record<number, Color> = {
  [StreetClass.Major]: new Color(palette.streetMajor),
  [StreetClass.Minor]: new Color(palette.streetMinor),
  [StreetClass.Local]: new Color(palette.streetLocal),
}

function buildGeometry(streets: CityData['streets']): BufferGeometry {
  let segments = 0
  for (const n of streets.counts) segments += n - 1
  const positions = new Float32Array(segments * 6)
  const colors = new Float32Array(segments * 6)
  let c = 0
  let p = 0
  let s = 0
  streets.counts.forEach((n, k) => {
    for (let i = 0; i < n - 1; i++, c += 2) {
      positions.set(
        [
          streets.coords[c] * COORD_QUANTUM,
          STREET_Y,
          streets.coords[c + 1] * COORD_QUANTUM,
          streets.coords[c + 2] * COORD_QUANTUM,
          STREET_Y,
          streets.coords[c + 3] * COORD_QUANTUM,
        ],
        p,
      )
      p += 6
      const color = CLASS_COLOR[streets.classes[k]] ?? CLASS_COLOR[StreetClass.Local]
      color.toArray(colors, s)
      color.toArray(colors, s + 3)
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
  const geometry = useMemo(() => buildGeometry(city.streets), [city])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors />
    </lineSegments>
  )
}
