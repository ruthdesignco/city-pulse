// Screen-space sizing for a perspective camera: how many meters one pixel
// covers at a given distance.

const DEG = Math.PI / 180

export function metersPerPixel(distance: number, fovDeg: number, viewportHeightPx: number): number {
  return (2 * distance * Math.tan((fovDeg * DEG) / 2)) / Math.max(1, viewportHeightPx)
}
