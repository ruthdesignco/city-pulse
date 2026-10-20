// Street trees by species group: which low poly shape each tree gets
// (treeModels.ts), which family of greens, and how big it's drawn. The bake
// (scripts/bake-trees.ts) stores each tree's kind, tone and trunk diameter
// (DBH) in trees.bin; the app sizes trees from those here, so sizing can be
// tuned without a rebake.
//
// Species come from DataSF's Street Tree Inventory as
// "Platanus x hispanica :: Sycamore, London Plane": scientific name first.
// Groups go by genus.

export const TreeKind = {
  Broad: 0, // broad canopy: plane, fig, magnolia, elm, most of the rest
  Columnar: 1, // narrow upright: ginkgo, pear, swamp myrtle, Brisbane box
  FanPalm: 2, // tall slim: Mexican fan palm
  DatePalm: 3, // stout trunk, heavy crown: Canary Island date palm
  FeatherPalm: 4, // slim, medium: queen palm and the like
  Cordyline: 5, // small tufted "palm" (Cordyline, Dracaena, Yucca)
} as const
export type TreeKind = (typeof TreeKind)[keyof typeof TreeKind]
export const TREE_KINDS = 6

// Index into palette.treeGreens.
export const TreeTone = { Bright: 0, Deep: 1, Gray: 2, Palm: 3 } as const
export type TreeTone = (typeof TreeTone)[keyof typeof TreeTone]

const KIND_BY_GENUS: Record<string, TreeKind> = {
  ginkgo: TreeKind.Columnar,
  pyrus: TreeKind.Columnar,
  tristaniopsis: TreeKind.Columnar,
  lophostemon: TreeKind.Columnar,
  liquidambar: TreeKind.Columnar,
  cupressus: TreeKind.Columnar,
  podocarpus: TreeKind.Columnar,
  afrocarpus: TreeKind.Columnar,
  carpinus: TreeKind.Columnar,
  populus: TreeKind.Columnar,
  calocedrus: TreeKind.Columnar,
  sequoia: TreeKind.Columnar,
  washingtonia: TreeKind.FanPalm,
  phoenix: TreeKind.DatePalm,
  syagrus: TreeKind.FeatherPalm,
  archontophoenix: TreeKind.FeatherPalm,
  butia: TreeKind.FeatherPalm,
  trachycarpus: TreeKind.FeatherPalm,
  chamaerops: TreeKind.FeatherPalm,
  livistona: TreeKind.FeatherPalm,
  brahea: TreeKind.FeatherPalm,
  cordyline: TreeKind.Cordyline,
  dracaena: TreeKind.Cordyline,
  yucca: TreeKind.Cordyline,
}

// Gray-green: eucalypts, olives, tea trees, acacias. Deep: glossy evergreens.
// Everything else, deciduous and otherwise, gets the brighter green.
const TONE_BY_GENUS: Record<string, TreeTone> = {
  olea: TreeTone.Gray,
  eucalyptus: TreeTone.Gray,
  corymbia: TreeTone.Gray,
  melaleuca: TreeTone.Gray,
  leptospermum: TreeTone.Gray,
  acacia: TreeTone.Gray,
  callistemon: TreeTone.Gray,
  maytenus: TreeTone.Gray,
  geijera: TreeTone.Gray,
  arbutus: TreeTone.Gray,
  ficus: TreeTone.Deep,
  magnolia: TreeTone.Deep,
  pittosporum: TreeTone.Deep,
  lophostemon: TreeTone.Deep,
  metrosideros: TreeTone.Deep,
  laurus: TreeTone.Deep,
  ligustrum: TreeTone.Deep,
  eriobotrya: TreeTone.Deep,
  ceratonia: TreeTone.Deep,
  quercus: TreeTone.Deep,
  tristaniopsis: TreeTone.Deep,
  cupressus: TreeTone.Deep,
  podocarpus: TreeTone.Deep,
  afrocarpus: TreeTone.Deep,
}

export const isPalmKind = (k: number) => k >= TreeKind.FanPalm

const genusOf = (species: string) => species.split('::')[0].trim().split(/\s+/)[0].toLowerCase()

// Rows that aren't a standing tree: empty or proposed sites and stumps.
export function isNotATree(species: string): boolean {
  return /planting site|potential site|stump/i.test(species)
}

// Unknown species ("Tree(s) ::", "::", empty) come out Broad, Bright.
export function classifySpecies(species: string): { kind: TreeKind; tone: TreeTone } {
  const genus = genusOf(species)
  const kind = Object.hasOwn(KIND_BY_GENUS, genus) ? KIND_BY_GENUS[genus] : TreeKind.Broad
  const tone = isPalmKind(kind) ? TreeTone.Palm : Object.hasOwn(TONE_BY_GENUS, genus) ? TONE_BY_GENUS[genus] : TreeTone.Bright
  return { kind, tone }
}

// DBH as stored: whole inches 1-MAX_DBH_IN, 0 = unknown. The inventory's
// mapdbh is free text; implausible values (none, 0, over MAX_DBH_IN) count as
// unknown.
export const MAX_DBH_IN = 100
export function parseDbh(raw: string | undefined): number {
  const v = Math.round(Number(raw))
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(v) && v >= 1 && v <= MAX_DBH_IN ? v : 0
}

export interface TreeSize {
  height: number // ground to crown top, m
  crown: number // crown (or frond spread) radius, m
}

// When DBH is unknown: a typical established street tree.
export const DEFAULT_DBH_IN = 8

// Broad and columnar trees grow with trunk diameter: a 6 in tree comes out
// ~5 m tall with a ~2.1 m crown radius, a 24 in tree ~13 m and ~5.3 m.
// Palms don't: a palm's trunk barely thickens as it grows, so its height is
// the genus's typical mature street height.
const PALM: Record<number, TreeSize> = {
  [TreeKind.FanPalm]: { height: 17, crown: 2.6 },
  [TreeKind.DatePalm]: { height: 11, crown: 4.5 },
  [TreeKind.FeatherPalm]: { height: 10, crown: 3 },
  [TreeKind.Cordyline]: { height: 5, crown: 1.4 },
}

export function treeSize(kind: TreeKind, dbhIn: number): TreeSize {
  if (isPalmKind(kind)) return PALM[kind]
  const d = dbhIn > 0 ? dbhIn : DEFAULT_DBH_IN
  const height = Math.min(20, Math.max(3.5, 2.5 + 0.44 * d))
  const crown = Math.min(9, Math.max(1.2, 1 + 0.18 * d))
  return kind === TreeKind.Columnar ? { height: height * 1.1, crown: crown * 0.55 } : { height, crown }
}
