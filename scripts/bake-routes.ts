// Bake Muni route shapes for the cluster into src/data/routes.json, and the
// area the poller clips vehicles to into supabase/functions/_shared/.
//
//   npm run bake:routes                    download GTFS once (cached), then bake
//   npm run bake:routes -- --cached-only   never touch the network
//
// Inputs:  src/data/city.bin (boundary rings + ringMeters: the bake area,
//          and the street centerlines the shapes are snapped onto)
//          511 static GTFS for operator SF, cached in scripts/.cache/gtfs-511-sf/
//          OSM rail tunnels via Overpass (Muni Metro's subway), cached in scripts/.cache/
// Outputs: src/data/routes.json (see src/transit/routes-format.ts)
//          supabase/functions/_shared/bake-area.json
//
// The app never fetches GTFS at runtime: every 511 request counts against
// the key's shared 60/hour budget.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { COORD_QUANTUM, decodeCity } from '../src/city/format.ts'
import { ORIGIN, createProjection, toLatLng, toScene } from '../src/geo/projection.ts'
import type { Route, RouteShape, RoutesFile } from '../src/transit/routes-format.ts'
import { parseCsv } from './lib/csv.ts'
import { type Pt, type Rect, clipPolylineToRect, inBakeArea, simplifyLine } from './lib/geometry.ts'
import { fetchOverpass } from './lib/overpass.ts'
import { type Street, StreetIndex, snapRoute } from './lib/snapRoute.ts'
import { TunnelIndex, markTunnels, tunnelQuery } from './lib/tunnels.ts'
import { ensureGtfsZip, listZip, readZipText } from './lib/gtfs511.ts'

const ROOT = join(import.meta.dirname, '..')
const ROUTES_OUT = join(ROOT, 'src/data/routes.json')
const AREA_OUT = join(ROOT, 'supabase/functions/_shared/bake-area.json')

const SIMPLIFY_SHAPE_M = 2
// Shapes run this far past the bake area, so a bus right at its edge still
// projects onto its line instead of off the end.
const SHAPE_MARGIN_M = 300
const AREA_TOLERANCE_M = 0.2
const INT16_LIMIT_M = 32767 * COORD_QUANTUM

// routes.json lanes code for a stretch in a tunnel (routes-format.ts).
const SUBWAY = 4
// Light rail (GTFS route_type 0) runs in the subway; the F's streetcars
// never do, though they share Market Street above it.
const SURFACE_RAIL = new Set(['F'])

const round1 = (v: number) => Math.round(v * 10) / 10
const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

// ---------------------------------------------------------------- area

function loadBakeArea(): { rings: Pt[][]; ringMeters: number; streets: Street[] } {
  const buf = readFileSync(join(ROOT, 'src/data/city.bin'))
  const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
  const { lat, lng } = city.header.origin
  if (lat !== ORIGIN.lat || lng !== ORIGIN.lng) throw new Error('area: city.bin was baked around a different ORIGIN; rebake it first')
  const rings: Pt[][] = []
  let c = 0
  for (const n of city.boundary.counts) {
    const ring: Pt[] = []
    for (let i = 0; i < n; i++, c += 2)
      ring.push([city.boundary.coords[c] * COORD_QUANTUM, city.boundary.coords[c + 1] * COORD_QUANTUM])
    rings.push(ring)
  }
  const streets: Street[] = []
  c = 0
  city.streets.counts.forEach((n, k) => {
    const line: Pt[] = []
    for (let i = 0; i < n; i++, c += 2) line.push([city.streets.coords[c] * COORD_QUANTUM, city.streets.coords[c + 1] * COORD_QUANTUM])
    streets.push({ line, cls: city.streets.classes[k] })
  })
  return { rings, ringMeters: city.header.ringMeters, streets }
}

function shapeExtent(rings: Pt[][], pad: number): Rect {
  const xs = rings.flat().map((p) => p[0])
  const zs = rings.flat().map((p) => p[1])
  const lim = INT16_LIMIT_M - 1
  return {
    minX: Math.max(-lim, Math.min(...xs) - pad),
    minZ: Math.max(-lim, Math.min(...zs) - pad),
    maxX: Math.min(lim, Math.max(...xs) + pad),
    maxZ: Math.min(lim, Math.max(...zs) + pad),
  }
}

// ---------------------------------------------------------------- gtfs

interface ShapeUse {
  d0: number
  d1: number
}

