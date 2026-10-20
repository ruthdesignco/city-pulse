import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Color, MeshStandardMaterial } from 'three'
import { COORD_QUANTUM, StreetClass, type CityData } from './format.ts'
import { palette } from './palette.ts'
import { ringDim, ringPosition } from './ring.ts'
import { ROAD_CLASS, type Mesh, type Pt, dashes, emptyMesh, laneLineOffsets, ribbon } from './roads.ts'
import { useCity } from './useCity.ts'

// Real roads (roads.ts): sidewalks, asphalt over them, lane lines over that,
// a few centimeters apart above the ground (Ground.tsx, y <= 0.1) and pushed
// further apart in depth by polygon offset so they don't z-fight from the
// orbit's far end.
const SIDEWALK_Y = 0.2
const ASPHALT_Y = 0.25
const MARKING_Y = 0.3

const SKY = new Color(palette.sky)
// Lane lines fade into the asphalt with distance, so thin dashes don't
// shimmer from the opening view.
const MARKING_FADE_M: [number, number] = [250, 900]

// Streets in the context ring fade toward the sky like the ring's buildings
// (ring.ts), per vertex.
function toGeometry(m: Mesh, base: Color, city: CityData): BufferGeometry {
  const { boundary } = city
  const ringMeters = city.header.ringMeters
  const position = new Float32Array(m.position)
  const color = new Float32Array(position.length)
  const c = new Color()
  for (let i = 0; i < position.length; i += 3)
    c.copy(base).lerp(SKY, ringDim(ringPosition(boundary, ringMeters, position[i], position[i + 2]))).toArray(color, i)
  const normal = new Float32Array(position.length)
  for (let i = 1; i < normal.length; i += 3) normal[i] = 1
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(position, 3))
  g.setAttribute('normal', new BufferAttribute(normal, 3))
  g.setAttribute('color', new BufferAttribute(color, 3))
  g.setIndex(new BufferAttribute(position.length / 3 > 65535 ? new Uint32Array(m.index) : new Uint16Array(m.index), 1))
  g.computeBoundingSphere()
  return g
}

function buildLayers(city: CityData) {
  const { streets } = city
  const sidewalk = emptyMesh()
  const asphalt = emptyMesh()
  const markings = emptyMesh()
  let c = 0
  streets.counts.forEach((n, k) => {
    const line: Pt[] = []
    for (let i = 0; i < n; i++, c += 2) line.push([streets.coords[c] * COORD_QUANTUM, streets.coords[c + 1] * COORD_QUANTUM])
    const cls = ROAD_CLASS[streets.classes[k]] ?? ROAD_CLASS[StreetClass.Local]
    ribbon(sidewalk, line, cls.asphaltM / 2 + cls.sidewalkM, SIDEWALK_Y)
    ribbon(asphalt, line, cls.asphaltM / 2, ASPHALT_Y)
    const lanes = laneLineOffsets(cls.asphaltM, cls.lanes)
    if (lanes.length) dashes(markings, line, lanes, MARKING_Y)
  })
  return {
    sidewalk: toGeometry(sidewalk, new Color(palette.sidewalk), city),
    asphalt: toGeometry(asphalt, new Color(palette.asphalt), city),
    markings: toGeometry(markings, new Color(palette.laneMarking), city),
  }
}

// `layer` 1-3, bottom to top: each one wins the depth test over the one below.
function roadMaterial(layer: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -layer,
    polygonOffsetUnits: -4 * layer,
  })
}

function markingMaterial(): MeshStandardMaterial {
  const material = roadMaterial(3)
  const asphalt = new Color(palette.asphalt)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAsphalt = { value: asphalt }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uAsphalt;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, uAsphalt, smoothstep(${MARKING_FADE_M[0].toFixed(1)}, ${MARKING_FADE_M[1].toFixed(1)}, length(vViewPosition)));`,
      )
  }
  material.customProgramCacheKey = () => 'city-lane-markings-v1'
  return material
}

export function Streets() {
  const city = useCity()
  const layers = useMemo(() => buildLayers(city), [city])
  const materials = useMemo(() => ({ sidewalk: roadMaterial(1), asphalt: roadMaterial(2), markings: markingMaterial() }), [])
  useEffect(() => () => Object.values(layers).forEach((g) => g.dispose()), [layers])
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials])

  // Flat at street level: nothing the Bay's reflection could show (BayWater.tsx).
  return (
    <>
      <mesh geometry={layers.sidewalk} material={materials.sidewalk} receiveShadow userData={{ noReflect: true }} />
      <mesh geometry={layers.asphalt} material={materials.asphalt} receiveShadow userData={{ noReflect: true }} />
      <mesh geometry={layers.markings} material={materials.markings} receiveShadow userData={{ noReflect: true }} />
    </>
  )
}
