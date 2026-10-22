// Cross-fading a tile from one level of detail to the next (lod.ts) without
// transparency: for FADE_S both levels draw, each keeping a complementary
// share of the screen's pixels by a per-pixel noise threshold, so together
// they cover every pixel once, and the share moves from the old to the
// new. Only materials made for a fade carry the discard (`dither`): a
// discard in the usual programs would cost every frame (Apple's GPUs skip
// their hidden surface removal for shaders that can discard).
//
// uFade: 1 drawn whole; t in (0, 1) fading in, a t share of pixels kept;
// -t fading out, the other 1 - t kept.

export const FADE_S = 0.6

export interface Fade {
  value: number
}

export const DITHER_PARS = /* glsl */ `
uniform float uFade;
`

// At the top of the fragment shader's main(): interleaved gradient noise.
export const DITHER_CODE = /* glsl */ `
{
  float ditherN = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  if ( uFade >= 0.0 ? ditherN >= uFade : ditherN < -uFade ) discard;
}
`

// A fragment shader with the dither, where `dither`: the declarations after
// #include <common>, the test first thing in main().
export function withDither(fragmentShader: string, dither: boolean): string {
  if (!dither) return fragmentShader
  return fragmentShader.replace('#include <common>', `#include <common>\n${DITHER_PARS}`).replace('void main() {', `void main() {\n${DITHER_CODE}`)
}