function loadGtfs(zip: string) {
  const files = new Set(listZip(zip))
  for (const f of ['routes.txt', 'trips.txt', 'shapes.txt'])
    if (!files.has(f)) throw new Error(`gtfs: ${f} missing from the archive (has: ${[...files].join(', ')})`)

  const routes = parseCsv(readZipText(zip, 'routes.txt'))
  const feedInfo = files.has('feed_info.txt') ? parseCsv(readZipText(zip, 'feed_info.txt'))[0] : undefined

  // shape_id -> route_id -> direction counts
  const uses = new Map<string, Map<string, ShapeUse>>()
  for (const t of parseCsv(readZipText(zip, 'trips.txt'))) {
    if (!t.shape_id) continue
    let byRoute = uses.get(t.shape_id)
    if (!byRoute) uses.set(t.shape_id, (byRoute = new Map()))
    let u = byRoute.get(t.route_id)
    if (!u) byRoute.set(t.route_id, (u = { d0: 0, d1: 0 }))
    if (t.direction_id === '0') u.d0++
    else if (t.direction_id === '1') u.d1++
  }

  const shapes = new Map<string, { seq: number; p: Pt }[]>()
  for (const s of parseCsv(readZipText(zip, 'shapes.txt'))) {
    const { x, z } = toScene(Number(s.shape_pt_lat), Number(s.shape_pt_lon))
    let pts = shapes.get(s.shape_id)
    if (!pts) shapes.set(s.shape_id, (pts = []))
    pts.push({ seq: Number(s.shape_pt_sequence), p: [x, z] })
  }

  return { routes, feedInfo, uses, shapes }
}

// ---------------------------------------------------------------- main

