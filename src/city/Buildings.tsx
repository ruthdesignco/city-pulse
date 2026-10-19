import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Color, MeshStandardMaterial } from 'three'
import type { CityData } from './format.ts'
import { extrudeBuildings } from './extrude.ts'
import { palette } from './palette.ts'
import { useCity } from './useCity.ts'

// Walls (not roofs) reach full color by this height; below it they blend
// toward buildingBase, a cheap stand-in for ambient occlusion at street
// level. Most SF buildings are 10-15 m, so keep this short and gentle.
const BASE_FADE_M = 12
const BASE_FLOOR = 0.55 // darkest a wall gets at street level, as a mix toward full color
// Context-ring buildings blend toward the sky color: RING_DIM_MIN at the
// neighborhood edge, up to RING_DIM_MIN + RING_DIM_RANGE at the ring's edge.
const RING_DIM_MIN = 0.35
const RING_DIM_RANGE = 0.45

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

function buildMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: palette.building, roughness: 0.92, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBase = { value: new Color(palette.buildingBase) }
    shader.uniforms.uDim = { value: new Color(palette.sky) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float ring;\nvarying float vRing;\nvarying float vY;\nvarying float vWall;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRing = ring;\nvY = position.y;\nvWall = 1.0 - step(0.5, normal.y);')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uBase;\nuniform vec3 uDim;\nvarying float vRing;\nvarying float vY;\nvarying float vWall;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float lift = mix(${BASE_FLOOR.toFixed(2)}, 1.0, smoothstep(0.0, ${BASE_FADE_M.toFixed(1)}, vY));
        diffuseColor.rgb = mix(uBase, diffuseColor.rgb, mix(1.0, lift, vWall));
        diffuseColor.rgb = mix(diffuseColor.rgb, uDim, vRing > 0.0 ? ${RING_DIM_MIN.toFixed(2)} + ${RING_DIM_RANGE.toFixed(2)} * vRing : 0.0);`,
      )
  }
  material.customProgramCacheKey = () => 'city-buildings-v2'
  return material
}

export function Buildings() {
  const city = useCity()
  const geometry = useMemo(() => buildGeometry(city), [city])
  const material = useMemo(() => buildMaterial(), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  return <mesh geometry={geometry} material={material} />
}
