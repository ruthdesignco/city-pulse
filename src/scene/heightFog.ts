import { ShaderChunk } from 'three'

// Height fog: the marine layer, from the NWS visibility (weather.ts). Its
// density is full from the ground up to uFogTop - uFogSoft and thins
// linearly to nothing at uFogTop, so the tallest towers stand out of it
// (how deep the real layer is isn't measured; this is illustrative). The
// fog a fragment shows is the density integrated along the line of sight
// from the camera, worked out exactly for that profile, so it's densest
// low over the streets and the Bay and right from any height or angle.
//
// Near the camera the fog is held back: along the line of sight it ramps
// in from nothing at the camera to full over uFogRamp. Real fog this thick
// whites out a street a few hundred meters off; held back, a camera inside
// the layer (shots.ts 'cinematic') still reads the buildings nearby, with
// the fog building up behind them. A camera far above the layer (the
// opening view) is out of the ramp before it reaches the fog, so it sees
// exactly the profile above. At night lit windows glow through: uFogGlow of
// whatever is brighter than the fog shows through it.
//
// Added to three's own fog chunks, so every material drawn with fog gets it
// after the far-distance haze (Atmosphere.tsx), with no extra pass. A
// material only shows it once it registers the four uniforms
// (registerHeightFog, sceneUniforms.ts); unregistered ones read zero density
// and look exactly as before. The sky dome (SkyDome.tsx) uses
// HEIGHT_FOG_GLSL directly. Zero density -- clear weather -- leaves every
// pixel exactly as it was.

export const HEIGHT_FOG_UNIFORMS = /* glsl */ `
uniform float uFogDensity; // extinction per meter at full density
uniform vec3 uFogColor;
uniform float uFogTop;     // m: no fog above this
uniform float uFogSoft;    // m: the thinning band below uFogTop
uniform float uFogRamp;    // m: from the camera, the fog ramps in over this
uniform float uFogGlow;    // 0..1: how much of a light brighter than the fog shows through
`

// fogProfileIntegral(y): the profile's integral from far below up to y, up
// to a constant; its difference over a ray's height change, divided by that
// change, is the ray's average density. Defined outside main(), so Water.js's
// local `distance` doesn't hide the builtin here.
export const HEIGHT_FOG_GLSL = /* glsl */ `
// The band and the ramp are at least 1 m: a material that never registered
// the uniforms reads 0 here, and 0 / 0 would turn its pixels black instead
// of unfogged.
float fogProfileIntegral( float y ) {
  float soft = max( uFogSoft, 1.0 );
  float thinFrom = uFogTop - soft;
  float t = clamp( y - thinFrom, 0.0, soft );
  return min( y, thinFrom ) + t - t * t / ( 2.0 * soft );
}
float heightFogAmount( vec3 from, vec3 to ) {
  float soft = max( uFogSoft, 1.0 );
  float ramp = max( uFogRamp, 1.0 );
  float d = distance( from, to );
  // A linear ramp over [0, ramp] takes away as much fog as starting the
  // full fog at ramp / 2 (or d / 2, short of the ramp's end), over this
  // length: the height average is taken from there.
  float k = 0.5 * min( d, ramp );
  float len = d < ramp ? d * d / ( 2.0 * ramp ) : d - k;
  vec3 start = from + ( to - from ) * ( d > 0.0 ? k / d : 0.0 );
  float dy = to.y - start.y;
  float level = 1.0 - clamp( ( start.y - ( uFogTop - soft ) ) / soft, 0.0, 1.0 );
  float average = abs( dy ) > 0.01 ? ( fogProfileIntegral( to.y ) - fogProfileIntegral( start.y ) ) / dy : level;
  return 1.0 - exp( -uFogDensity * average * len );
}
`

const MARK = '// city-pulse height fog'

// Installed once, at module load, before anything compiles.
if (!ShaderChunk.fog_vertex.includes(MARK)) {
  ShaderChunk.fog_pars_vertex += /* glsl */ `
${MARK}
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif
`
  // World position from the view-space one: the view matrix is a rotation
  // and a translation, so its inverse is the transpose and a shift.
  ShaderChunk.fog_vertex += /* glsl */ `
${MARK}
#ifdef USE_FOG
  vFogWorld = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );
#endif
`
  ShaderChunk.fog_pars_fragment += /* glsl */ `
${MARK}
#ifdef USE_FOG
  varying vec3 vFogWorld;
  ${HEIGHT_FOG_UNIFORMS}
  ${HEIGHT_FOG_GLSL}
#endif
`
  ShaderChunk.fog_fragment += /* glsl */ `
${MARK}
#ifdef USE_FOG
  float heightFog = heightFogAmount( cameraPosition, vFogWorld );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, uFogColor, heightFog ) +
    uFogGlow * heightFog * max( gl_FragColor.rgb - uFogColor, 0.0 );
#endif
`
}
