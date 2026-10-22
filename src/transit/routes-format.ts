// src/data/routes.json: Muni route shapes for interpolation, baked by
// scripts/bake-routes.ts from 511's static GTFS, so the app never fetches
// GTFS at runtime. Coordinates are integers in COORD_QUANTUM meters,
// interleaved x,z in scene space (src/geo/projection.ts).
// Version 2: shapes are snapped onto the drawn streets' centerlines, with
// rounded corners (scripts/lib/snapRoute.ts), and carry each vertex's
// street class.

export interface RouteShape {
  id: string
  // GTFS direction_id of the trips that use this shape (majority), if any.
  direction: 0 | 1 | null
  // Runs inside the baked extent: [x0, z0, x1, z1, ...]. A shape that leaves
  // the extent and comes back has more than one.
  pieces: number[][]
  // Per vertex of each piece, the class of the drawn street it's snapped to
  // (StreetClass: 0 major, 1 minor, 2 local), 3 where it follows no drawn
  // street, or 4 in a Muni Metro tunnel (the train is underground there);
  // for the lane offset (lanes.ts).
  lanes: number[][]
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
  version: 2
  source: string
  feed: { version: string | null; startDate: string | null; endDate: string | null }
  coordQuantum: number
  routes: Route[]
}
