import { BufferAttribute, BufferGeometry, Color, MeshStandardMaterial } from 'three'
import { registerHeightFog, sceneUniforms } from '../scene/sceneUniforms.ts'
import { palette } from './palette.ts'
import { SHADING_PARS, type ShadingUniforms, shadingCode } from './groundShading.ts'
import type { StreetLayer } from './streetMesh.ts'

// Real roads (streetMesh.ts, built per tile off the main thread):
// sidewalks, asphalt over them, lane lines over that, a few centimeters
// apart above the ground and pushed further apart in depth by polygon
// offset (roadMaterial's `layer`) so they don't z-fight from far off.

// Lane lines fade into the asphalt with distance, so thin dashes don't
// shimmer from the opening view.
const MARKING_FADE_M: [number, number] = [250, 900]

// Streetlight pools at night: discrete pools of neutral warm-white LED light
// along both curbs, staggered side to side, over the curb lane and the
// sidewalk, with dark gray asphalt between them, so the street grid reads
// after dark. No streetlights are modeled; these are the light they'd cast.
// Emitted, so it shows against the dark (sceneUniforms.ts uWindowsOn: 0 by
// day). Main streets brightest, side streets dimmer (streetMesh.ts).
const POOL_SPACING_M = 28
const POOL_ALONG_M = 4.5 // gaussian sigma along the street
const POOL_ACROSS_M = 3.5 // and across it, centered on the curb
// The faint light between pools (spill from the lamps either side).
const POOL_BASE = 0.06
const POOL_LIGHT = 0.24
const POOL_COLOR = new Color('#fff0dc') // ~4000 K LED: warm white, not orange
// The faded line's brightness, relative to the pools' own average.
const POOL_FAR = 0.6

// A tile's street layer from its arrays. Streets in the context ring fade
// toward the haze like the ring's buildings (ring.ts): how far, per vertex
// (ringFade), toward the time of day's haze color (sceneUniforms.ts
// uHaze), in the shader. The pools' attributes on sidewalks and asphalt.
export function streetGeometry(l: StreetLayer): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(l.position, 3))
  g.setAttribute('normal', new BufferAttribute(l.normal, 3))
  g.setAttribute('color', new BufferAttribute(l.color, 3))
  g.setAttribute('ringFade', new BufferAttribute(l.ringFade, 1))
  if (l.along && l.offset && l.curb && l.lit) {
    g.setAttribute('along', new BufferAttribute(l.along, 1))
    g.setAttribute('offset', new BufferAttribute(l.offset, 1))
    g.setAttribute('curb', new BufferAttribute(l.curb, 1))
    g.setAttribute('lit', new BufferAttribute(l.lit, 1))
  }
  g.setIndex(new BufferAttribute(l.index, 1))
  g.computeBoundingSphere()
  return g
}

// `layer` 1-3, bottom to top: each one wins the depth test over the one below.
// Lane markings (`markings`) also fade into the asphalt with distance.
// `shading`: the tile's hillshading and the valleys' occlusion, as on the
// ground around them (groundShading.ts). Light pools brightness by street
// class: streetMesh.ts.
export function roadMaterial(shading: ShadingUniforms, layer: number, markings = false): MeshStandardMaterial {
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
    Object.assign(shader.uniforms, shading)
    shader.uniforms.uLightDir = sceneUniforms.uLightDir
    shader.uniforms.uHillshade = sceneUniforms.uHillshade
    const poolVars = 'attribute float along;\nattribute float offset;\nattribute float curb;\nattribute float lit;\nvarying float vAlong;\nvarying float vOffset;\nvarying float vCurb;\nvarying float vLit;'
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float ringFade;\nvarying float vRingFade;\nvarying vec2 vGround;\n${markings ? '' : poolVars}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvRingFade = ringFade;\nvGround = position.xz;\n${markings ? '' : 'vAlong = along;\nvOffset = offset;\nvCurb = curb;\nvLit = lit;'}`,
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
        `#include <common>\nuniform vec3 uAsphalt;\nuniform vec3 uHaze;\nuniform float uWindowsOn;\nuniform vec3 uPoolColor;\nvarying float vRingFade;\nvarying vec2 vGround;\n${SHADING_PARS}\n${markings ? '' : 'varying float vAlong;\nvarying float vOffset;\nvarying float vCurb;\nvarying float vLit;'}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
${markingFade}
${shadingCode('vGround')}
diffuseColor.rgb = mix(diffuseColor.rgb, uHaze, vRingFade);`,
      )
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${pools}`)
  }
  material.customProgramCacheKey = () => `city-roads-v9-${markings ? 'markings' : 'surface'}`
  return material
}
