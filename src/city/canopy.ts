import { MeshStandardMaterial } from 'three'
import type { GroundMask } from './groundMaterial.ts'
import { registerHeightFog, sceneUniforms } from '../scene/sceneUniforms.ts'
import { GREENERY_RING_SHARE, RING_DIM_MAX } from './ring.ts'
import { type Fade, withDither } from './stream/dither.ts'

// The woods' canopy at middle and far distance (stream/tileBuild.ts
// buildCanopy): in the woods' greens, fading toward the haze in the ring as
// the trees do. Faded in and out with its tile (dither.ts).
//
// Seen from afar a wood is crowns, not a sheet: up close (Trees.tsx) each
// tree's crown is lit on its sunward side and dark beneath, with shadow in
// the gaps between them. So the canopy's top is broken into domes at two
// sizes, crowns and the groves they gather in (each a jittered grid of
// cells, a dome around each cell's point): the domes tilt the normal, so a
// low sun lights one side and leaves the other dark, and the gaps between
// them are shaded. Each size fades to its average once it's under a few
// pixels, so nothing shimmers; the groves last further out. The top's own
// facets (its 20 m cells, flat-shaded) read as low-poly terrain, so it's
// shaded as level, and seen low across it, as from afar, more and more as
// the crowns' sides facing the viewer: lit as they are, by a sun behind the
// viewer or not. Over that, broad patches of lighter and darker woods.
// Leaves en masse aren't glossy: no specular, not even the grazing sheen
// that turned the canopy pale from far off.
//
// Where a tile next door shows its trees (TileStream.ts nearTrees, as far
// as they've faded in), the canopy sinks toward EDGE_KEEP of its height over
// the last EDGE_M before it, so the woods run down into the trees instead of
// ending at the tile's edge in a wall.

interface Domes {
  cellM: number
  radius: number // in cells: over half, so neighbors touch
  gap: number // shade between domes
  tilt: number // how far a dome's edge leans out, as a slope
  fullPx: number // detail from this many pixels across a dome
  gonePx: number // to none by this many
}
const CROWNS: Domes = { cellM: 9, radius: 0.62, gap: 0.4, tilt: 1.1, fullPx: 6, gonePx: 2 }
const GROVES: Domes = { cellM: 30, radius: 0.7, gap: 0.6, tilt: 0.5, fullPx: 4, gonePx: 1.5 }
// The crowns' undersides and the woods' depth, over all of it: what keeps
// a sunlit canopy as dark as the trees up close.
const DEPTH = 0.84
// Seen this low across the canopy (the view's elevation, as a sine) it's
// shaded as the crowns' sides, up to SIDE_VIEW of the way; from this high
// as their tops.
const SIDE_FROM = 0.5
const SIDE_FULL = 0.12
const SIDE_VIEW = 0
const EDGE_M = 90
const EDGE_KEEP = 0.3
// Lighter and darker woods, PATCH_M across, +-PATCH.
const PATCH_M = 70
const PATCH = 0.18

// GLSL's hash, mirrored for the averages.
const fract = (x: number) => x - Math.floor(x)
const hash2 = (x: number, y: number): [number, number] => [
  fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453),
  fract(Math.sin(x * 269.5 + y * 183.3) * 43758.5453),
]
// The shade at q (in cells): a dome over its nearest point, `gap` between.
function domeShade(d: Domes, qx: number, qy: number): number {
  const cx = Math.floor(qx)
  const cy = Math.floor(qy)
  let best = 64
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const [hx, hy] = hash2(cx + i, cy + j)
      const ox = cx + i + 0.15 + 0.7 * hx - qx
      const oy = cy + j + 0.15 + 0.7 * hy - qy
      best = Math.min(best, ox * ox + oy * oy)
    }
  const r = Math.min(1, Math.sqrt(best) / d.radius)
  return d.gap + (1 - d.gap) * Math.sqrt(1 - r * r)
}
// What a size fades to: its average over a block of cells.
export function domeAverage(d: Domes): number {
  const n = 96
  let sum = 0
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) sum += domeShade(d, ((x + 0.5) / n) * 12, ((y + 0.5) / n) * 12)
  return sum / (n * n)
}

const f = (n: number) => n.toFixed(4)

const CANOPY_PARS = /* glsl */ `
uniform vec3 uDim;
varying float vRing;
varying vec3 vCanopyWorld;
vec2 canopyHash( vec2 c ) {
  return fract( sin( vec2( dot( c, vec2( 127.1, 311.7 ) ), dot( c, vec2( 269.5, 183.3 ) ) ) ) * 43758.5453 );
}
// The nearest dome's point from q (in cells): its offset, and distance.
vec3 canopyNearest( vec2 q ) {
  vec2 cell = floor( q );
  vec2 best = vec2( 0.0 );
  float bd = 64.0;
  for ( int j = -1; j <= 1; j ++ ) {
    for ( int i = -1; i <= 1; i ++ ) {
      vec2 c = cell + vec2( float( i ), float( j ) );
      vec2 o = c + 0.15 + 0.7 * canopyHash( c ) - q;
      float d = dot( o, o );
      if ( d < bd ) { bd = d; best = o; }
    }
  }
  return vec3( best, sqrt( bd ) );
}
float canopyNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 u = fract( p );
  u = u * u * ( 3.0 - 2.0 * u );
  float a = canopyHash( i ).x, b = canopyHash( i + vec2( 1.0, 0.0 ) ).x;
  float c = canopyHash( i + vec2( 0.0, 1.0 ) ).x, d = canopyHash( i + vec2( 1.0, 1.0 ) ).x;
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
// One size of domes at p (meters), detail 0..1: its shade, and its slope
// added to tilt.
float canopyDomes( vec2 p, float cellM, float radius, float gap, float slope, float average, float detail, inout vec2 tilt ) {
  vec3 n = canopyNearest( p / cellM );
  float r = min( 1.0, n.z / radius );
  tilt += -n.xy / radius * slope * detail * step( r, 0.999 );
  return mix( average, gap + ( 1.0 - gap ) * sqrt( 1.0 - r * r ), detail );
}
`

