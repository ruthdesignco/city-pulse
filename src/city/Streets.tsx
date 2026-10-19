import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry } from 'three'
import { COORD_QUANTUM, type CityData } from './format.ts'
import { useCity } from './useCity.ts'

// Lift lines just off the ground so they don't z-fight with it.
const STREET_Y = 0.3

function buildGeometry(streets: CityData['streets']): BufferGeometry {
  let segments = 0
  for (const n of streets.counts) segments += n - 1
  const positions = new Float32Array(segments * 6)
  const cls = new Float32Array(segments * 2)
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
      cls[s++] = streets.classes[k]
      cls[s++] = streets.classes[k]
    }
    c += 2 // skip the last point of this line
  })
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(positions, 3))
  g.setAttribute('streetClass', new BufferAttribute(cls, 1))
  return g
}

export function Streets() {
  const city = useCity()
  const geometry = useMemo(() => buildGeometry(city.streets), [city])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#555560" />
    </lineSegments>
  )
}
