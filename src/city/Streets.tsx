import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Color, MeshStandardMaterial } from 'three'
import { COORD_QUANTUM, StreetClass, type CityData } from './format.ts'
import { registerHeightFog, sceneUniforms } from '../scene/sceneUniforms.ts'
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

// Lane lines fade into the asphalt with distance, so thin dashes don't
// shimmer from the opening view.
const MARKING_FADE_M: [number, number] = [250, 900]

// Streetlight pools at night: discrete pools of neutral warm-white LED light
// along both curbs, staggered side to side, over the curb lane and the
// sidewalk, with dark gray asphalt between them, so the street grid reads
// after dark. No streetlights are modeled; these are the light they'd cast.
// Emitted, so it shows against the dark (sceneUniforms.ts uWindowsOn: 0 by
// day). Main streets brightest, side streets dimmer (POOL_BY_CLASS).
const POOL_SPACING_M = 28
const POOL_ALONG_M = 4.5 // gaussian sigma along the street
const POOL_ACROSS_M = 3.5 // and across it, centered on the curb
// The faint light between pools (spill from the lamps either side).
const POOL_BASE = 0.06
const POOL_LIGHT = 0.24
const POOL_COLOR = new Color('#fff0dc') // ~4000 K LED: warm white, not orange
// The faded line's brightness, relative to the pools' own average.
const POOL_FAR = 0.6
const POOL_BY_CLASS: Record<number, number> = { [StreetClass.Major]: 1, [StreetClass.Minor]: 0.75, [StreetClass.Local]: 0.5 }

// Streets in the context ring fade toward the haze like the ring's
// buildings (ring.ts): how far, per vertex (ringFade), toward the time of
// day's haze color (sceneUniforms.ts uHaze), in the shader.
// `pools` (ribbon layers): per vertex, the street's curb offset (m) and how
// bright its streetlight pools are (POOL_BY_CLASS).
function toGeometry(m: Mesh, base: Color, city: CityData, pools?: { curb: number[]; lit: number[] }): BufferGeometry {
  const { boundary } = city
  const ringMeters = city.header.ringMeters
  const position = new Float32Array(m.position)
  const color = new Float32Array(position.length)
  const ringFade = new Float32Array(position.length / 3)
  for (let i = 0; i < position.length; i += 3) {
    base.toArray(color, i)
    ringFade[i / 3] = ringDim(ringPosition(boundary, ringMeters, position[i], position[i + 2]))
  }
  const normal = new Float32Array(position.length)
  for (let i = 1; i < normal.length; i += 3) normal[i] = 1
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(position, 3))
  g.setAttribute('normal', new BufferAttribute(normal, 3))
  g.setAttribute('color', new BufferAttribute(color, 3))
  g.setAttribute('ringFade', new BufferAttribute(ringFade, 1))
  if (pools) {
    g.setAttribute('along', new BufferAttribute(new Float32Array(m.along), 1))
    g.setAttribute('offset', new BufferAttribute(new Float32Array(m.offset), 1))
    g.setAttribute('curb', new BufferAttribute(new Float32Array(pools.curb), 1))
    g.setAttribute('lit', new BufferAttribute(new Float32Array(pools.lit), 1))
  }
  g.setIndex(new BufferAttribute(position.length / 3 > 65535 ? new Uint32Array(m.index) : new Uint16Array(m.index), 1))
  g.computeBoundingSphere()
  return g
}

function buildLayers(city: CityData) {
  const { streets } = city
  const sidewalk = emptyMesh()
  const asphalt = emptyMesh()
  const markings = emptyMesh()
  const sidewalkPools = { curb: [] as number[], lit: [] as number[] }
  const asphaltPools = { curb: [] as number[], lit: [] as number[] }
  // Tags the vertices `ribbon` just added with this street's curb and pools.
  const tag = (m: Mesh, p: typeof sidewalkPools, curb: number, lit: number) => {
    while (p.curb.length < m.along.length) {
      p.curb.push(curb)
      p.lit.push(lit)
    }
  }
  let c = 0
  streets.counts.forEach((n, k) => {
    const line: Pt[] = []
    for (let i = 0; i < n; i++, c += 2) line.push([streets.coords[c] * COORD_QUANTUM, streets.coords[c + 1] * COORD_QUANTUM])
    const cls = ROAD_CLASS[streets.classes[k]] ?? ROAD_CLASS[StreetClass.Local]
    const lit = POOL_BY_CLASS[streets.classes[k]] ?? POOL_BY_CLASS[StreetClass.Local]
    ribbon(sidewalk, line, cls.asphaltM / 2 + cls.sidewalkM, SIDEWALK_Y)
    tag(sidewalk, sidewalkPools, cls.asphaltM / 2, lit)
    ribbon(asphalt, line, cls.asphaltM / 2, ASPHALT_Y)
    tag(asphalt, asphaltPools, cls.asphaltM / 2, lit)
    const lanes = laneLineOffsets(cls.asphaltM, cls.lanes)
    if (lanes.length) dashes(markings, line, lanes, MARKING_Y)
  })
  return {
    sidewalk: toGeometry(sidewalk, new Color(palette.sidewalk), city, sidewalkPools),
    asphalt: toGeometry(asphalt, new Color(palette.asphalt), city, asphaltPools),
    markings: toGeometry(markings, new Color(palette.laneMarking), city),
  }
}

