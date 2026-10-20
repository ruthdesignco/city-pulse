// Lat/lng <-> scene meters for City Pulse.
//
// One shared module: the city bake, the bus layer and the incident layer must
// all project through here so everything lands in the same frame.
//
// Method: a local tangent plane (equirectangular) around a fixed origin, using
// the WGS84 ellipsoid's radii of curvature at the origin latitude:
//
//   N = a / sqrt(1 - e^2 sin^2 lat0)                 prime vertical (east-west)
//   M = a (1 - e^2) / (1 - e^2 sin^2 lat0)^(3/2)     meridional (north-south)
//   x =  N cos(lat0) * dLng     meters east
//   z = -M * dLat               meters north is -z (three.js: y up)
//
// Over the ~4 km cluster plus context ring, scale drifts by about
// tan(lat0) * dLat, roughly 0.05% (~2 m at the far edge). Web Mercator would
// instead inflate every distance ~26% at this latitude.

export interface LatLng {
  lat: number
  lng: number
}

export interface ScenePoint {
  x: number
  z: number
}

// Area-weighted centroid of the SoMa, Mission and Tenderloin Analysis
// Neighborhoods polygons (37.76778, -122.41279), rounded. Changing it means
// rebaking src/data/city.bin. Never hard-code this elsewhere; import it.
export const ORIGIN: LatLng = { lat: 37.768, lng: -122.413 }

const WGS84_A = 6378137
const WGS84_E2 = 0.00669437999014
const DEG = Math.PI / 180

export function createProjection(origin: LatLng) {
  const sin = Math.sin(origin.lat * DEG)
  const w = 1 - WGS84_E2 * sin * sin
  const n = WGS84_A / Math.sqrt(w)
  const m = (WGS84_A * (1 - WGS84_E2)) / (w * Math.sqrt(w))

  const metersPerDegLat = m * DEG
  const metersPerDegLng = n * Math.cos(origin.lat * DEG) * DEG

  return {
    origin,
    metersPerDegLat,
    metersPerDegLng,
    toScene(lat: number, lng: number): ScenePoint {
      return {
        x: (lng - origin.lng) * metersPerDegLng,
        z: -(lat - origin.lat) * metersPerDegLat,
      }
    },
    toLatLng(x: number, z: number): LatLng {
      return {
        lat: origin.lat - z / metersPerDegLat,
        lng: origin.lng + x / metersPerDegLng,
      }
    },
  }
}

const projection = createProjection(ORIGIN)

export const toScene = projection.toScene
export const toLatLng = projection.toLatLng
