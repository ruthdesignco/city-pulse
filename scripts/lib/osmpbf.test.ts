import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { PbfWriter } from 'pbf'
import { describe, expect, it } from 'vitest'
import { type RawRelation, type RawWay, readOsmPbf } from './osmpbf.ts'

// Build a tiny but real .osm.pbf: OSMHeader blob, then one OSMData blob with
// a dense-node group, a way group and a relation group. Granularity is
// written AFTER the groups, as the spec allows, to catch ordering bugs.

const STRINGS = ['', 'building', 'yes', 'type', 'multipolygon', 'outer']
const NODES = [
  { id: 101, lat: 37.7897, lon: -122.3972 },
  { id: 102, lat: 37.7898, lon: -122.3971 },
  { id: 150, lat: 37.7896, lon: -122.397 },
]
const GRANULARITY = 100

function blob(type: string, payload: Uint8Array, compress = true): Buffer {
  const b = new PbfWriter()
  if (compress) {
    b.writeVarintField(2, payload.length)
    b.writeBytesField(3, deflateSync(payload))
  } else {
    b.writeBytesField(1, payload)
  }
  const blobBytes = b.finish()
  const h = new PbfWriter()
  h.writeStringField(1, type)
  h.writeVarintField(3, blobBytes.length)
  const headerBytes = h.finish()
  const len = Buffer.alloc(4)
  len.writeUInt32BE(headerBytes.length)
  return Buffer.concat([len, headerBytes, blobBytes])
}

const deltas = (xs: number[]) => xs.map((x, i) => (i === 0 ? x : x - xs[i - 1]))
const fixed = (deg: number) => Math.round((deg * 1e9) / GRANULARITY)

function samplePbf(features = ['OsmSchema-V0.6', 'DenseNodes'], replicationTimestamp?: number): string {
  const header = new PbfWriter()
  for (const f of features) header.writeStringField(4, f)
  if (replicationTimestamp !== undefined) header.writeVarintField(32, replicationTimestamp)

  const block = new PbfWriter()
  block.writeMessage(1, (_: unknown, p: PbfWriter) => STRINGS.forEach((s) => p.writeBytesField(1, new TextEncoder().encode(s))), null)
  block.writeMessage(
    2,
    (_: unknown, g: PbfWriter) =>
      g.writeMessage(
        2,
        (_2: unknown, d: PbfWriter) => {
          d.writePackedSVarint(1, deltas(NODES.map((n) => n.id)))
          d.writePackedSVarint(8, deltas(NODES.map((n) => fixed(n.lat))))
          d.writePackedSVarint(9, deltas(NODES.map((n) => fixed(n.lon))))
        },
        null,
      ),
    null,
  )
  block.writeMessage(
    2,
    (_: unknown, g: PbfWriter) =>
      g.writeMessage(
        3,
        (_2: unknown, w: PbfWriter) => {
          w.writeVarintField(1, 7000)
          w.writePackedVarint(2, [1])
          w.writePackedVarint(3, [2])
          w.writePackedSVarint(8, deltas([101, 102, 150, 101]))
        },
        null,
      ),
    null,
  )
  block.writeMessage(
    2,
    (_: unknown, g: PbfWriter) =>
      g.writeMessage(
        4,
        (_2: unknown, r: PbfWriter) => {
          r.writeVarintField(1, 9)
          r.writePackedVarint(2, [3, 1])
          r.writePackedVarint(3, [4, 2])
          r.writePackedVarint(8, [5])
          r.writePackedSVarint(9, [7000])
          r.writePackedVarint(10, [1])
        },
        null,
      ),
    null,
  )
  block.writeVarintField(17, GRANULARITY)

  const dir = mkdtempSync(join(tmpdir(), 'osmpbf-test-'))
  const file = join(dir, 'sample.osm.pbf')
  writeFileSync(file, Buffer.concat([blob('OSMHeader', header.finish(), false), blob('OSMData', block.finish())]))
  return file
}

describe('readOsmPbf', () => {
  it('decodes dense nodes with delta-coded ids and coordinates', () => {
    const nodes: [number, number, number][] = []
    readOsmPbf(samplePbf(), { node: (id, lat, lon) => nodes.push([id, lat, lon]) })
    expect(nodes.map((n) => n[0])).toEqual([101, 102, 150])
    nodes.forEach(([, lat, lon], i) => {
      expect(lat).toBeCloseTo(NODES[i].lat, 7)
      expect(lon).toBeCloseTo(NODES[i].lon, 7)
    })
  })

  it('decodes way tags and delta-coded node refs', () => {
    const ways: RawWay[] = []
    readOsmPbf(samplePbf(), { way: (w) => ways.push(w) })
    expect(ways).toEqual([{ id: 7000, tags: { building: 'yes' }, refs: [101, 102, 150, 101] }])
  })

  it('decodes relation tags, member types, refs and roles', () => {
    const rels: RawRelation[] = []
    readOsmPbf(samplePbf(), { relation: (r) => rels.push(r) })
    expect(rels).toEqual([
      { id: 9, tags: { type: 'multipolygon', building: 'yes' }, members: [{ type: 'way', ref: 7000, role: 'outer' }] },
    ])
  })

  it("returns the extract's replication timestamp, or null when it has none", () => {
    expect(readOsmPbf(samplePbf(undefined, 1792195200), {})).toEqual({ replicationTimestamp: 1792195200 })
    expect(readOsmPbf(samplePbf(), {})).toEqual({ replicationTimestamp: null })
  })

  it('refuses files that require features it cannot read', () => {
    expect(() => readOsmPbf(samplePbf(['OsmSchema-V0.6', 'Has_Metadata_Magic']), {})).toThrow(/unsupported required features/)
  })
})
