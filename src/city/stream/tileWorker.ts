// The tile worker: decodes tiles' files (once each, kept) and builds what
// they draw (tileBuild.ts) off the page's thread, handing back the arrays
// without copying them (transferred). TileStream.ts sends the jobs, most
// wanted first, and fetches the files they need when asked (`need`): once
// for every worker, in the jobs' order, so a link's bandwidth goes to what's
// wanted most (fetched here, every job's files at once split it, and the
// far file came in last).

import type { CityIndex, TileEntry, TileLayer } from '../cityIndex.ts'
import { decodeFar } from '../farFormat.ts'
import { type CityTile, decodeTile, toLines } from '../format.ts'
import { type Terrain, decodeTerrain } from '../terrain.ts'
import { type TreesData, decodeTrees } from '../treeFormat.ts'
import type { JobKind, ToPage, ToWorker } from './protocol.ts'
import { type TileContext, buildBase, buildFar, buildMid, buildNear, groundMesh, tileKey } from './tileBuild.ts'

let index: CityIndex | null = null
let ctx: TileContext | null = null
const entries = new Map<string, TileEntry>()
const loading = new Map<string, Promise<unknown>>()

const post = (m: ToPage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

const asked = new Map<string, { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void }>()

function fetchFile(file: string, key: string, layer: TileLayer, job: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    asked.set(file, { resolve, reject })
    post({ type: 'need', file, key, layer, job })
  })
}

// A tile's layer, decoded into the context (once; null where the tile has
// none), fetched for job `job`.
function load(key: string, layer: TileLayer, job: number): Promise<unknown> {
  const id = `${key}/${layer}`
  let p = loading.get(id)
  if (!p) {
    const f = entries.get(key)?.files[layer]
    if (!f || !ctx) p = Promise.resolve(null)
    else {
      const c = ctx
      p = fetchFile(f.file, key, layer, job).then(async (buf) => {
        if (layer === 'city') c.city.set(key, await decodeTile(buf))
        else if (layer === 'terrain') {
          const t: Terrain = await decodeTerrain(buf)
          c.terrain.set(key, t)
          // The page keeps the ground's heights too (cityGround.ts), copied.
          const heights = t.heights.slice()
          post({ type: 'terrain', key, header: t.header, heights }, [heights.buffer])
        } else c.trees.set(key, (await decodeTrees(buf)) as TreesData)
      })
      // A failed fetch can be retried by the next job that needs it.
      p.catch(() => loading.delete(id))
    }
    loading.set(id, p)
  }
  return p
}

const around = (i: number, j: number) => {
  const out: string[] = []
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) out.push(tileKey(i + a, j + b))
  return out
}

// What each job needs loaded first.
function needs(kind: JobKind, i: number, j: number, job: number): Promise<unknown>[] {
  const own = tileKey(i, j)
  const l = (k: string, layer: TileLayer) => load(k, layer, job)
  switch (kind) {
    case 'base':
      return around(i, j).flatMap((k) => [l(k, 'city'), l(k, 'terrain')])
    case 'near':
      return [...around(i, j).flatMap((k) => [l(k, 'city'), l(k, 'terrain')]), l(own, 'trees')]
    case 'mid':
      return [l(own, 'city'), l(own, 'terrain')]
    case 'lod':
      return [l(own, 'terrain')]
  }
}

// Every typed array's buffer in a result, to transfer.
function buffers(v: unknown, out: Set<ArrayBuffer> = new Set()): Set<ArrayBuffer> {
  if (ArrayBuffer.isView(v)) out.add(v.buffer as ArrayBuffer)
  else if (Array.isArray(v)) for (const x of v) buffers(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) buffers(x, out)
  return out
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data
  if (m.type === 'file') {
    const a = asked.get(m.file)
    asked.delete(m.file)
    if (a && m.bytes) a.resolve(m.bytes)
    else if (a) a.reject(new Error(m.error ?? `${m.file}: failed`))
    return
  }
  if (m.type === 'init') {
    index = m.index
    for (const t of index.tiles) entries.set(tileKey(t.i, t.j), t)
    const boundary = toLines(index.boundary.map((r) => Array.from({ length: r.length / 2 }, (_, k): [number, number] => [r[2 * k], r[2 * k + 1]])))
    ctx = { ringMeters: index.ringMeters, boundary, city: new Map<string, CityTile>(), terrain: new Map(), trees: new Map() }
    return
  }
  if (!index || !ctx) return
  try {
    if (m.type === 'far') {
      const started = performance.now()
      const far = await decodeFar(m.bytes)
      const tiles = far.tiles.map((t) => buildFar(t, ctx!))
      post({ type: 'far', id: m.id, tiles, landmarkY: far.header.landmarkY, ms: performance.now() - started }, [...buffers(tiles)])
      return
    }
    const { id, kind, i, j } = m
    await Promise.all(needs(kind, i, j, id))
    const started = performance.now()
    const result =
      kind === 'base' ? buildBase(ctx, i, j, m.step ?? 8) : kind === 'lod' ? groundMesh(ctx, i, j, m.step ?? 8) : kind === 'near' ? buildNear(ctx, i, j) : buildMid(ctx, i, j)
    post({ type: 'built', id, kind, i, j, result, ms: performance.now() - started } as ToPage, [...buffers(result)])
  } catch (err) {
    post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) })
  }
}