async function main() {
  const { rings, ringMeters, streets } = loadBakeArea()
  const streetIndex = new StreetIndex(streets)
  const extent = shapeExtent(rings, ringMeters + SHAPE_MARGIN_M)
  console.log(`area: ${rings.length} rings + ${ringMeters} m; shape extent ${(extent.maxX - extent.minX).toFixed(0)} x ${(extent.maxZ - extent.minZ).toFixed(0)} m`)
  const sw = toLatLng(extent.minX, extent.maxZ)
  const ne = toLatLng(extent.maxX, extent.minZ)
  const tunnelWays = await fetchOverpass(tunnelQuery({ south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng }), undefined, {
    cachedOnly: process.argv.includes('--cached-only'),
  })
  const tunnels = new TunnelIndex(
    tunnelWays.flatMap((w) => (w.type === 'way' && w.geometry ? [w.geometry.map((g) => { const p = toScene(g.lat, g.lon); return [p.x, p.z] as Pt })] : [])),
  )
  console.log(`tunnels: ${tunnelWays.length} OSM rail tunnel ways`)

  const zip = await ensureGtfsZip({ cachedOnly: process.argv.includes('--cached-only') })
  const gtfs = loadGtfs(zip)
  console.log(`gtfs: ${gtfs.routes.length} routes, ${gtfs.shapes.size} shapes`)

  const inExtent = (p: Pt) => p[0] >= extent.minX && p[0] <= extent.maxX && p[1] >= extent.minZ && p[1] <= extent.maxZ
  const shapesByRoute = new Map<string, RouteShape[]>()
  const stats = { touching: 0, unused: 0, duplicates: 0, points: 0, snappedM: 0, totalM: 0, subwayM: 0 }
  const routeType = new Map(gtfs.routes.map((r) => [r.route_id, Number(r.route_type)]))
  const quantize = (pts: Pt[]) => pts.flatMap(([x, z]) => [Math.round(x / COORD_QUANTUM), Math.round(z / COORD_QUANTUM)])

  for (const [shapeId, raw] of [...gtfs.shapes].sort(([a], [b]) => naturalCompare(a, b))) {
    const line = raw.sort((a, b) => a.seq - b.seq).map((s) => s.p)
    if (!line.some((p) => inExtent(p) && inBakeArea(p, rings, ringMeters))) continue
    stats.touching++

    const snapped = clipPolylineToRect(line, extent).map((piece) => snapRoute(simplifyLine(piece, SIMPLIFY_SHAPE_M), streetIndex))
    // Metro routes get their tunnel stretches tagged; everything else as snapped.
    const underground = snapped.map((sn) => markTunnels(sn.pts, sn.cls, tunnels, SUBWAY))
    for (const sn of snapped)
      for (let i = 1; i < sn.pts.length; i++) {
        const len = Math.hypot(sn.pts[i][0] - sn.pts[i - 1][0], sn.pts[i][1] - sn.pts[i - 1][1])
        stats.totalM += len
        if (sn.cls[i] !== 3 && sn.cls[i - 1] !== 3) stats.snappedM += len
      }
    const byRoute = gtfs.uses.get(shapeId)
    if (!byRoute) {
      stats.unused++
      continue
    }
    for (const [routeId, u] of byRoute) {
      const metro = routeType.get(routeId) === 0 && !SURFACE_RAIL.has(routeId)
      const pieces = (metro ? underground : snapped).map((sn) => quantize(sn.pts))
      const lanes = (metro ? underground : snapped).map((sn) => sn.cls)
      if (metro)
        for (const sn of underground)
          for (let i = 1; i < sn.pts.length; i++)
            if (sn.cls[i] === SUBWAY && sn.cls[i - 1] === SUBWAY) stats.subwayM += Math.hypot(sn.pts[i][0] - sn.pts[i - 1][0], sn.pts[i][1] - sn.pts[i - 1][1])
      const direction = u.d0 === 0 && u.d1 === 0 ? null : u.d1 > u.d0 ? 1 : 0
      const list = shapesByRoute.get(routeId) ?? []
      // Variants that differ only outside the extent clip to the same lines.
      const key = JSON.stringify([direction, pieces])
      if (list.some((s) => JSON.stringify([s.direction, s.pieces]) === key)) {
        stats.duplicates++
        continue
      }
      list.push({ id: shapeId, direction, pieces, lanes })
      shapesByRoute.set(routeId, list)
    }
  }

  const routes: Route[] = gtfs.routes
    .filter((r) => shapesByRoute.has(r.route_id))
    .sort((a, b) => naturalCompare(a.route_id, b.route_id))
    .map((r) => ({
      id: r.route_id,
      shortName: r.route_short_name,
      longName: r.route_long_name,
      type: Number(r.route_type),
      color: r.route_color || null,
      shapes: shapesByRoute.get(r.route_id)!,
    }))
  for (const r of routes) for (const s of r.shapes) for (const p of s.pieces) stats.points += p.length / 2

  const file: RoutesFile = {
    version: 2,
    source: '511.org static GTFS, operator SF (SFMTA Muni)',
    feed: {
      version: gtfs.feedInfo?.feed_version || null,
      startDate: gtfs.feedInfo?.feed_start_date || null,
      endDate: gtfs.feedInfo?.feed_end_date || null,
    },
    coordQuantum: COORD_QUANTUM,
    routes,
  }
  // One route per line keeps diffs readable after a rebake.
  const { routes: _, ...head } = file
  const json = `${JSON.stringify(head).slice(0, -1)},"routes":[\n${routes.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`
  writeFileSync(ROUTES_OUT, json)

  const proj = createProjection(ORIGIN)
  const area = {
    note: 'Generated by scripts/bake-routes.ts from src/data/city.bin. Do not edit.',
    origin: ORIGIN,
    metersPerDegLat: proj.metersPerDegLat,
    metersPerDegLng: proj.metersPerDegLng,
    ringMeters,
    rings: rings.map((r) => r.flatMap(([x, z]) => [round1(x), round1(z)])),
  }
  // The deployed poller clips vehicles with this file. Rounding at a new
  // coordinate quantum (format.ts) moves its points by a few centimeters;
  // leave it alone unless something moved more than AREA_TOLERANCE_M, so
  // the repo keeps matching what's deployed.
  const committed = existsSync(AREA_OUT) ? (JSON.parse(readFileSync(AREA_OUT, 'utf8')) as typeof area) : null
  const same =
    committed !== null &&
    committed.ringMeters === area.ringMeters &&
    committed.rings.length === area.rings.length &&
    committed.rings.every((r, i) => r.length === area.rings[i].length && r.every((v, j) => Math.abs(v - area.rings[i][j]) <= AREA_TOLERANCE_M))
  mkdirSync(dirname(AREA_OUT), { recursive: true })
  if (!same) writeFileSync(AREA_OUT, `${JSON.stringify(area, null, 1).replace(/\n\s+(-?[\d.]+)(?=[,\n])/g, ' $1')}\n`)

  // ------------------------------------------------------------- report
  const byType = new Map<number, number>()
  for (const r of routes) byType.set(r.type, (byType.get(r.type) ?? 0) + 1)
  const shapeCount = routes.reduce((n, r) => n + r.shapes.length, 0)
  console.log(`\nroutes: ${routes.length} in the bake area (by route_type: ${[...byType].map(([t, n]) => `${t}=${n}`).join(', ')})`)
  console.log(`  ${routes.map((r) => r.shortName || r.id).join(' ')}`)
  console.log(`shapes: ${stats.touching} touch the area; ${shapeCount} kept, ${stats.duplicates} duplicate variants merged, ${stats.unused} unused by any trip`)
  console.log(`points: ${stats.points} after ${SIMPLIFY_SHAPE_M} m simplification, snapping and rounded corners`)
  console.log(`snapped: ${((100 * stats.snappedM) / stats.totalM).toFixed(1)}% of ${(stats.totalM / 1000).toFixed(0)} km on drawn streets`)
  console.log(`subway: ${(stats.subwayM / 1000).toFixed(1)} km of Metro shapes underground`)
  console.log(`feed: ${file.feed.version ?? '(no feed_info)'} ${file.feed.startDate ?? ''}-${file.feed.endDate ?? ''}`)
  console.log(`wrote src/data/routes.json: ${(json.length / 1024).toFixed(0)} KB (${(gzipSync(json).length / 1024).toFixed(0)} KB gzipped)`)
  console.log(same ? 'supabase/functions/_shared/bake-area.json: unchanged (within 0.2 m), left as is' : 'wrote supabase/functions/_shared/bake-area.json')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
