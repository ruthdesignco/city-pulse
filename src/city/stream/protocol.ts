// Messages between the page (TileStream.ts) and the tile workers
// (tileWorker.ts).

import type { CityIndex, TileLayer } from '../cityIndex.ts'
import type { PrismMesh } from '../extrude.ts'
import type { TerrainHeader } from '../terrain.ts'
import type { BaseBuild, FarBuild, GroundMesh, NearBuild } from './tileBuild.ts'

export type JobKind = 'base' | 'lod' | 'near' | 'mid'

export type ToWorker =
  | { type: 'init'; index: CityIndex }
  | { type: 'far'; id: number; bytes: ArrayBuffer }
  | { type: 'build'; id: number; kind: JobKind; i: number; j: number; step?: number }
  // A file a worker asked for (`need`), its bytes copied; null if it failed.
  | { type: 'file'; file: string; bytes: ArrayBuffer | null; error?: string }

export interface JobResult {
  base: BaseBuild
  lod: GroundMesh
  near: NearBuild
  mid: PrismMesh
}

export type ToPage =
  // The page fetches every file (once, most wanted first: TileStream.ts),
  // for the job `job` here.
  | { type: 'need'; file: string; key: string; layer: TileLayer; job: number }
  | { type: 'terrain'; key: string; header: TerrainHeader; heights: Int16Array }
  | { type: 'far'; id: number; tiles: FarBuild[]; landmarkY: Record<string, number>; ms: number }
  | { [K in JobKind]: { type: 'built'; id: number; kind: K; i: number; j: number; result: JobResult[K]; ms: number } }[JobKind]
  | { type: 'error'; id: number; message: string }
