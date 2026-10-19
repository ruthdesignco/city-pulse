// Headless screenshot of the running dev build, so visual changes can be
// reviewed without a live browser connection.
//
//   npm run shot              shots/opening.png
//   npm run shot -- closer    shots/closer.png (any name, same opening camera)
//   npm run shot -- closeup --view market
//                             shots/closeup.png from a camera preset
//                             (src/scene/shots.ts PRESETS, ?view=<name>)
//
// The browser and dev server come from scripts/lib/scenePage.ts.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, withScenePage } from './lib/scenePage.ts'

const SHOTS_DIR = join(ROOT, 'shots')

async function main() {
  const args = process.argv.slice(2)
  const viewAt = args.indexOf('--view')
  const view = viewAt >= 0 ? args[viewAt + 1] : undefined
  if (viewAt >= 0 && !view) throw new Error('shot: --view needs a preset name')
  const name = args.find((a, i) => !a.startsWith('--') && i !== viewAt + 1) ?? 'opening'
  mkdirSync(SHOTS_DIR, { recursive: true })

  await withScenePage('shot', view ? { view } : {}, async (page) => {
    const out = join(SHOTS_DIR, `${name}.png`)
    await page.screenshot({ path: out })
    console.log(`shot: saved ${out}`)
  })
}

await main()
