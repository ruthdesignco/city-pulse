// Shown whenever ?time= pins the light, so a recording or a screenshot never
// passes a set time of day off as now (the data stays live; only the light
// is set). Never hidden by the overlay toggle, like the Recorded badge.
export function LightNote({ label }: { label: string }) {
  return (
    <div className="light-note" role="status">
      Light set to {label} (San Francisco time)
    </div>
  )
}

// The same for ?weather=: the fog or clouds on screen are set, not the
// live NWS report.
export function WeatherNote({ preset }: { preset: string }) {
  return (
    <div className="light-note" role="status">
      Weather set to {preset}
    </div>
  )
}

// And for ?wind=: the water and the trees move to a set wind.
export function WindNote({ preset }: { preset: string }) {
  return (
    <div className="light-note" role="status">
      Wind set to {preset}
    </div>
  )
}

// Some of the city's tiles keep failing to load (TileStream.ts stuckTiles):
// they show as plain far blocks until a retry gets them, and the page says
// so instead of passing them off as the city.
export function TilesNote({ count }: { count: number }) {
  return (
    <div className="light-note" role="status">
      Part of the city didn't load ({count} {count === 1 ? 'area' : 'areas'} shown simplified); retrying
    </div>
  )
}
