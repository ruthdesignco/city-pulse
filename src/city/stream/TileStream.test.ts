import { PerspectiveCamera } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CityIndex } from '../cityIndex.ts'
import type { LandCover } from '../landCover.ts'
import type { Terrain } from '../terrain.ts'
import type { CityBase } from '../useCity.ts'
import type { ToPage, ToWorker } from './protocol.ts'
import { FAR_RETRY_MS, MAX_RETRIES, STUCK_RETRY_MS, TileStream } from './TileStream.ts'

// params.ts reads the page's URL as it loads.
vi.mock('../../params.ts', () => ({ DEMO: false }))

// The stream's fetching, retries and failure reporting, with the workers and
// the network faked: every message a worker would send is replied by hand.

class FakeWorker {
  static all: FakeWorker[] = []
  sent: ToWorker[] = []
  onmessage: ((e: MessageEvent<ToPage>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  constructor() {
    FakeWorker.all.push(this)
  }
  postMessage(m: ToWorker) {
    this.sent.push(m)
  }
  terminate() {}
  reply(m: ToPage) {
    this.onmessage!({ data: m } as MessageEvent<ToPage>)
  }
  builds() {
    return this.sent.filter((m): m is Extract<ToWorker, { type: 'build' }> => m.type === 'build')
  }
}

const FAR = 'far-test.bin'
const tile = (i: number) => ({ i, j: 0, buildings: 1, land: 1, files: { city: { file: `city-${i}.bin`, bytes: 10 }, terrain: { file: `terrain-${i}.bin`, bytes: 10 } } })
const index = (tiles: number): CityIndex => ({
  version: 1,
  origin: { lat: 37.768, lng: -122.413 },
  tileM: 1000,
  ringMeters: 800,
  boundary: [],
  waterfront: [],
  landmarks: [],
  landmarkModels: [],
  attribution: '',
  osmTimestamp: null,
  osmElementsSha256: '',
  bakedAt: '',
  sources: {},
  far: { file: FAR, bytes: 10 },
  tiles: Array.from({ length: tiles }, (_, i) => tile(i)),
})
const base = (tiles = 1): CityBase => ({ index: index(tiles), boundary: { counts: [], coords: [] } as unknown as CityBase['boundary'], backdrop: {} as Terrain, landCover: {} as LandCover })

let clock = 0
// Each URL's answers in turn (the last repeats): bytes, or a failure.
let answers: Map<string, ('ok' | 'fail')[]>
const fetched: string[] = []

function camera(y: number) {
  const c = new PerspectiveCamera(40, 1.6, 10, 100000)
  c.position.set(500, y, 1500)
  c.lookAt(500, 0, 500)
  c.updateMatrixWorld()
  return c
}
const NEAR = camera(300) // over tile 0's edge: every test tile wants detail
const AWAY = camera(20000) // every tile far

const tick = () => new Promise((r) => setTimeout(r, 0))
async function step(s: TileStream, cam: PerspectiveCamera, advanceMs = 0) {
  clock += advanceMs
  s.update(cam, 40, 900)
  await tick()
}

// The far file in, with no blocks: the stream's ready for tiles.
async function farIn(s: TileStream) {
  await step(s, AWAY)
  FakeWorker.all[0].reply({ type: 'far', id: 0, tiles: [], landmarkY: {}, ms: 1 })
  await step(s, AWAY)
}

beforeEach(() => {
  clock = 1000
  FakeWorker.all = []
  fetched.length = 0
  answers = new Map()
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('window', {})
  vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
  vi.stubGlobal('fetch', (url: string) => {
    fetched.push(url)
    const file = url.slice(url.lastIndexOf('/') + 1)
    const queue = answers.get(file) ?? ['ok']
    const a = queue.length > 1 ? queue.shift()! : queue[0]
    return a === 'ok' ? Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }) : Promise.reject(new Error(`${file}: offline`))
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const farFetches = () => fetched.filter((u) => u.endsWith(FAR)).length

describe('TileStream: the far file', () => {
  it('asks again after a failed fetch, after the backoff, and the first view follows', async () => {
    answers.set(FAR, ['fail', 'ok'])
    const s = new TileStream(base())
    await step(s, AWAY)
    expect(farFetches()).toBe(1)
    await step(s, AWAY, FAR_RETRY_MS[0] - 1)
    expect(farFetches()).toBe(1)
    await step(s, AWAY, 1)
    expect(farFetches()).toBe(2)
    expect(FakeWorker.all[0].sent.some((m) => m.type === 'far')).toBe(true)
    FakeWorker.all[0].reply({ type: 'far', id: 0, tiles: [], landmarkY: {}, ms: 1 })
    await step(s, AWAY)
    expect(s.firstViewMs).not.toBeNull()
    expect(s.cityFailed).toBe(false)
  })

  it('fetches it again when the worker fails to decode it', async () => {
    const s = new TileStream(base())
    await step(s, AWAY)
    FakeWorker.all[0].reply({ type: 'error', id: 0, message: 'far: bad header' })
    await step(s, AWAY, FAR_RETRY_MS[0])
    expect(farFetches()).toBe(2)
  })

  it('gives up once the retries are spent, and says the city failed', async () => {
    answers.set(FAR, ['fail'])
    const s = new TileStream(base())
    const heard = vi.fn()
    s.subscribe(heard)
    await step(s, AWAY)
    for (const ms of FAR_RETRY_MS) await step(s, AWAY, ms)
    expect(farFetches()).toBe(FAR_RETRY_MS.length + 1)
    expect(s.cityFailed).toBe(true)
    expect(heard).toHaveBeenCalled()
    await step(s, AWAY, 60_000)
    expect(farFetches()).toBe(FAR_RETRY_MS.length + 1)
    expect(s.firstViewMs).toBeNull()
  })

  it('fails the city when a worker cannot start before the far blocks are in', async () => {
    const s = new TileStream(base())
    await step(s, AWAY)
    FakeWorker.all[1].onerror!({ message: 'script failed to load' } as ErrorEvent)
    expect(s.cityFailed).toBe(true)
  })

  it('a worker error after the far blocks are in does not fail the city', async () => {
    const s = new TileStream(base())
    await farIn(s)
    FakeWorker.all[1].onerror!({ message: 'late' } as ErrorEvent)
    expect(s.cityFailed).toBe(false)
  })
})

describe('TileStream: tiles', () => {
  it('fetches a file two workers need once, and sends it to both', async () => {
    const s = new TileStream(base(2))
    await farIn(s)
    await step(s, NEAR)
    const [w0, w1] = FakeWorker.all
    const [b0] = w0.builds()
    const [b1] = w1.builds()
    expect(b0 && b1).toBeTruthy()
    w0.reply({ type: 'need', file: 'city-0.bin', key: '0,0', layer: 'city', job: b0.id })
    w1.reply({ type: 'need', file: 'city-0.bin', key: '0,0', layer: 'city', job: b1.id })
    await tick()
    expect(fetched.filter((u) => u.endsWith('city-0.bin'))).toHaveLength(1)
    for (const w of [w0, w1]) expect(w.sent.some((m) => m.type === 'file' && m.file === 'city-0.bin' && m.bytes)).toBe(true)
  })

  it('backs off a failing tile, says when it is stuck, and keeps trying', async () => {
    const s = new TileStream(base())
    await farIn(s)
    const builds = () => FakeWorker.all.flatMap((w) => w.builds())
    const fail = () => {
      const b = builds().at(-1)!
      const w = FakeWorker.all.find((x) => x.builds().includes(b))!
      w.reply({ type: 'error', id: b.id, message: 'offline' })
    }
    await step(s, NEAR)
    expect(builds()).toHaveLength(1)
    // 1 s, then 2 s, then stuck: every STUCK_RETRY_MS.
    const delays = [1000, 2000, STUCK_RETRY_MS]
    for (let k = 0; k < MAX_RETRIES; k++) {
      fail()
      await step(s, NEAR, delays[k] - 1)
      expect(builds()).toHaveLength(k + 1)
      await step(s, NEAR, 1)
      expect(builds()).toHaveLength(k + 2)
    }
    expect(s.stuckTiles).toBe(1)
    // A stuck tile doesn't hold up the first view, which already came.
    expect(s.firstViewMs).not.toBeNull()
  })

  it('a tile that comes back after sticking is no longer counted, and a result for a level it left is dropped', async () => {
    const s = new TileStream(base())
    await farIn(s)
    await step(s, NEAR)
    for (let k = 0; k < MAX_RETRIES; k++) {
      const b = FakeWorker.all.flatMap((w) => w.builds()).at(-1)!
      FakeWorker.all.find((w) => w.builds().includes(b))!.reply({ type: 'error', id: b.id, message: 'offline' })
      await step(s, NEAR, STUCK_RETRY_MS)
    }
    expect(s.stuckTiles).toBe(1)
    const b = FakeWorker.all.flatMap((w) => w.builds()).at(-1)!
    // The camera has gone: the tile's far again before its base comes back.
    await step(s, AWAY)
    const meshes = s.group.children.length
    FakeWorker.all.find((w) => w.builds().includes(b))!.reply({ type: 'built', id: b.id, kind: 'mid', i: 0, j: 0, result: {} as never, ms: 1 })
    await step(s, AWAY)
    expect(s.stuckTiles).toBe(0)
    expect(s.group.children.length).toBe(meshes)
  })
})
