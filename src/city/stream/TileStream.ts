// The city's tiles, streamed by distance (lod.ts): which level each tile
// wants, the jobs to get it (tileWorker.ts, most wanted first: tiles in
// view, then nearest), and the meshes once they're back, installed a few
// per frame (INSTALL_BYTES_PER_FRAME, so no frame uploads a city's worth),
// cross-faded between levels (dither.ts). Every tile always has its far
// blocks (farFormat.ts) to show until something better is in.
//
// Per tile, the meshes:
//   far    the far file's blocks, and the woods' canopy (also at mid)
//   base   its ground (at the detail its distance needs, groundTiles.ts)
//          and streets, with the maps they share (groundShading.ts): at
//          mid and near
//   mid    its buildings as plain prisms
//   near   its buildings in full; its rooftop items and trees go to
//          Rooftops.tsx and Trees.tsx (nearTiles)

import { Box3, BufferAttribute, BufferGeometry, type Camera, Frustum, Group, Matrix4, Mesh, type MeshStandardMaterial, RedFormat, RGBAFormat, Vector3, Vector4 } from 'three'
import type { TileEntry, TileLayer } from '../cityIndex.ts'
import { midBuildingMaterial, nearBuildingMaterial, nearGeometry, prismGeometry, reportDrawn } from '../Buildings.tsx'
import { GroundMask, landMaterial, pavingTexture, tileGroundMaterial, withLandUv } from '../groundMaterial.ts'
import { NO_CONTACT, type ShadingUniforms, gridUv, shadingTexture, shadingUniforms } from '../groundShading.ts'
import { LOD_STEPS, lodFor } from '../groundTiles.ts'
import { roadMaterial, streetGeometry } from '../Streets.tsx'
import { canopyMaterial } from '../canopy.ts'
import type { TreeGroup } from '../treeSlots.ts'
import { type CityBase, cityGround, tileUrl } from '../useCity.ts'
import { DEMO } from '../../params.ts'
import { FADE_S, type Fade } from './dither.ts'
import { type Level, type Thresholds, levelFor, thresholds, tileDistance } from './lod.ts'
import type { JobKind, JobResult, ToPage, ToWorker } from './protocol.ts'
import { type CanopyMesh, type FarBuild, tileKey } from './tileBuild.ts'

const INSTALL_BYTES_PER_FRAME = 6e6
// Jobs in flight per worker: a worker builds one at a time, but each waits
// on its fetches first, so with few in flight the link sat idle between
// them (2: the ocean view's first view took 6 s on a 20 Mbps link).
const JOBS_PER_WORKER = 6
// A tile's tallest point, for its box in the view frustum (Sutro Tower).
const TILE_TOP_M = 600
// A failed tile job is tried again after 1, then 2 s; after MAX_RETRIES
// failures in a row the tile is stuck (shown by its far blocks, and said so
// on the page: App.tsx) and tried again every STUCK_RETRY_MS.
export const MAX_RETRIES = 3
export const STUCK_RETRY_MS = 60_000
export const tileRetryMs = (failures: number) => (failures < MAX_RETRIES ? 1000 * 2 ** (failures - 1) : STUCK_RETRY_MS)
// The far file (every tile's stand-in, and where the landmarks stand) is
// tried again after each of these; once they're spent (~31 s) the city has
// failed to load and the page says so.
export const FAR_RETRY_MS = [1000, 2000, 4000, 8000, 16000]
// Files fetched at once: enough to keep a slow link full between round
// trips, few enough that the most wanted come first.
const FETCHES = 8
// Draw order by program: three.js sorts opaque meshes by renderOrder before
// material, so each kind's tiles draw together, one program switch per
// kind, not one per mesh (a tile's own materials share their program; the
// switches between kinds were stalling the GPU process).
const ORDER = { ground: 1, sidewalk: 2, asphalt: 3, markings: 4, far: 5, mid: 6, near: 7, canopy: 8 } as const

type Bundle = 'far' | 'mid' | 'near'

