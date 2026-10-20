/// <reference lib="dom" />
// Headless screenshot of the running dev build, so visual changes can be
// reviewed without a live browser connection.
//
//   npm run shot              shots/opening.png
//   npm run shot -- closer    shots/closer.png (any name, same opening camera)
//   npm run shot -- closeup --view market
//                             shots/closeup.png from a camera preset
//                             (src/scene/shots.ts PRESETS, ?view=<name>)
//   --replay <name>           play public/recordings/<name>.json instead of
//                             the live feed (?replay=<name>)
//   --min-vehicles <n>        wait until at least n vehicles are in the
//                             middle of the frame first (default 1, 0 to skip)
//
// The feed is live, so a close view can be empty at any given moment; the
// shot waits (up to WAIT_VEHICLES_MS) for vehicles to drive into frame
// rather than saving an empty street. The browser and dev server come from
// scripts/lib/scenePage.ts.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, withScenePage } from './lib/scenePage.ts'

declare global {
  interface Window {
    __vehiclesInView?: number // src/transit/Vehicles.tsx, in ?demo
  }
}

const SHOTS_DIR = join(ROOT, 'shots')
// A few feed updates (~80 s apart) and plenty of interpolated driving.
const WAIT_VEHICLES_MS = 240_000
// After the count is met, let the newest arrivals finish fading in.
const ARRIVE_MS = 1000

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return undefined
  const v = args[i + 1]
  if (v === undefined || v.startsWith('--')) throw new Error(`shot: --${name} needs a value`)
  return v
}

async function main() {
  const args = process.argv.slice(2)
  const view = flag(args, 'view')
  const replay = flag(args, 'replay')
  const minVehicles = Number(flag(args, 'min-vehicles') ?? 1)
  if (!Number.isInteger(minVehicles) || minVehicles < 0) throw new Error('shot: --min-vehicles must be a whole number')
  const name = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'opening'
  mkdirSync(SHOTS_DIR, { recursive: true })

  const query: Record<string, string> = {}
  if (view) query.view = view
  if (replay) query.replay = replay
  await withScenePage('shot', query, async (page) => {
    if (minVehicles > 0) {
      const started = Date.now()
      try {
        await page.waitForFunction((n) => (window.__vehiclesInView ?? 0) >= n, minVehicles, { timeout: WAIT_VEHICLES_MS, polling: 500 })
      } catch {
        const seen = await page.evaluate(() => window.__vehiclesInView ?? 0)
        throw new Error(`shot: only ${seen} of ${minVehicles} vehicles in frame after ${WAIT_VEHICLES_MS / 1000} s; is the feed live?`)
      }
      console.log(`shot: ${minVehicles}+ vehicles in frame after ${((Date.now() - started) / 1000).toFixed(0)} s`)
      await page.waitForTimeout(ARRIVE_MS)
    }
    const out = join(SHOTS_DIR, `${name}.png`)
    await page.screenshot({ path: out })
    console.log(`shot: saved ${out}`)
  })
}

await main()
