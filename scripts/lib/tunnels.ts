// Where Muni Metro runs underground: OpenStreetMap's rail tunnels (the
// Market Street subway, the Twin Peaks tunnel, the Central Subway under 4th
// Street, the Sunset tunnel), for bake-routes.ts to tag the stretches of
// Metro route shapes inside them. The scene draws a train there as a faint
// marker on the street above, not on the street (Vehicles.tsx).

import type { Bbox } from './overpass.ts'
import type { Pt } from './geometry.ts'

export function tunnelQuery(b: Bbox): string {
  const bb = `${b.south},${b.west},${b.north},${b.east}`
  return `[out:json][timeout:120];
(
  way["railway"~"^(subway|light_rail|tram)$"]["tunnel"]["tunnel"!="no"](${bb});
);
out tags geom;`
}

// A shape point is in a tunnel when a tunnel's track runs within TUNNEL_M of
// it, the same way (within ALIGN_DEG). The shapes are snapped to the street
// above, and the subway runs under the street, a few meters to either side.
export const TUNNEL_M = 20
const ALIGN_DEG = 30
const STEP_M = 5
// A surface gap shorter than MIN_SURFACE_M between two tunnel stretches is
// the tunnel's tracks briefly out of reach (a junction, a station's tail
// tracks): still underground. (The real surface stretch between the N's
// two portals, on Duboce, is 450 m.) A tunnel stretch shorter than
// MIN_TUNNEL_M is a road overpass or a short underpass tagged as tunnel,
// not the subway.
const MIN_SURFACE_M = 200
const MIN_TUNNEL_M = 80
const CELL_M = 50

interface Seg {
  ax: number
  az: number
  ux: number
  uz: number
  len: number
}

export class TunnelIndex {
  private readonly segs: Seg[] = []
  private readonly grid = new Map<string, number[]>()

  constructor(lines: Pt[][]) {
    for (const line of lines)
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i]
        const [bx, bz] = line[i + 1]
        const len = Math.hypot(bx - ax, bz - az)
        if (len < 1e-6) continue
        const id = this.segs.push({ ax, az, ux: (bx - ax) / len, uz: (bz - az) / len, len }) - 1
        for (let x = Math.floor((Math.min(ax, bx) - TUNNEL_M) / CELL_M); x <= Math.floor((Math.max(ax, bx) + TUNNEL_M) / CELL_M); x++)
          for (let z = Math.floor((Math.min(az, bz) - TUNNEL_M) / CELL_M); z <= Math.floor((Math.max(az, bz) + TUNNEL_M) / CELL_M); z++) {
            const key = `${x},${z}`
            const list = this.grid.get(key)
            if (list) list.push(id)
            else this.grid.set(key, [id])
          }
      }
  }

  // Is the point (x, z), heading (ux, uz), over a tunnel?
  covers(x: number, z: number, ux: number, uz: number): boolean {
    const cos = Math.cos((ALIGN_DEG * Math.PI) / 180)
    for (const id of this.grid.get(`${Math.floor(x / CELL_M)},${Math.floor(z / CELL_M)}`) ?? []) {
      const s = this.segs[id]
      if (Math.abs(s.ux * ux + s.uz * uz) < cos) continue
      const t = Math.min(s.len, Math.max(0, (x - s.ax) * s.ux + (z - s.az) * s.uz))
      if (Math.hypot(x - s.ax - s.ux * t, z - s.az - s.uz * t) <= TUNNEL_M) return true
    }
    return false
  }
}

// Tag a shape's underground stretches: `cls` becomes `underground` there.
// A vertex is added wherever the line goes in or out (to STEP_M), so the
// change happens at the portal, not somewhere along a long straight segment.
export function markTunnels(pts: Pt[], cls: number[], tunnels: TunnelIndex, underground: number): { pts: Pt[]; cls: number[] } {
  const outPts: Pt[] = []
  const outCls: number[] = []
  const street: number[] = [] // each output vertex's class on the surface
  const inside = (p: Pt, ux: number, uz: number) => tunnels.covers(p[0], p[1], ux, uz)
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i]
    const next = pts[i + 1]
    const prev = pts[i - 1]
    const [dx, dz] = next ? [next[0] - ax, next[1] - az] : [ax - prev[0], az - prev[1]]
    const len = Math.hypot(dx, dz) || 1
    const ux = dx / len
    const uz = dz / len
    let under = inside(pts[i], ux, uz)
    outPts.push(pts[i])
    outCls.push(under ? underground : cls[i])
    street.push(cls[i])
    if (!next) break
    // Walk the segment for the portals along it.
    for (let t = STEP_M; t < len; t += STEP_M) {
      const p: Pt = [ax + ux * t, az + uz * t]
      const now = inside(p, ux, uz)
      if (now === under) continue
      under = now
      outPts.push(p)
      outCls.push(now ? underground : cls[i + 1])
      street.push(cls[i + 1])
    }
  }
  // Fill short surface gaps, then drop short tunnels.
  const runs = () => {
    const out: { from: number; to: number; under: boolean; len: number }[] = []
    for (let i = 0; i < outCls.length; ) {
      const under = outCls[i] === underground
      let j = i
      let len = 0
      while (j + 1 < outCls.length && (outCls[j + 1] === underground) === under) j++
      // A run reaches to where the next one starts.
      for (let k = i; k < Math.min(j + 1, outPts.length - 1); k++) len += Math.hypot(outPts[k + 1][0] - outPts[k][0], outPts[k + 1][1] - outPts[k][1])
      out.push({ from: i, to: j, under, len })
      i = j + 1
    }
    return out
  }
  runs().forEach((r, k, all) => {
    if (!r.under && k > 0 && k < all.length - 1 && r.len < MIN_SURFACE_M) for (let i = r.from; i <= r.to; i++) outCls[i] = underground
  })
  for (const r of runs()) if (r.under && r.len < MIN_TUNNEL_M) for (let i = r.from; i <= r.to; i++) outCls[i] = street[i]
  return { pts: outPts, cls: outCls }
}
