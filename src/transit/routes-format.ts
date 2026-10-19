// public/routes.json: Muni route shapes for interpolation, baked by
// scripts/bake-routes.ts from 511's static GTFS, so the app never fetches
// GTFS at runtime. Coordinates are integers in COORD_QUANTUM meters,
// interleaved x,z in scene space (src/geo/projection.ts), like city.bin.

export interface RouteShape {
  id: string
  // GTFS direction_id of the trips that use this shape (majority), if any.
  direction: 0 | 1 | null
  // Runs inside the baked extent: [x0, z0, x1, z1, ...]. A shape that leaves
  // the extent and comes back has more than one.
  pieces: number[][]
}

export interface Route {
  id: string // GTFS route_id, as used by the 511 GTFS-RT feed
  shortName: string
  longName: string
  type: number // GTFS route_type: 0 light rail / streetcar, 3 bus, 5 cable car
  color: string | null // hex without '#'
  shapes: RouteShape[]
}

export interface RoutesFile {
  version: 1
  source: string
  feed: { version: string | null; startDate: string | null; endDate: string | null }
  coordQuantum: number
  routes: Route[]
}
