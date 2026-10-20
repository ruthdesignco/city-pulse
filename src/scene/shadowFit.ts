// Fits the sun's shadow frustum to what the camera is looking at, so the
// shadow map's texels go where they show: centered on the orbit target, its
// half-size proportional to the camera's distance from it. One fixed
// frustum over the whole city (7.2 km on a 2048 map, ~3.5 m per texel,
// blurred by VSM) smeared building shadows into blobs.
//
// The half-size moves in quantized steps and the center snaps to a coarse
// grid, so the frustum stays put while the camera orbits or drifts (a
// moving frustum makes shadow edges shimmer); it only changes on a zoom or
// a pan large enough to matter.

// Full quality; slower GPUs drop to 2048 (quality.ts).
export const SHADOW_MAP_SIZE = 4096
// Half-size per meter of camera distance: the opening view (1.8 km out,
// tilted) sees ground about 1.5x its distance beyond the target.
const FIT = 1.5
const MIN_EXTENT_M = 250
const MAX_EXTENT_M = 3600
const STEP = 1.25

export interface ShadowFit {
  center: [number, number, number]
  extent: number // half-size of the ortho frustum, meters
  texel: number // meters per shadow map texel
}

export function fitShadow(target: readonly [number, number, number], cameraDistance: number, mapSize = SHADOW_MAP_SIZE): ShadowFit {
  const want = Math.min(MAX_EXTENT_M, Math.max(MIN_EXTENT_M, cameraDistance * FIT))
  const extent = Math.min(MAX_EXTENT_M, MIN_EXTENT_M * STEP ** Math.ceil(Math.log(want / MIN_EXTENT_M) / Math.log(STEP) - 1e-9))
  const texel = (2 * extent) / mapSize
  // Snap to a grid a tenth of the frustum wide: small pans don't move it.
  const grid = extent / 5
  const snap = (v: number) => Math.round(v / grid) * grid
  return { center: [snap(target[0]), target[1], snap(target[2])], extent, texel }
}
