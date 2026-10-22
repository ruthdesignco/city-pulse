import { use } from 'react'
import { type TreesData, decodeTrees } from './treeFormat.ts'
import { LOAD_EXTENT, loadCity, tileUrl, tilesIn } from './useCity.ts'

let treesPromise: Promise<TreesData> | undefined

// The loaded tiles' trees (treeFormat.ts) end to end.
function join(parts: TreesData[]): TreesData {
  const count = parts.reduce((n, p) => n + p.header.count, 0)
  const out: TreesData = {
    header: { version: 3, i: 0, j: 0, x0: 0, z0: 0, count },
    coords: new Float32Array(2 * count),
    kind: new Uint8Array(count),
    tone: new Uint8Array(count),
    dbh: new Uint8Array(count),
    ring: new Uint8Array(count),
  }
  let at = 0
  for (const p of parts) {
    out.coords.set(p.coords, 2 * at)
    for (const k of ['kind', 'tone', 'dbh', 'ring'] as const) out[k].set(p[k], at)
    at += p.header.count
  }
  return out
}

export function loadTrees(): Promise<TreesData> {
  treesPromise ??= loadCity()
    .then(({ index }) =>
      Promise.all(
        tilesIn(index, LOAD_EXTENT).flatMap((t) =>
          t.files.trees
            ? [
                fetch(tileUrl(t.files.trees.file)).then((res) => {
                  if (!res.ok) throw new Error(`${t.files.trees!.file}: HTTP ${res.status}. Run \`npm run bake:trees\` first.`)
                  return res.arrayBuffer().then(decodeTrees)
                }),
              ]
            : [],
        ),
      ),
    )
    .then(join)
    // Same as useCity.ts: don't cache a rejection, so a retry refetches.
    .catch((err: unknown) => {
      treesPromise = undefined
      throw err
    })
  return treesPromise
}

// Suspends until the loaded tiles' trees are fetched and decoded.
export function useTrees(): TreesData {
  return use(loadTrees())
}
