import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry } from 'three'
import type { CityData } from './format.ts'
import { extrudeBuildings } from './extrude.ts'
import { useCity } from './useCity.ts'

function buildGeometry(city: CityData): BufferGeometry {
  const started = performance.now()
  const mesh = extrudeBuildings(city.buildings, city.header.ringMeters)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3))
  g.setAttribute('normal', new BufferAttribute(mesh.normals, 3))
  g.setAttribute('ring', new BufferAttribute(mesh.ring, 1))
  g.setIndex(new BufferAttribute(mesh.index, 1))
  g.computeBoundingSphere()
  console.info(
    `city: ${city.buildings.counts.length} buildings, ${mesh.index.length / 3} triangles, extruded in ${(performance.now() - started).toFixed(0)} ms`,
  )
  return g
}

export function Buildings() {
  const city = useCity()
  const geometry = useMemo(() => buildGeometry(city), [city])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#9a9aa0" />
    </mesh>
  )
}