// A mesh that cross-fades (dither.ts): its usual material, shared by every
// tile where it can be (the prisms', the canopy's: a material per tile
// would have every draw switch materials, resending their uniforms, which
// stalled frames), and while it fades, its own copy with the dither.
interface Faded {
  mesh: Mesh
  fade: Fade
  solid: MeshStandardMaterial
  shared: boolean
  make: (fade: Fade, dither: boolean) => MeshStandardMaterial
  dither: MeshStandardMaterial | null
}

function fading(f: Faded, value: number) {
  f.dither ??= f.make(f.fade, true)
  f.mesh.material = f.dither
  f.fade.value = value
}

function settle(f: Faded) {
  f.mesh.material = f.solid
  f.fade.value = 1
  f.dither?.dispose()
  f.dither = null
}

interface Base {
  ground: Mesh
  steps: Map<number, BufferGeometry>
  streets: Mesh[] // sidewalk, asphalt, markings
  shading: ShadingUniforms
  textures: { dispose(): void }[]
  bytes: number
}

export interface NearItems {
  key: string
  rooftops: Float32Array
  trees: TreeGroup[]
}

interface Tile {
  key: string
  entry: TileEntry
  x0: number
  z0: number
  box: Box3
  level: Level | null
  inView: boolean
  distance: number
  far: Faded | null
  canopy: Faded | null
  base: Base | null
  mid: Faded | null
  near: (Faded & { items: NearItems; contact: { dispose(): void } }) | null
  shown: Bundle
  fade: { from: Bundle; to: Bundle; t0: number } | null
  pending: Set<string>
  // Failed jobs in a row, and when the next may go.
  failures: number
  retryAt: number
}

export interface TileStats {
  key: string
  i: number
  j: number
  level: Level | null
  shown: Bundle
  bytes: Partial<Record<TileLayer, number>>
}

const disposeMesh = (m: Mesh | null | undefined) => m?.geometry.dispose()

function geometryOf(position: Float32Array, index: Uint16Array | Uint32Array): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(position, 3))
  g.setIndex(new BufferAttribute(index, 1))
  withLandUv(g)
  g.computeBoundingSphere()
  return g
}

function canopyGeometry(c: CanopyMesh): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(c.position, 3))
  g.setAttribute('color', new BufferAttribute(c.color, 3))
  g.setAttribute('ring', new BufferAttribute(c.ring, 1))
  g.setAttribute('lift', new BufferAttribute(c.lift, 1))
  g.setIndex(new BufferAttribute(c.index, 1))
  g.computeBoundingSphere()
  return g
}

const bytesOf = (v: unknown): number => {
  if (ArrayBuffer.isView(v)) return v.byteLength
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + bytesOf(x), 0)
  if (v && typeof v === 'object') return Object.values(v).reduce((n: number, x) => n + bytesOf(x), 0)
  return 0
}

type Done = { [K in JobKind]: { kind: K; tile: Tile; result: JobResult[K]; bytes: number } }[JobKind]

export class TileStream {
  readonly group = new Group()
  readonly mask: GroundMask
  // Which tiles show their trees, as far as they've faded in: where the
  // woods' canopy next door sinks into them (canopy.ts).
  readonly nearTrees: GroundMask
  private readonly tiles = new Map<string, Tile>()
  private readonly workers: Worker[] = []
  private readonly load: number[] = []
  private readonly jobs = new Map<number, { tile: Tile; kind: JobKind; worker: number; step?: number; score: number }>()
  // Every file the workers ask for, fetched once (most wanted first: the
  // lowest score of the jobs that need it), its bytes kept for the next
  // worker that needs it.
  private readonly fetching = new Map<string, { score: number; workers: Set<number>; bytes: ArrayBuffer | null; key: string | null; layer: TileLayer | 'far' }>()
  private readonly waiting: string[] = []
  private active = 0
  private nextId = 1
  private ready: Done[] = []
  private farPending: FarBuild[] | null = null
  // The far file: not yet asked for (or to be asked again at farRetryAt),
  // on its way, in, or given up on (cityFailed).
  private far: 'idle' | 'loading' | 'in' | 'failed' = 'idle'
  private farFailures = 0
  private farRetryAt = 0
  // Download report (NetOverlay.tsx): every file's size, once.
  readonly files = new Map<string, { bytes: number; key: string | null; layer: TileLayer | 'far' }>()
  private readonly frustum = new Frustum()
  private readonly m = new Matrix4()
  private readonly started = performance.now()
  private firstView: number | null = null
  private listeners = new Set<() => void>()
  private nearVersion = 0
  landmarkY: Record<string, number> | null = null
  // The prisms' and canopy's usual materials, every tile's (Faded).
  private readonly prismMaterial = midBuildingMaterial({ value: 1 })
  private readonly canopyMaterial: MeshStandardMaterial
  // The renderer's last frame (City.tsx countDrawn), for ?net.
  readonly drawn = { calls: 0, triangles: 0 }
  errors: string[] = []
  private reported = false

