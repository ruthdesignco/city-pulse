/// <reference lib="dom" />
// The time-of-day shot set, rendered the same way every time so changes to
// the light are checked from the views that have gone wrong before:
//
//   npm run shots:time    shots/tod-<view>-<HHMM>.png
//
// The opening view at night is in it because pools that look fine at street
// level read as polka dots from the drone camera, and windows that sparkle
// up close vanished from it; at 07:00 because a coarse lit-window table lit
// towers thicker before dawn than at 22:00. The weather is pinned clear (?weather=clear), so
// the live NWS report never changes these; npm run shots:weather has the fog
// and cloud set.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, withScenePage } from './lib/scenePage.ts'

export const TIME_SHOTS = [
  { view: 'cinematic', time: '08:00' },
  { view: 'cinematic', time: '12:00' },
  { view: 'cinematic', time: '16:50' },
  { view: 'cinematic', time: '18:30' },
  { view: 'cinematic', time: '22:00' },
  { view: 'opening', time: '07:00' },
  { view: 'opening', time: '18:30' },
  { view: 'opening', time: '22:00' },
  { view: 'street', time: '22:00' },
]

const SHOTS_DIR = join(ROOT, 'shots')
mkdirSync(SHOTS_DIR, { recursive: true })
for (const s of TIME_SHOTS) {
  const out = join(SHOTS_DIR, `tod-${s.view}-${s.time.replace(':', '')}.png`)
  await withScenePage(`shots:time ${s.view} ${s.time}`, { ...s, weather: 'clear' }, async (page, report) => {
    // A broken shader drops what it draws; don't save a picture of that.
    const shaderErrors = report.errors.filter((e) => /shader error|webglprogram|validate_status/i.test(e))
    if (shaderErrors.length) throw new Error(`shots:time: ${s.view} ${s.time}: ${shaderErrors.length} shader error(s); run npm run smoke`)
    await page.screenshot({ path: out })
    console.log(`shots:time: saved ${out}`)
  })
}