// The canopy's vertex sunk by the trees near it: each way, how close the
// nearest tile showing its trees is (EDGE_STEPS samples out to EDGE_M), by
// how far they've faded in.
const EDGE_STEPS = 4
const CANOPY_SINK = /* glsl */ `
{
  vec2 at = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
  float near = 0.0;
  for ( int s = 0; s < ${EDGE_STEPS}; s ++ ) {
    float d = ( float( s ) + 0.5 ) * ${f(EDGE_M / EDGE_STEPS)};
    float w = 1.0 - smoothstep( 0.0, ${f(EDGE_M)}, d );
    near = max( near, w * texture2D( uNearTrees, ( at + vec2( d, 0.0 ) ) * uNearTreesUv.xy + uNearTreesUv.zw ).r );
    near = max( near, w * texture2D( uNearTrees, ( at - vec2( d, 0.0 ) ) * uNearTreesUv.xy + uNearTreesUv.zw ).r );
    near = max( near, w * texture2D( uNearTrees, ( at + vec2( 0.0, d ) ) * uNearTreesUv.xy + uNearTreesUv.zw ).r );
    near = max( near, w * texture2D( uNearTrees, ( at - vec2( 0.0, d ) ) * uNearTreesUv.xy + uNearTreesUv.zw ).r );
  }
  transformed.y -= lift * ${f(1 - EDGE_KEEP)} * near;
}
`

const domes = (d: Domes, detail: string) =>
  `canopyDomes( vCanopyWorld.xz, ${f(d.cellM)}, ${f(d.radius)}, ${f(d.gap)}, ${f(d.tilt)}, ${f(domeAverage(d))}, ${detail}, canopyTilt )`
const detail = (d: Domes) => `1.0 - smoothstep( ${f(d.cellM / d.fullPx)}, ${f(d.cellM / d.gonePx)}, canopyPx )`

// After color_fragment. Derivatives first, outside canopyNearest's branches.
const CANOPY_COLOR = /* glsl */ `
float canopyPx = length( fwidth( vCanopyWorld.xz ) );
float canopyCrownDetail = ${detail(CROWNS)};
float canopyGroveDetail = ${detail(GROVES)};
vec2 canopyTilt = vec2( 0.0 );
float canopyShade = ${domes(CROWNS, 'canopyCrownDetail')} * ${domes(GROVES, 'canopyGroveDetail')};
canopyShade *= ${f(DEPTH)} * ( 1.0 + ${f(PATCH)} * ( 2.0 * canopyNoise( vCanopyWorld.xz / ${f(PATCH_M)} ) - 1.0 ) );
// The shade over the ring's fade too: crowns shadow the haze as well.
diffuseColor.rgb = mix( diffuseColor.rgb, uDim, ${f(RING_DIM_MAX * GREENERY_RING_SHARE)} * smoothstep( 0.0, 1.0, vRing ) ) * canopyShade;
`

// After normal_fragment_maps (normal in view space, the flat face's): the
// tops shaded as level, plus the domes' slope, leaning toward the viewer
// when seen low across.
const CANOPY_NORMAL = /* glsl */ `
{
  vec3 worldNormal = ( vec4( normal, 0.0 ) * viewMatrix ).xyz;
  float onTop = smoothstep( 0.7, 0.9, worldNormal.y );
  vec3 toEye = normalize( cameraPosition - vCanopyWorld );
  vec3 side = normalize( vec3( toEye.x, 0.0, toEye.z ) + vec3( canopyTilt.x, 0.0, canopyTilt.y ) );
  vec3 top = normalize( vec3( canopyTilt.x, 1.0, canopyTilt.y ) );
  float low = ${f(SIDE_VIEW)} * ( 1.0 - smoothstep( ${f(SIDE_FULL)}, ${f(SIDE_FROM)}, toEye.y ) );
  vec3 shaded = normalize( mix( top, side, low ) );
  normal = normalize( mix( normal, mat3( viewMatrix ) * shaded, onTop ) );
}
`

// After lights_physical_fragment.
const CANOPY_MATTE = /* glsl */ `
material.specularColorBlended = vec3( 0.0 );
material.specularF90 = 0.0;
`

export function canopyMaterial(fade: Fade, dither: boolean, nearTrees: GroundMask): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true })
  material.onBeforeCompile = (shader) => {
    registerHeightFog(shader)
    shader.uniforms.uFade = fade
    shader.uniforms.uDim = sceneUniforms.uHaze
    shader.uniforms.uNearTrees = { value: nearTrees.texture }
    shader.uniforms.uNearTreesUv = { value: nearTrees.uv }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float ring;\nattribute float lift;\nuniform sampler2D uNearTrees;\nuniform vec4 uNearTreesUv;\nvarying float vRing;\nvarying vec3 vCanopyWorld;',
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${CANOPY_SINK}\nvRing = ring;\nvCanopyWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CANOPY_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${CANOPY_COLOR}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${CANOPY_NORMAL}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${CANOPY_MATTE}`)
    shader.fragmentShader = withDither(shader.fragmentShader, dither)
  }
  material.customProgramCacheKey = () => `city-canopy-v2${dither ? '-dither' : ''}`
  return material
}
