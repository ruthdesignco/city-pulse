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
