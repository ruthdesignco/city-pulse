// Each landmark's builder, by its registry ID (registry.ts).

import type { ModelBuilder } from './build.ts'
import { buildCoitTower } from './coitTower.ts'
import type { LandmarkPlacement } from './registry.ts'
import { buildTransamerica } from './transamerica.ts'

export const LANDMARK_MODELS: Record<string, (at: LandmarkPlacement) => ModelBuilder> = {
  transamerica: buildTransamerica,
  coit: buildCoitTower,
}
