// Load OSM data for the bake from a Geofabrik .osm.pbf extract, as an
// alternative to Overpass. One streaming pass (PBF order is nodes, ways,
// relations), then assembly into the same OsmElement shape the Overpass path
// produces, so the rest of the bake is unchanged.

import type { Bbox, OsmElement, OsmGeomPoint } from './overpass.ts'
import { type RawRelation, type RawWay, readOsmPbf } from './osmpbf.ts'

// Matches the highway filter in overpass.ts cityQuery.
const HIGHWAYS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
])

// Capture nodes a little beyond the bake bbox so buildings and relation
// members straddling its edge stay complete. ~0.003 deg is ~300 m here.
const NODE_MARGIN_DEG = 0.003

const isBuilding = (t: Record<string, string>) => !!t.building || !!t['building:part']
const isMultipolygonBuilding = (t: Record<string, string>) => t.type === 'multipolygon' && isBuilding(t)

// Also returns the extract's OSM data date (its header's replication
// timestamp), as an ISO string, or null if the file has none.
export function loadFromPbf(pbfPath: string, b: Bbox): { elements: OsmElement[]; osmTimestamp: string | null } {
  const started = Date.now()
  const s = b.south - NODE_MARGIN_DEG
  const n = b.north + NODE_MARGIN_DEG
  const w = b.west - NODE_MARGIN_DEG
  const e = b.east + NODE_MARGIN_DEG

  const coords = new Map<number, OsmGeomPoint>()
  const ways = new Map<number, RawWay>() // every way touching captured nodes (relation members are often untagged)
  const relations: RawRelation[] = []
  let nodesSeen = 0

  const { replicationTimestamp } = readOsmPbf(pbfPath, {
    node(id, lat, lon) {
      if (++nodesSeen % 20_000_000 === 0) console.log(`pbf: ${nodesSeen / 1e6}M nodes read...`)
      if (lat >= s && lat <= n && lon >= w && lon <= e) coords.set(id, { lat, lon })
    },
    way(way) {
      if (way.refs.some((r) => coords.has(r))) ways.set(way.id, way)
    },
    relation(rel) {
      if (isMultipolygonBuilding(rel.tags) && rel.members.some((m) => m.type === 'way' && ways.has(m.ref))) {
        relations.push(rel)
      }
    },
  })
  console.log(
    `pbf: read ${(nodesSeen / 1e6).toFixed(1)}M nodes in ${((Date.now() - started) / 1000).toFixed(0)}s; ` +
      `kept ${coords.size} nodes, ${ways.size} ways, ${relations.length} building relations`,
  )

  const geometryOf = (way: RawWay): OsmGeomPoint[] | undefined => {
    const g: OsmGeomPoint[] = []
    for (const r of way.refs) {
      const c = coords.get(r)
      if (!c) return undefined
      g.push(c)
    }
    return g
  }

  const out: OsmElement[] = []
  let incompleteBuildings = 0
  for (const way of ways.values()) {
    if (isBuilding(way.tags)) {
      const geometry = geometryOf(way)
      if (geometry) out.push({ type: 'way', id: way.id, tags: way.tags, geometry })
      else incompleteBuildings++
    } else if (HIGHWAYS.has(way.tags.highway)) {
      // Streets may run past the captured area: keep each contiguous run of
      // known nodes as its own line rather than bridging the gap.
      let run: OsmGeomPoint[] = []
      const flush = () => {
        if (run.length >= 2) out.push({ type: 'way', id: way.id, tags: way.tags, geometry: run })
        run = []
      }
      for (const r of way.refs) {
        const c = coords.get(r)
        if (c) run.push(c)
        else flush()
      }
      flush()
    }
  }

  let incompleteMembers = 0
  for (const rel of relations) {
    const members: { type: string; ref: number; role: string; geometry?: OsmGeomPoint[] }[] = []
    for (const m of rel.members) {
      if (m.type !== 'way') continue
      const way = ways.get(m.ref)
      const geometry = way && geometryOf(way)
      if (!geometry) incompleteMembers++
      members.push({ type: 'way', ref: m.ref, role: m.role, geometry })
    }
    out.push({ type: 'relation', id: rel.id, tags: rel.tags, members })
  }

  if (incompleteBuildings || incompleteMembers) {
    console.warn(
      `pbf: ${incompleteBuildings} building ways and ${incompleteMembers} relation member ways had nodes outside the captured area (dropped)`,
    )
  }
  return { elements: out, osmTimestamp: replicationTimestamp === null ? null : new Date(replicationTimestamp * 1000).toISOString() }
}
