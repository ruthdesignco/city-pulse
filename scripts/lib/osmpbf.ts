// Minimal streaming reader for OpenStreetMap .osm.pbf files
// (https://wiki.openstreetmap.org/wiki/PBF_Format), built on Mapbox's `pbf`
// protobuf reader and node:zlib. Reads only what the city bake needs:
// node coordinates, way tags/refs, relation tags/members.

import { closeSync, openSync, readSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { PbfReader } from 'pbf'

export interface RawWay {
  id: number
  tags: Record<string, string>
  refs: number[]
}

export interface RawMember {
  type: 'node' | 'way' | 'relation'
  ref: number
  role: string
}

export interface RawRelation {
  id: number
  tags: Record<string, string>
  members: RawMember[]
}

export interface PbfHandlers {
  node?: (id: number, lat: number, lon: number) => void
  way?: (way: RawWay) => void
  relation?: (relation: RawRelation) => void
}

const SUPPORTED_FEATURES = new Set(['OsmSchema-V0.6', 'DenseNodes'])
const MEMBER_TYPES = ['node', 'way', 'relation'] as const

function readExactly(fd: number, length: number, position: number): Buffer {
  const buf = Buffer.allocUnsafe(length)
  let got = 0
  while (got < length) {
    const n = readSync(fd, buf, got, length - got, position + got)
    if (n === 0) throw new Error(`osmpbf: unexpected end of file at byte ${position + got}`)
    got += n
  }
  return buf
}

function decodeBlob(bytes: Uint8Array): Uint8Array {
  const blob = new PbfReader(bytes).readFields(
    (tag, b: { raw?: Uint8Array; zlib?: Uint8Array; other?: number }, pbf) => {
      if (tag === 1) b.raw = pbf.readBytes()
      else if (tag === 3) b.zlib = pbf.readBytes()
      else if (tag === 4 || tag === 6 || tag === 7) b.other = tag // lzma / lz4 / zstd
    },
    {},
  )
  if (blob.raw) return blob.raw
  if (blob.zlib) return inflateSync(blob.zlib)
  throw new Error(`osmpbf: unsupported blob compression (field ${blob.other ?? 'none'})`)
}

// The OSMHeader block: checks the features we must support, and returns the
// extract's replication timestamp (field 32, seconds), the date its OSM data
// is current to, when the file has one.
function readHeader(bytes: Uint8Array): { replicationTimestamp: number | null } {
  const required: string[] = []
  let replicationTimestamp: number | null = null
  new PbfReader(bytes).readFields((tag, _r, pbf) => {
    if (tag === 4) required.push(pbf.readString())
    else if (tag === 32) replicationTimestamp = pbf.readVarint()
  }, null)
  const unsupported = required.filter((f) => !SUPPORTED_FEATURES.has(f))
  if (unsupported.length) throw new Error(`osmpbf: unsupported required features: ${unsupported.join(', ')}`)
  return { replicationTimestamp }
}

function tagsOf(keys: number[], vals: number[], strings: string[]): Record<string, string> {
  const tags: Record<string, string> = {}
  for (let i = 0; i < keys.length; i++) tags[strings[keys[i]]] = strings[vals[i]]
  return tags
}

function decodePrimitiveBlock(bytes: Uint8Array, h: PbfHandlers) {
  // Granularity and offsets may be encoded after the groups, so collect
  // everything first and decode the groups afterwards.
  const block = { strings: [] as string[], groups: [] as [number, number][], gran: 100, latOff: 0, lonOff: 0 }
  const pbf = new PbfReader(bytes)
  pbf.readFields((tag, b, p) => {
    if (tag === 1) {
      const end = p.readVarint() + p.pos
      while (p.pos < end) {
        const key = p.readVarint() >> 3
        const len = p.readVarint()
        if (key === 1) b.strings.push(new TextDecoder().decode(p.buf.subarray(p.pos, p.pos + len)))
        p.pos += len
      }
    } else if (tag === 2) {
      const end = p.readVarint() + p.pos
      b.groups.push([p.pos, end])
      p.pos = end
    } else if (tag === 17) b.gran = p.readVarint()
    else if (tag === 19) b.latOff = p.readVarint(true)
    else if (tag === 20) b.lonOff = p.readVarint(true)
  }, block)

  const toDeg = (v: number, off: number) => 1e-9 * (off + block.gran * v)

  for (const [start, end] of block.groups) {
    pbf.pos = start
    pbf.readFields(
      (tag, _r, p) => {
        if (tag === 2 && h.node) {
          // DenseNodes: delta-coded ids and coordinates.
          const d = p.readFields(
            (t, x: { ids: number[]; lats: number[]; lons: number[] }, q) => {
              if (t === 1) q.readPackedSVarint(x.ids)
              else if (t === 8) q.readPackedSVarint(x.lats)
              else if (t === 9) q.readPackedSVarint(x.lons)
            },
            { ids: [], lats: [], lons: [] },
            p.readVarint() + p.pos,
          )
          let id = 0
          let lat = 0
          let lon = 0
          for (let i = 0; i < d.ids.length; i++) {
            id += d.ids[i]
            lat += d.lats[i]
            lon += d.lons[i]
            h.node(id, toDeg(lat, block.latOff), toDeg(lon, block.lonOff))
          }
        } else if (tag === 1 && h.node) {
          const n = p.readFields(
            (t, x: { id: number; lat: number; lon: number }, q) => {
              if (t === 1) x.id = q.readSVarint()
              else if (t === 8) x.lat = q.readSVarint()
              else if (t === 9) x.lon = q.readSVarint()
            },
            { id: 0, lat: 0, lon: 0 },
            p.readVarint() + p.pos,
          )
          h.node(n.id, toDeg(n.lat, block.latOff), toDeg(n.lon, block.lonOff))
        } else if (tag === 3 && h.way) {
          const w = p.readFields(
            (t, x: { id: number; keys: number[]; vals: number[]; refs: number[] }, q) => {
              if (t === 1) x.id = q.readVarint()
              else if (t === 2) q.readPackedVarint(x.keys)
              else if (t === 3) q.readPackedVarint(x.vals)
              else if (t === 8) q.readPackedSVarint(x.refs)
            },
            { id: 0, keys: [], vals: [], refs: [] },
            p.readVarint() + p.pos,
          )
          for (let i = 1; i < w.refs.length; i++) w.refs[i] += w.refs[i - 1]
          h.way({ id: w.id, tags: tagsOf(w.keys, w.vals, block.strings), refs: w.refs })
        } else if (tag === 4 && h.relation) {
          const r = p.readFields(
            (t, x: { id: number; keys: number[]; vals: number[]; roles: number[]; ids: number[]; types: number[] }, q) => {
              if (t === 1) x.id = q.readVarint()
              else if (t === 2) q.readPackedVarint(x.keys)
              else if (t === 3) q.readPackedVarint(x.vals)
              else if (t === 8) q.readPackedVarint(x.roles)
              else if (t === 9) q.readPackedSVarint(x.ids)
              else if (t === 10) q.readPackedVarint(x.types)
            },
            { id: 0, keys: [], vals: [], roles: [], ids: [], types: [] },
            p.readVarint() + p.pos,
          )
          let ref = 0
          const members = r.ids.map((delta, i) => {
            ref += delta
            return { type: MEMBER_TYPES[r.types[i]], ref, role: block.strings[r.roles[i]] }
          })
          h.relation({ id: r.id, tags: tagsOf(r.keys, r.vals, block.strings), members })
        }
      },
      null,
      end,
    )
  }
}

// Streams the file blob by blob; memory stays at one decompressed block.
// Returns the header's replication timestamp (seconds), or null.
export function readOsmPbf(path: string, h: PbfHandlers): { replicationTimestamp: number | null } {
  let replicationTimestamp: number | null = null
  const fd = openSync(path, 'r')
  try {
    let pos = 0
    let sawHeader = false
    for (;;) {
      const lenBuf = Buffer.allocUnsafe(4)
      if (readSync(fd, lenBuf, 0, 4, pos) < 4) break
      const headerLen = lenBuf.readUInt32BE(0)
      pos += 4
      const header = new PbfReader(readExactly(fd, headerLen, pos)).readFields(
        (tag, x: { type: string; size: number }, p) => {
          if (tag === 1) x.type = p.readString()
          else if (tag === 3) x.size = p.readVarint()
        },
        { type: '', size: 0 },
      )
      pos += headerLen
      const data = decodeBlob(readExactly(fd, header.size, pos))
      pos += header.size
      if (header.type === 'OSMHeader') {
        replicationTimestamp = readHeader(data).replicationTimestamp
        sawHeader = true
      } else if (header.type === 'OSMData') {
        if (!sawHeader) throw new Error('osmpbf: OSMData before OSMHeader')
        decodePrimitiveBlock(data, h)
      }
    }
  } finally {
    closeSync(fd)
  }
  return { replicationTimestamp }
}
