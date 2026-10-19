// Golden-hour sun: a fixed, art-directed position, not live solar tracking
// (SPEC.md decision log). Chosen from San Francisco's real October sunset
// bearing, late enough in golden hour to be warm and low without reading as
// near-black. Shared by Atmosphere's light and, if ever needed, a shadow
// camera framed around the same direction.

const DEG = Math.PI / 180

// Compass bearing (0=N, 90=E, 180=S, 270=W) and elevation above the horizon
// -> a scene-space direction, matching src/geo/projection.ts's axes: north
// is -z, east is +x, y is up.
export function bearingToScene(azimuthDeg: number, elevationDeg: number, distance: number): [number, number, number] {
  const theta = azimuthDeg * DEG
  const phi = elevationDeg * DEG
  const horiz = distance * Math.cos(phi)
  return [horiz * Math.sin(theta), distance * Math.sin(phi), -horiz * Math.cos(theta)]
}

// ~258°: SF's sunset bearing in October, WSW (equinox is 270° due west,
// winter solstice ~242°). ~16° above the horizon: low and warm, raised a
// touch from the first pass' 12 deg -- that read too dark on the ground
// (grazing light only, N.L ~ sin(elevation) ~ 0.2 at 12 deg) once actually
// screenshotted.
export const SUN_AZIMUTH_DEG = 258
export const SUN_ELEVATION_DEG = 16
export const SUN_DISTANCE = 3400

export const SUN_POSITION = bearingToScene(SUN_AZIMUTH_DEG, SUN_ELEVATION_DEG, SUN_DISTANCE)
