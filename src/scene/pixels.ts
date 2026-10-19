// Screen-space sizing for a perspective camera: how many meters one pixel
// covers at a given distance, and how much to scale an object so it never
// draws smaller than a minimum number of pixels.

const DEG = Math.PI / 180

export function metersPerPixel(distance: number, fovDeg: number, viewportHeightPx: number): number {
  return (2 * distance * Math.tan((fovDeg * DEG) / 2)) / Math.max(1, viewportHeightPx)
}

// >= 1: grows an object `sizeM` across so it spans at least `minPx` pixels.
export function minPixelScale(sizeM: number, minPx: number, distance: number, fovDeg: number, viewportHeightPx: number): number {
  return Math.max(1, (minPx * metersPerPixel(distance, fovDeg, viewportHeightPx)) / sizeM)
}
