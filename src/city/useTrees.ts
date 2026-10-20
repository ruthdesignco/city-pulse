import { use } from 'react'
import { type TreesData, decodeTrees } from './treeFormat.ts'
import treesUrl from '../data/trees.bin?url' // hashed by the build, as city.bin (useCity.ts)

let treesPromise: Promise<TreesData> | undefined

export function loadTrees(): Promise<TreesData> {
  treesPromise ??= fetch(treesUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`trees.bin: HTTP ${res.status}. Run \`npm run bake:trees\` first.`)
      return res.arrayBuffer()
    })
    .then(decodeTrees)
    // Same as useCity.ts: don't cache a rejection, so a retry refetches.
    .catch((err: unknown) => {
      treesPromise = undefined
      throw err
    })
  return treesPromise
}

// Suspends until src/data/trees.bin is fetched and decoded.
export function useTrees(): TreesData {
  return use(loadTrees())
}
