import { MeshStandardMaterial } from 'three'
import { registerHeightFog, sceneUniforms } from '../scene/sceneUniforms.ts'
import { RING_DIM_MAX } from './ring.ts'
import { type Fade, withDither } from './stream/dither.ts'

// The woods' canopy at middle and far distance (stream/tileBuild.ts
// buildCanopy): flat-shaded, in the woods' greens, fading toward the haze
// in the ring as the trees do. Faded in and out with its tile (dither.ts).
export function canopyMaterial(fade: Fade, dither = false): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true })
  material.onBeforeCompile = (shader) => {
    registerHeightFog(shader)
    shader.uniforms.uFade = fade
    shader.uniforms.uDim = sceneUniforms.uHaze
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float ring;\nvarying float vRing;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRing = ring;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uDim;\nvarying float vRing;')
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, uDim, ${RING_DIM_MAX.toFixed(3)} * smoothstep( 0.0, 1.0, vRing ) );`)
    shader.fragmentShader = withDither(shader.fragmentShader, dither)
  }
  material.customProgramCacheKey = () => `city-canopy-v1${dither ? '-dither' : ''}`
  return material
}
