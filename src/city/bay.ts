// San Francisco Bay, as water to the north and east of the city: one
// polygon whose near edge is the real waterfront (approximate bulkhead line,
// hand-placed from map coordinates, ~50-100 m accuracy) and whose far edge
// sits well past the fog's far distance, so it's never seen. The piers in
// city.bin stand out over it, as the real ones do. South and west the city
// carries on over land (palette.ground) into the haze.
//
// Points run from the Presidio's shore east along the north waterfront,
// down the Embarcadero and Mission Bay to Islais Creek and Hunters Point,
// then out around the open bay and back.

import { toScene } from '../geo/projection.ts'

export type LatLngPt = [number, number] // [lat, lng]

export const SHORELINE: LatLngPt[] = [
  [37.8065, -122.4655], // Crissy Field
  [37.8073, -122.4455], // Marina Green
  [37.8075, -122.4335], // Fort Mason
  [37.8072, -122.4225], // Aquatic Park
  [37.8092, -122.4155], // Fisherman's Wharf
  [37.8094, -122.4095], // Pier 39
  [37.8065, -122.404], // Pier 33
  [37.8035, -122.4005], // Pier 27
  [37.8, -122.3975], // Pier 15
  [37.7968, -122.395], // Pier 7
  [37.7957, -122.3934], // Ferry Building
  [37.792, -122.3897], // Pier 14
  [37.788, -122.3875], // Rincon Point
  [37.784, -122.387], // Pier 28
  [37.78, -122.3868], // Pier 30-32
  [37.7768, -122.3876], // Mission Creek mouth
  [37.772, -122.3858], // Pier 48
  [37.766, -122.385], // Pier 50-54
  [37.76, -122.3835], // Pier 70
  [37.7535, -122.3832], // Pier 70 south
  [37.748, -122.38], // Pier 80
  [37.743, -122.3825], // Islais Creek
  [37.738, -122.374], // Pier 94
  [37.728, -122.368], // Hunters Point
]

// The open bay, far past the fog's 8 km far distance, back to the start.
const OPEN_WATER: LatLngPt[] = [
  [37.68, -122.3],
  [37.75, -122.2],
  [37.88, -122.25],
  [37.92, -122.4],
  [37.86, -122.48],
]

// The water's outline in scene meters, [x, z].
export function bayOutline(): [number, number][] {
  return [...SHORELINE, ...OPEN_WATER].map(([lat, lng]) => {
    const { x, z } = toScene(lat, lng)
    return [x, z]
  })
}

// Even-odd point-in-polygon on bayOutline(), for tests and checks.
export function inBay(x: number, z: number, outline = bayOutline()): boolean {
  let inside = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, zi] = outline[i]
    const [xj, zj] = outline[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
