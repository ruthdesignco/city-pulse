// Which model draws a vehicle. Rail and cable cars come from the route's GTFS
// route_type (routes.json). Bus length comes from the vehicle's fleet number:
// the 511 feed's vehicle id is Muni's fleet number (checked 2026-10-19
// against the stored ids: 6500s and 7200s run the 7, 8, 14, 38, 49, 5R, 30;
// 5700s and 8000s the 40 ft routes), and routes alone can't say it -- the 38
// runs both lengths.
//
// 60 ft series, from the fleet roster at
// https://en.wikipedia.org/wiki/San_Francisco_Municipal_Railway_fleet
// (community maintained, read 2026-10-19):
//   6500-6554, 6560-6697, 6700-6730   New Flyer XDE60, diesel-electric hybrid
//   7201-7293                         New Flyer XT60, trolley
// Every other bus is drawn as a 40 ft bus (XT40 5701-5885, XDE40 8601-8969,
// and anything newer: the 2025 order was 40 ft buses).

export type VehicleKind = 'bus40' | 'bus60' | 'rail' | 'cable'

const SIXTY_FOOT: [number, number][] = [
  [6500, 6554],
  [6560, 6697],
  [6700, 6730],
  [7201, 7293],
]

export function isSixtyFoot(vehicleId: string): boolean {
  if (!/^\d{1,5}$/.test(vehicleId)) return false
  const n = Number(vehicleId)
  return SIXTY_FOOT.some(([lo, hi]) => n >= lo && n <= hi)
}

// routeType: GTFS route_type, undefined when the route isn't in routes.json.
export function vehicleKind(routeType: number | undefined, vehicleId: string): VehicleKind {
  if (routeType === 0) return 'rail' // light rail and streetcars, the F's historic cars included
  if (routeType === 5) return 'cable'
  return isSixtyFoot(vehicleId) ? 'bus60' : 'bus40'
}
