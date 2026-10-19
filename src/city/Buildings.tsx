import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Color, MeshStandardMaterial } from 'three'
import type { CityData } from './format.ts'
import { extrudeBuildings } from './extrude.ts'
import { palette } from './palette.ts'
import { RING_DIM_MIN, RING_DIM_RANGE } from './ring.ts'
import { useCity } from './useCity.ts'

// Walls (not roofs) reach full color by this height; below it they blend
// toward buildingBase, a cheap stand-in for ambient occlusion at street
// level. Most SF buildings are 10-15 m, so keep this short and gentle.
const BASE_FADE_M = 12
const BASE_FLOOR = 0.55 // darkest a wall gets at street level, as a mix toward full color
// Context-ring buildings blend toward the sky color as ring.ts's ringDim().
// Roofs face the whole sky fill and read brightest from above; shade them so
// the buses, not the rooftops, are the brightest thing on screen.
const ROOF_SHADE = 0.8
// Buildings near the camera are otherwise the brightest in view (fog only
// starts at 4.5 km): blend them toward the sky by up to NEAR_DIM, fully
// within NEAR_FULL_M of the camera and easing out by NEAR_NONE_M.
const NEAR_DIM = 0.3
const NEAR_FULL_M = 900
const NEAR_NONE_M = 1800

function buildGeometry(city: CityData): BufferGeometry {
  const started = performance.now()
  const mesh = extrudeBuildings(city.buildings, city.header.ringMeters)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3))
  g.setAttribute('normal', new BufferAttribute(mesh.normals, 3))
  g.setAttribute('ring', new BufferAttribute(mesh.ring, 1))
  g.setAttribute('colorType', new BufferAttribute(mesh.colorType, 1))
  g.setIndex(new BufferAttribute(mesh.index, 1))
  g.computeBoundingSphere()
  console.info(
    `city: ${city.buildings.counts.length} buildings, ${mesh.index.length / 3} triangles, extruded in ${(performance.now() - started).toFixed(0)} ms`,
  )
  return g
}

// Indexed by scripts/lib/buildingColor.ts's BuildingColorType (Neutral,
// Residential, Tower) -- keep that order in sync with this array.
const BUILDING_COLORS = [palette.building, palette.buildingResidential, palette.buildingTower]

function buildMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: palette.building, roughness: 0.92, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBase = { value: new Color(palette.buildingBase) }
    shader.uniforms.uDim = { value: new Color(palette.sky) }
    shader.uniforms.uBuildingColors = { value: BUILDING_COLORS.map((c) => new Color(c)) }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float ring;\nattribute float colorType;\nvarying float vRing;\nvarying float vY;\nvarying float vWall;\nvarying float vColorType;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRing = ring;\nvY = position.y;\nvWall = 1.0 - step(0.5, normal.y);\nvColorType = colorType;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uBase;\nuniform vec3 uDim;\nuniform vec3 uBuildingColors[3];\nvarying float vRing;\nvarying float vY;\nvarying float vWall;\nvarying float vColorType;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = uBuildingColors[int(vColorType + 0.5)];
        float lift = mix(${BASE_FLOOR.toFixed(2)}, 1.0, smoothstep(0.0, ${BASE_FADE_M.toFixed(1)}, vY));
        diffuseColor.rgb = mix(uBase, diffuseColor.rgb, mix(1.0, lift, vWall));
        diffuseColor.rgb = mix(diffuseColor.rgb, uDim, vRing > 0.0 ? ${RING_DIM_MIN.toFixed(2)} + ${RING_DIM_RANGE.toFixed(2)} * vRing : 0.0);
        diffuseColor.rgb *= mix(${ROOF_SHADE.toFixed(2)}, 1.0, vWall);
        float nearCam = 1.0 - smoothstep(${NEAR_FULL_M.toFixed(1)}, ${NEAR_NONE_M.toFixed(1)}, length(vViewPosition));
        diffuseColor.rgb = mix(diffuseColor.rgb, uDim, ${NEAR_DIM.toFixed(2)} * nearCam);`,
      )
  }
  material.customProgramCacheKey = () => 'city-buildings-v5'
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
