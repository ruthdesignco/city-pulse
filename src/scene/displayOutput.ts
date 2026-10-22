import { ShaderChunk } from 'three'
// Its fog first: the output goes after all of it.
import './heightFog.ts'

// The page draws straight to the canvas, multisampled by the browser
// (App.tsx), not through the composer's multisampled half-float buffer: on
// Apple's GPUs the canvas keeps its samples on chip, while the composer's
// buffer and its resolve cost ~2 ms a frame at Retina size. Tone mapping and
// the sRGB encoding then happen in each shader, which three.js does before
// the fog, with the fog's color already encoded: fog would mix in display
// space and the haze change. Here they come after the fog (and the height
// fog, heightFog.ts), at the end of the fog chunk, so everything mixes in
// linear light as it does through the composer. They apply only when
// drawing to the canvas with tone mapping on (TONE_MAPPING is defined only
// then); render targets (the Bay's reflection) and the composer's path stay
// linear. The renderer's output color space is linear on this path, so
// three.js converts no colors itself.
//
// Shaders without the fog chunk end with display_output_fragment
// themselves (SkyDome.tsx); the Bay's water adds its glitter between the
// fog and the output (BayWater.tsx).

const MARK = '// city-pulse display output'
const chunks = ShaderChunk as unknown as Record<string, string>

// Installed once, at module load, before anything compiles.
if (!chunks.display_output_fragment) {
  chunks.display_output_fragment = /* glsl */ `
${MARK}
#ifdef TONE_MAPPING
  gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
  gl_FragColor = sRGBTransferOETF( gl_FragColor );
  // Dithered by up to one 8-bit step (triangular noise, fixed per pixel), so
  // smooth gradients, the sky's round the sun most, don't band.
  {
    vec2 dp = gl_FragCoord.xy;
    float dn = fract( 52.9829189 * fract( dot( dp, vec2( 0.06711056, 0.00583715 ) ) ) )
      + fract( 52.9829189 * fract( dot( dp + vec2( 17.0, 41.0 ), vec2( 0.06711056, 0.00583715 ) ) ) ) - 1.0;
    gl_FragColor.rgb += dn / 255.0;
  }
#endif
`
  chunks.fog_linear_fragment = ShaderChunk.fog_fragment
  ShaderChunk.fog_fragment = '#include <fog_linear_fragment>\n#include <display_output_fragment>'
  // Its encoding stays: to a linear output it does nothing, and the
  // composer's last pass needs it.
  ShaderChunk.tonemapping_fragment = ''
}
