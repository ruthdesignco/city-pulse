/// <reference lib="dom" />
// The wind shot set: the opening and street cameras at midday, calm and
// strong, rendered the same way every time:
//
//   npm run shots:wind    shots/wind-<view>-<wind>.png
//
// From the opening camera calm water should read close to a mirror and a
// strong wind as fast, broken chop; from the street the trees lean and rock
// a little, never bend. Clear weather, a weekday.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, withScenePage } from './lib/scenePage.ts'

export const WIND_SHOTS = [
  { view: 'opening', wind: 'calm' },
  { view: 'opening', wind: 'strong' },
  { view: 'street', wind: 'calm' },
  { view: 'street', wind: 'strong' },
]

const SHOTS_DIR = join(ROOT, 'shots')
mkdirSync(SHOTS_DIR, { recursive: true })
for (const s of WIND_SHOTS) {
  const out = join(SHOTS_DIR, `wind-${s.view}-${s.wind}.png`)
  await withScenePage(`shots:wind ${s.view} ${s.wind}`, { ...s, time: '12:00', weather: 'clear', day: 'weekday' }, async (page, report) => {
    // A broken shader drops what it draws; don't save a picture of that.
    const shaderErrors = report.errors.filter((e) => /shader error|webglprogram|validate_status/i.test(e))
    if (shaderErrors.length) throw new Error(`shots:wind: ${s.view} ${s.wind}: ${shaderErrors.length} shader error(s); run npm run smoke`)
    await page.screenshot({ path: out })
    console.log(`shots:wind: saved ${out}`)
  })
}
