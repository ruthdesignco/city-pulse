import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Color, MeshStandardMaterial } from 'three'
import type { CityData } from './format.ts'
import { extrudeBuildings } from './extrude.ts'
import { FACADE_COLOR, FACADE_PARS, FACADE_REFLECTION, FACADE_ROUGHNESS } from './facade.ts'
import { palette } from './palette.ts'
import { RING_DIM_MAX } from './ring.ts'
import { useCity } from './useCity.ts'

// Walls (not roofs) reach full color by this height; below it they blend
// toward buildingBase, a cheap stand-in for ambient occlusion at street
// level. Most SF buildings are 10-15 m, so keep this short and gentle.
const BASE_FADE_M = 12
const BASE_FLOOR = 0.55 // darkest a wall gets at street level, as a mix toward full color
// Context-ring buildings blend toward the sky color as ring.ts's ringDim().
// Walls get procedural windows (facade.ts).
// Roofs face the whole sky fill and read brightest from above; most real
// flat roofs (tar, gravel, membrane) are darker than the walls anyway.
const ROOF_SHADE = 0.8

function buildGeometry(city: CityData): BufferGeometry {
  const started = performance.now()
  const mesh = extrudeBuildings(city.buildings, city.header.ringMeters)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3))
  g.setAttribute('normal', new BufferAttribute(mesh.normals, 3))
  g.setAttribute('ring', new BufferAttribute(mesh.ring, 1))
  g.setAttribute('colorIndex', new BufferAttribute(mesh.colorIndex, 1))
  g.setAttribute('facade', new BufferAttribute(mesh.facade, 4))
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
    shader.uniforms.uBuildingColors = { value: palette.buildingColors.map((c) => new Color(c)) }
    // What the windows reflect (facade.ts): the haze at the horizon.
    shader.uniforms.uSkyReflection = { value: new Color(palette.sky) }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float ring;\nattribute float colorIndex;\nattribute vec4 facade;\nvarying float vRing;\nvarying float vY;\nvarying float vWall;\nvarying float vColorIndex;\nvarying vec4 vFacade;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRing = ring;\nvY = position.y;\nvWall = 1.0 - step(0.5, normal.y);\nvColorIndex = colorIndex;\nvFacade = facade;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec3 uBase;\nuniform vec3 uDim;\nuniform vec3 uBuildingColors[${palette.buildingColors.length}];\nvarying float vRing;\nvarying float vY;\nvarying float vWall;\nvarying float vColorIndex;\n${FACADE_PARS}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = uBuildingColors[int(vColorIndex + 0.5)];
        ${FACADE_COLOR}
        float lift = mix(${BASE_FLOOR.toFixed(2)}, 1.0, smoothstep(0.0, ${BASE_FADE_M.toFixed(1)}, vY));
        diffuseColor.rgb = mix(uBase, diffuseColor.rgb, mix(1.0, lift, vWall));
        diffuseColor.rgb = mix(diffuseColor.rgb, uDim, ${RING_DIM_MAX.toFixed(3)} * smoothstep(0.0, 1.0, vRing));
        diffuseColor.rgb *= mix(${ROOF_SHADE.toFixed(2)}, 1.0, vWall);`,
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FACADE_ROUGHNESS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FACADE_REFLECTION}`)
  }
  material.customProgramCacheKey = () => 'city-buildings-v9'
  return material
}

export function Buildings() {
  const city = useCity()
  const geometry = useMemo(() => buildGeometry(city), [city])
  const material = useMemo(() => buildMaterial(), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  return <mesh geometry={geometry} material={material} castShadow receiveShadow />
}