// `layer` 1-3, bottom to top: each one wins the depth test over the one below.
// Lane markings (`markings`) also fade into the asphalt with distance.
function roadMaterial(layer: number, markings = false): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -layer,
    polygonOffsetUnits: -4 * layer,
  })
  const asphalt = new Color(palette.asphalt)
  material.onBeforeCompile = (shader) => {
    registerHeightFog(shader)
    shader.uniforms.uAsphalt = { value: asphalt }
    shader.uniforms.uHaze = sceneUniforms.uHaze
    shader.uniforms.uWindowsOn = sceneUniforms.uWindowsOn
    shader.uniforms.uPoolColor = { value: POOL_COLOR }
    const poolVars = 'attribute float along;\nattribute float offset;\nattribute float curb;\nattribute float lit;\nvarying float vAlong;\nvarying float vOffset;\nvarying float vCurb;\nvarying float vLit;'
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float ringFade;\nvarying float vRingFade;\n${markings ? '' : poolVars}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvRingFade = ringFade;\n${markings ? '' : 'vAlong = along;\nvOffset = offset;\nvCurb = curb;\nvLit = lit;'}`,
      )
    // Pools: a gaussian along the street around each light (left side at
    // multiples of the spacing, right side halfway between), and across it
    // around the curb. Far away, where single pools are under a few pixels,
    // their average glow instead, so nothing shimmers.
    const pools = markings
      ? ''
      : `{
  float pu = vAlong / ${POOL_SPACING_M.toFixed(1)} + 0.5 * step( vOffset, 0.0 );
  float da = ( fract( pu ) - 0.5 ) * ${POOL_SPACING_M.toFixed(1)};
  float dl = abs( abs( vOffset ) - vCurb );
  float across = exp( -dl * dl / ${(2 * POOL_ACROSS_M * POOL_ACROSS_M).toFixed(1)} );
  float near = exp( -da * da / ${(2 * POOL_ALONG_M * POOL_ALONG_M).toFixed(1)} );
  float average = ${((POOL_ALONG_M * Math.sqrt(2 * Math.PI)) / POOL_SPACING_M).toFixed(4)};
  // Single pools only up close (spaced 90+ px apart); by 40 px a soft,
  // continuous line along each curb, dimmer, so a street seen from the air
  // never outshines the buildings. (Fading by 15 px left beads on a string
  // at mid distance in the opening view.)
  float poolDetail = 1.0 - smoothstep( ${(1 / 90).toFixed(4)}, ${(1 / 40).toFixed(4)}, fwidth( pu ) );
  float pool = across * mix( ${POOL_FAR.toFixed(3)} * average, ${POOL_BASE.toFixed(3)} + ${(1 - POOL_BASE).toFixed(3)} * near, poolDetail );
  totalEmissiveRadiance += uWindowsOn * vLit * pool * ${POOL_LIGHT.toFixed(3)} * uPoolColor;
}`
    const markingFade = markings
      ? `diffuseColor.rgb = mix(diffuseColor.rgb, uAsphalt, smoothstep(${MARKING_FADE_M[0].toFixed(1)}, ${MARKING_FADE_M[1].toFixed(1)}, length(vViewPosition)));`
      : ''
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec3 uAsphalt;\nuniform vec3 uHaze;\nuniform float uWindowsOn;\nuniform vec3 uPoolColor;\nvarying float vRingFade;\n${markings ? '' : 'varying float vAlong;\nvarying float vOffset;\nvarying float vCurb;\nvarying float vLit;'}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
${markingFade}
diffuseColor.rgb = mix(diffuseColor.rgb, uHaze, vRingFade);`,
      )
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${pools}`)
  }
  material.customProgramCacheKey = () => `city-roads-v6-${markings ? 'markings' : 'surface'}`
  return material
}

export function Streets() {
  const city = useCity()
  const layers = useMemo(() => buildLayers(city), [city])
  const materials = useMemo(() => ({ sidewalk: roadMaterial(1), asphalt: roadMaterial(2), markings: roadMaterial(3, true) }), [])
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