  private readonly city: CityBase

  constructor(city: CityBase) {
    this.city = city
    const { index } = city
    this.mask = new GroundMask(index.tiles, index.tileM)
    this.nearTrees = new GroundMask(index.tiles, index.tileM)
    this.canopyMaterial = canopyMaterial({ value: 1 }, false, this.nearTrees)
    this.group.name = 'city-tiles'
    for (const entry of index.tiles) {
      const x0 = entry.i * index.tileM
      const z0 = entry.j * index.tileM
      this.tiles.set(tileKey(entry.i, entry.j), {
        key: tileKey(entry.i, entry.j),
        entry,
        x0,
        z0,
        box: new Box3(new Vector3(x0, -20, z0), new Vector3(x0 + index.tileM, TILE_TOP_M, z0 + index.tileM)),
        level: null,
        inView: false,
        distance: Infinity,
        far: null,
        canopy: null,
        base: null,
        mid: null,
        near: null,
        shown: 'far',
        fade: null,
        pending: new Set(),
        failures: 0,
        retryAt: 0,
      })
    }
    const n = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)))
    for (let w = 0; w < n; w++) {
      const worker = new Worker(new URL('./tileWorker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<ToPage>) => this.receive(w, e.data)
      worker.onerror = (e) => {
        this.errors.push(`tile worker: ${e.message}`)
        // A worker that won't start never builds the far blocks.
        if (this.far !== 'in') this.giveUpFar()
      }
      worker.postMessage({ type: 'init', index } satisfies ToWorker)
      this.workers.push(worker)
      this.load.push(0)
    }
  }

  dispose() {
    for (const w of this.workers) w.terminate()
    for (const t of this.tiles.values()) {
      for (const b of ['mid', 'near'] as const) this.drop(t, b)
      this.dropBase(t)
      this.dropCanopy(t)
      this.dropFar(t)
    }
    this.prismMaterial.dispose()
    this.canopyMaterial.dispose()
    this.mask.texture.dispose()
    this.nearTrees.texture.dispose()
  }

  // ------------------------------------------------------------ messages

  private receive(w: number, m: ToPage) {
    switch (m.type) {
      case 'need':
        this.need(m.file, m.key, m.layer, this.jobs.get(m.job)?.score ?? 0, w)
        return
      case 'terrain':
        cityGround.setTile(m.key, m.header, m.heights)
        return
      case 'far':
        this.load[w]--
        this.far = 'in'
        this.farPending = m.tiles
        this.landmarkY = m.landmarkY
        console.info(`city: far blocks for ${m.tiles.length} tiles in ${m.ms.toFixed(0)} ms`)
        this.changed()
        return
      case 'built': {
        const job = this.jobs.get(m.id)
        if (!job) return
        this.jobs.delete(m.id)
        this.load[w]--
        job.tile.pending.delete(this.jobName(m.kind, job.step))
        if (job.tile.failures) {
          job.tile.failures = 0
          this.changed()
        }
        this.ready.push({ kind: m.kind, tile: job.tile, result: m.result, bytes: bytesOf(m.result) } as Done)
        return
      }
      case 'error': {
        const job = this.jobs.get(m.id)
        this.load[w]--
        if (!job) {
          // The far file's decode (the one job without an entry): fetched
          // again, in case what came was broken.
          const far = this.city.index.far
          if (far) this.fetching.delete(far.file)
          this.farFailed(m.message)
          return
        }
        this.jobs.delete(m.id)
        const { tile } = job
        tile.pending.delete(this.jobName(job.kind, job.step))
        tile.failures++
        tile.retryAt = performance.now() + tileRetryMs(tile.failures)
        console.error(`city: tile ${tile.key} ${job.kind}: ${m.message}`)
        if (tile.failures === MAX_RETRIES) {
          this.errors.push(`tile ${tile.key}: ${m.message}`)
          this.changed()
        }
        return
      }
    }
  }

  // A file for worker `w` (or the page itself, -1): sent as soon as it's in.
  private need(file: string, key: string | null, layer: TileLayer | 'far', score: number, w: number) {
    let f = this.fetching.get(file)
    if (!f) {
      f = { score, workers: new Set(), bytes: null, key, layer }
      this.fetching.set(file, f)
      this.waiting.push(file)
    }
    f.score = Math.min(f.score, score)
    if (w >= 0) {
      if (f.bytes) this.workers[w].postMessage({ type: 'file', file, bytes: f.bytes.slice(0) } satisfies ToWorker)
      else f.workers.add(w)
    }
    this.pump()
  }

  private pump() {
    while (this.active < FETCHES && this.waiting.length) {
      let best = 0
      for (let k = 1; k < this.waiting.length; k++) if (this.fetching.get(this.waiting[k])!.score < this.fetching.get(this.waiting[best])!.score) best = k
      const file = this.waiting.splice(best, 1)[0]
      const f = this.fetching.get(file)!
      this.active++
      fetch(tileUrl(file))
        .then((res) => {
          if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
          return res.arrayBuffer()
        })
        .then(
          (bytes) => {
            f.bytes = bytes
            this.files.set(file, { bytes: bytes.byteLength, key: f.key, layer: f.layer })
            for (const w of f.workers) this.workers[w].postMessage({ type: 'file', file, bytes: bytes.slice(0) } satisfies ToWorker)
            f.workers.clear()
            if (f.layer === 'far') {
              this.load[0]++
              this.workers[0].postMessage({ type: 'far', id: 0, bytes: bytes.slice(0) } satisfies ToWorker)
            }
            this.changed()
          },
          (err: unknown) => {
            const error = err instanceof Error ? err.message : String(err)
            for (const w of f.workers) this.workers[w].postMessage({ type: 'file', file, bytes: null, error } satisfies ToWorker)
            // Asked for again by the next job that needs it.
            this.fetching.delete(file)
            if (f.layer === 'far') this.farFailed(error)
          },
        )
        .finally(() => {
          this.active--
          this.pump()
        })
    }
  }

  // The far file failed (its fetch or its decode): asked for again after
  // the next FAR_RETRY_MS, or given up on once they're spent.
  private farFailed(error: string) {
    this.errors.push(error)
    console.error(`city: ${error}`)
    this.farFailures++
    if (this.farFailures > FAR_RETRY_MS.length) return this.giveUpFar()
    this.far = 'idle'
    this.farRetryAt = performance.now() + FAR_RETRY_MS[this.farFailures - 1]
  }

  private giveUpFar() {
    this.far = 'failed'
    this.changed()
  }

  private jobName(kind: JobKind, step?: number) {
    return kind === 'lod' ? `lod${step}` : kind
  }

  private send(tile: Tile, kind: JobKind, score: number, step?: number) {
    let w = 0
    for (let k = 1; k < this.workers.length; k++) if (this.load[k] < this.load[w]) w = k
    if (this.load[w] >= JOBS_PER_WORKER) return false
    const id = this.nextId++
    this.jobs.set(id, { tile, kind, worker: w, step, score })
    tile.pending.add(this.jobName(kind, step))
    this.load[w]++
    this.workers[w].postMessage({ type: 'build', id, kind, i: tile.entry.i, j: tile.entry.j, step } satisfies ToWorker)
    return true
  }

  // ------------------------------------------------------------- per frame

  update(camera: Camera, fovDeg: number, viewportHeightPx: number) {
    const now = performance.now()
    // The far file first of all: every tile's stand-in, and where the
    // landmarks stand.
    if (this.far === 'idle' && now >= this.farRetryAt && this.workers.length) {
      const far = this.city.index.far
      if (!far) {
        this.errors.push('city-index.json: no far file. Run `npm run bake:far`.')
        this.giveUpFar()
      } else {
        this.far = 'loading'
        this.need(far.file, null, 'far', -Infinity, -1)
      }
    }
    if (this.farPending) {
      for (const f of this.farPending) this.installFar(f)
      this.farPending = null
    }
    const t = thresholds(fovDeg, viewportHeightPx)
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.m)
    const cam = camera.position
    for (const tile of this.tiles.values()) {
      tile.inView = this.frustum.intersectsBox(tile.box)
      tile.distance = tileDistance(cam, tile.x0, tile.z0, this.city.index.tileM)
      tile.level = levelFor(tile.distance, tile.level, t)
    }
    this.schedule(t, now)
    this.install()
    for (const tile of this.tiles.values()) this.present(tile, now)
    this.watchSettled(now)
  }

  // The jobs still wanted, most wanted first, while workers have room.
  private schedule(t: Thresholds, now: number) {
    const wants: { tile: Tile; kind: JobKind; step?: number; score: number }[] = []
    for (const tile of this.tiles.values()) {
      if (tile.level === 'far' || tile.level === null || now < tile.retryAt) continue
      const score = (tile.inView ? 0 : 1e6) + tile.distance
      const step = LOD_STEPS[lodFor(tile.distance)]
      if (!tile.base) {
        if (!tile.pending.has('base')) wants.push({ tile, kind: 'base', step, score })
        continue
      }
      if (tile.level === 'near' && !tile.near && !tile.pending.has('near')) wants.push({ tile, kind: 'near', score })
      if (tile.level === 'mid' && !tile.mid && !tile.pending.has('mid')) wants.push({ tile, kind: 'mid', score: score + 0.5 * t.near })
      if (!tile.base.steps.has(step) && !tile.pending.has(`lod${step}`)) wants.push({ tile, kind: 'lod', step, score: score + t.near })
    }
    wants.sort((a, b) => a.score - b.score)
    for (const w of wants) if (!this.send(w.tile, w.kind, w.score, w.step)) break
  }

  private install() {
    let budget = INSTALL_BYTES_PER_FRAME
    // Nearest first among what's back.
    this.ready.sort((a, b) => (a.tile.inView === b.tile.inView ? a.tile.distance - b.tile.distance : a.tile.inView ? -1 : 1))
    while (this.ready.length && budget > 0) {
      const done = this.ready.shift()!
      budget -= done.bytes
      const { tile } = done
      // Built for a level the tile has since left: dropped.
      if (tile.level === 'far' || (done.kind === 'near' && tile.level !== 'near') || (done.kind === 'mid' && tile.level !== 'mid')) continue
      if (done.kind === 'base') this.installBase(tile, done.result)
      else if (done.kind === 'lod') {
        if (tile.base && !tile.base.steps.has(done.result.step)) tile.base.steps.set(done.result.step, geometryOf(done.result.position, done.result.index))
      } else if (done.kind === 'mid') this.installMid(tile, done.result)
      else this.installNear(tile, done.result)
    }
  }

  // ------------------------------------------------------------- installs

  private faded(geometry: BufferGeometry, make: (fade: Fade, dither: boolean) => MeshStandardMaterial, shared: MeshStandardMaterial | null): Faded {
    const fade = { value: 1 }
    const solid = shared ?? make(fade, false)
    const mesh = new Mesh(geometry, solid)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.matrixAutoUpdate = false
    mesh.visible = false
    this.group.add(mesh)
    return { mesh, fade, solid, shared: !!shared, make, dither: null }
  }

  private installFar(f: FarBuild) {
    const tile = this.tiles.get(tileKey(f.i, f.j))
    if (!tile) return
    tile.far = this.faded(prismGeometry(f.prisms), midBuildingMaterial, this.prismMaterial)
    tile.far.mesh.visible = true
    tile.far.mesh.renderOrder = ORDER.far
    // In the Bay's 512 px reflection (BayWater.tsx) distant blocks are mush.
    tile.far.mesh.userData.noReflect = true
    if (f.canopy) {
      tile.canopy = this.faded(canopyGeometry(f.canopy), (fade, dither) => canopyMaterial(fade, dither, this.nearTrees), this.canopyMaterial)
      tile.canopy.mesh.renderOrder = ORDER.canopy
      tile.canopy.mesh.userData.noReflect = true
      tile.canopy.mesh.visible = true
      if (DEMO) tile.canopy.mesh.onAfterRender = reportDrawn(tile.canopy.solid, 'canopy')
    }
  }

  private installBase(tile: Tile, b: JobResult['base']) {
    if (tile.base) return
    const normals = shadingTexture(b.normals, b.grid.nx, b.grid.nz, RGBAFormat)
    const cover = shadingTexture(b.cover, b.grid.nx, b.grid.nz, RGBAFormat)
    const shading = shadingUniforms({ normals, cover, contact: NO_CONTACT, groundUv: new Vector4(...gridUv(b.grid)), contactUv: new Vector4(0, 0, 0.5, 0.5) })
    const paving = pavingTexture(b.paving, tile.x0, tile.z0)
    const steps = new Map([[b.ground.step, geometryOf(b.ground.position, b.ground.index)]])
    const ground = new Mesh(steps.get(b.ground.step), tileGroundMaterial(this.city.landCover, landMaterial(), paving, shading))
    ground.castShadow = true
    ground.receiveShadow = true
    ground.renderOrder = ORDER.ground
    ground.userData.noReflect = true
    ground.matrixAutoUpdate = false
    if (DEMO) ground.onAfterRender = reportDrawn(ground.material, 'ground')
    const streets = [b.streets.sidewalk, b.streets.asphalt, b.streets.markings].map((l, k) => {
      const m = new Mesh(streetGeometry(l), roadMaterial(shading, k + 1, k === 2))
      m.receiveShadow = true
      m.userData.noReflect = true
      m.matrixAutoUpdate = false
      m.renderOrder = [ORDER.sidewalk, ORDER.asphalt, ORDER.markings][k]
      return m
    })
    this.group.add(ground, ...streets)
    tile.base = { ground, steps, streets, shading, textures: [normals, cover, paving.texture], bytes: bytesOf(b) }
    this.mask.set(tile.entry.i, tile.entry.j, true)
  }

  private installMid(tile: Tile, m: JobResult['mid']) {
    if (tile.mid) return
    tile.mid = this.faded(prismGeometry(m), midBuildingMaterial, this.prismMaterial)
    tile.mid.mesh.renderOrder = ORDER.mid
    tile.mid.mesh.userData.noReflect = true
    if (DEMO) tile.mid.mesh.onAfterRender = reportDrawn(tile.mid.solid, 'prisms')
  }

  private installNear(tile: Tile, n: JobResult['near']) {
    if (tile.near || !tile.base) return
    const contact = shadingTexture(n.contact.pixels, n.contact.grid.nx, n.contact.grid.nz, RedFormat)
    tile.base.shading.uContactAo.value = contact
    tile.base.shading.uContactUv.value.set(...gridUv(n.contact.grid))
    const shading = tile.base.shading
    const f = this.faded(nearGeometry(n.buildings), (fade, dither) => nearBuildingMaterial(shading, fade, dither), null)
    f.mesh.renderOrder = ORDER.near
    if (DEMO) f.mesh.onAfterRender = reportDrawn(f.solid, 'buildings')
    tile.near = { ...f, items: { key: tile.key, rooftops: n.rooftops, trees: n.trees }, contact }
    this.nearVersion++
    this.changed()
  }

  // ------------------------------------------------------------ showing

  private bundle(t: Tile, b: Bundle): Faded | null {
    return b === 'far' ? t.far : b === 'mid' ? t.mid : t.near
  }

  // The best of what's in for the level it wants.
  private target(t: Tile): Bundle {
    if (t.level === 'near') return t.near ? 'near' : t.mid ? 'mid' : 'far'
    if (t.level === 'mid') return t.mid ? 'mid' : t.near ? 'near' : 'far'
    return 'far'
  }

  private present(t: Tile, now: number) {
    this.nearTrees.setShare(t.entry.i, t.entry.j, this.treesShown(t, now))
    // The fade under way, if any, runs out first.
    if (t.fade) {
      const k = Math.max(0.0001, Math.min(1, (now - t.fade.t0) / (FADE_S * 1000)))
      const from = this.bundle(t, t.fade.from)
      const to = this.bundle(t, t.fade.to)
      // The canopy goes with the near level's trees coming, and back.
      const canopy = t.canopy && (t.fade.to === 'near' || t.fade.from === 'near') ? t.canopy : null
      if (k < 1) {
        if (to) fading(to, k)
        if (from) fading(from, -k)
        if (canopy) {
          canopy.mesh.visible = true
          fading(canopy, t.fade.to === 'near' ? -k : k)
        }
        return
      }
      if (to) settle(to)
      if (from) {
        settle(from)
        from.mesh.visible = false
      }
      if (canopy) {
        settle(canopy)
        canopy.mesh.visible = t.fade.to !== 'near'
      }
      t.fade = null
    }
    const want = this.target(t)
    if (want !== t.shown) {
      const to = this.bundle(t, want)!
      const from = this.bundle(t, t.shown)
      to.mesh.visible = true
      fading(to, 0.0001)
      if (from) fading(from, -0.0001)
      t.fade = { from: t.shown, to: want, t0: now }
      t.shown = want
      return
    }
    // Ground and streets at mid and near; at the detail the distance needs.
    if (t.level === 'far') {
      if (t.base) this.dropBase(t)
    } else if (t.base) {
      const step = LOD_STEPS[lodFor(t.distance)]
      const g = t.base.steps.get(step) ?? this.nearestStep(t.base.steps, step)
      if (t.base.ground.geometry !== g) t.base.ground.geometry = g
      t.base.streets[2].visible = t.level === 'near'
    }
    // What's no longer shown or wanted goes.
    if (t.shown !== 'near' && t.near && t.level !== 'near') this.drop(t, 'near')
    if (t.shown !== 'mid' && t.mid && t.level !== 'mid') this.drop(t, 'mid')
    if (t.shown === 'near' && t.mid) this.drop(t, 'mid')
  }

  // How far a tile's trees (its near level) are in: 1 shown, 0 not, the
  // fade's share between.
  private treesShown(t: Tile, now: number): number {
    if (!t.fade) return t.shown === 'near' ? 1 : 0
    const k = Math.min(1, (now - t.fade.t0) / (FADE_S * 1000))
    return t.fade.to === 'near' ? k : t.fade.from === 'near' ? 1 - k : 0
  }

  private nearestStep(steps: Map<number, BufferGeometry>, want: number): BufferGeometry {
    let best: [number, BufferGeometry] | null = null
    for (const [s, g] of steps) if (!best || Math.abs(Math.log2(s / want)) < Math.abs(Math.log2(best[0] / want))) best = [s, g]
    return best![1]
  }

  private drop(t: Tile, b: Bundle) {
    const f = this.bundle(t, b)
    if (!f || b === 'far') return
    this.group.remove(f.mesh)
    disposeMesh(f.mesh)
    if (!f.shared) f.solid.dispose()
    f.dither?.dispose()
    if (b === 'near' && t.near) {
      t.near.contact.dispose()
      if (t.base) {
        t.base.shading.uContactAo.value = NO_CONTACT
        t.base.shading.uContactUv.value.set(0, 0, 0.5, 0.5)
      }
      t.near = null
      this.nearVersion++
      this.changed()
    } else t.mid = null
  }

  private dropBase(t: Tile) {
    if (!t.base) return
    this.group.remove(t.base.ground, ...t.base.streets)
    for (const g of t.base.steps.values()) g.dispose()
    for (const s of t.base.streets) {
      s.geometry.dispose()
      ;(s.material as MeshStandardMaterial).dispose()
    }
    ;(t.base.ground.material as MeshStandardMaterial).dispose()
    for (const x of t.base.textures) x.dispose()
    t.base = null
    this.mask.set(t.entry.i, t.entry.j, false)
  }

  // Only with the stream (dispose): a tile's far blocks stay while it does.
  private dropFar(t: Tile) {
    if (!t.far) return
    this.group.remove(t.far.mesh)
    disposeMesh(t.far.mesh)
    t.far.dither?.dispose()
    t.far = null
  }

  private dropCanopy(t: Tile) {
    if (!t.canopy) return
    this.group.remove(t.canopy.mesh)
    disposeMesh(t.canopy.mesh)
    t.canopy.dither?.dispose()
    t.canopy = null
  }

  // ------------------------------------------------------------ status

  // Settled: every tile showing what its level wants, its ground in, no
  // fade under way and nothing pending.
  private settled(t: Tile): boolean {
    if (t.fade || t.pending.size) return false
    if (t.level === 'far' || t.failures >= MAX_RETRIES) return true
    return !!t.base && t.shown === t.level
  }

  private watchSettled(now: number) {
    if (!this.landmarkY) return
    const tiles = [...this.tiles.values()]
    if (this.firstView === null && tiles.every((t) => !t.inView || this.settled(t))) {
      this.firstView = now - this.started
      console.info(`city: first view in ${(this.firstView / 1000).toFixed(2)} s, ${(this.downloaded() / 1024).toFixed(0)} KB of tiles`)
      window.__cityFirstViewMs = this.firstView
      this.changed()
    }
    const idle = this.firstView !== null && this.ready.length === 0 && this.jobs.size === 0 && tiles.every((t) => this.settled(t))
    window.__cityIdle = idle
    window.__cityDrawCalls = this.drawn.calls
    if (idle && !this.reported) {
      this.reported = true
      const by = (l: Level) => tiles.filter((t) => t.level === l).length
      console.info(`city: settled in ${((now - this.started) / 1000).toFixed(2)} s: ${by('near')} near, ${by('mid')} mid, ${by('far')} far tiles; ${(this.downloaded() / 1024).toFixed(0)} KB`)
    }
    if (!idle) this.reported = false
  }

  countDrawn(calls: number, triangles: number) {
    this.drawn.calls = calls
    this.drawn.triangles = triangles
  }

  get firstViewMs(): number | null {
    return this.firstView
  }

  // The far file couldn't be loaded, so the city can't show (App.tsx).
  get cityFailed(): boolean {
    return this.far === 'failed'
  }

  // Tiles whose jobs keep failing, shown by their far blocks meanwhile.
  get stuckTiles(): number {
    let n = 0
    for (const t of this.tiles.values()) if (t.failures >= MAX_RETRIES) n++
    return n
  }

  downloaded(): number {
    let n = 0
    for (const f of this.files.values()) n += f.bytes
    return n
  }

  stats(): TileStats[] {
    const bytes = new Map<string, Partial<Record<TileLayer, number>>>()
    for (const f of this.files.values()) {
      if (!f.key || f.layer === 'far') continue
      const b = bytes.get(f.key) ?? {}
      b[f.layer] = (b[f.layer] ?? 0) + f.bytes
      bytes.set(f.key, b)
    }
    return [...this.tiles.values()].map((t) => ({ key: t.key, i: t.entry.i, j: t.entry.j, level: t.level, shown: t.shown, bytes: bytes.get(t.key) ?? {} }))
  }

  // The tiles drawn near, for their rooftop items and trees; `version`
  // changes with them.
  nearTiles(): { version: number; items: NearItems[] } {
    const items: NearItems[] = []
    for (const t of this.tiles.values()) if (t.near) items.push(t.near.items)
    return { version: this.nearVersion, items }
  }

  subscribe(f: () => void): () => void {
    this.listeners.add(f)
    return () => this.listeners.delete(f)
  }

  private changed() {
    for (const f of this.listeners) f()
  }
}

declare global {
  interface Window {
    // Set by the stream: the first view's load time, and whether every tile
    // is showing what it wants (npm run shot / fps / smoke wait for it).
    __cityFirstViewMs?: number
    __cityIdle?: boolean
    __cityDrawCalls?: number
  }
}
