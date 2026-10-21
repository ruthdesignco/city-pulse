/// <reference lib="dom" />
// The weather shot set: the two camera presets that matter most under
// each ?weather= preset at midday, and the fog at night, rendered the same
// way every time:
//
//   npm run shots:weather    shots/wx-<view>-<weather>-<HHMM>.png
//
// From the opening camera the fog should lie low over the streets and the
// Bay with the tallest towers standing out of it; from the cinematic camera,
// inside the layer, the distance should go gray. The wind is pinned calm and
// the day to a weekday.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, withScenePage } from './lib/scenePage.ts'

export const WEATHER_SHOTS = [
  { view: 'cinematic', weather: 'clear', time: '12:00' },
  { view: 'cinematic', weather: 'fog', time: '12:00' },
  { view: 'cinematic', weather: 'overcast', time: '12:00' },
  { view: 'opening', weather: 'clear', time: '12:00' },
  { view: 'opening', weather: 'fog', time: '12:00' },
  { view: 'opening', weather: 'overcast', time: '12:00' },
  { view: 'cinematic', weather: 'fog', time: '22:00' },
  { view: 'opening', weather: 'fog', time: '22:00' },
]

const SHOTS_DIR = join(ROOT, 'shots')
mkdirSync(SHOTS_DIR, { recursive: true })
for (const s of WEATHER_SHOTS) {
  const out = join(SHOTS_DIR, `wx-${s.view}-${s.weather}-${s.time.replace(':', '')}.png`)
  await withScenePage(`shots:weather ${s.view} ${s.weather} ${s.time}`, { ...s, wind: 'calm', day: 'weekday' }, async (page, report) => {
    // A broken shader drops what it draws; don't save a picture of that.
    const shaderErrors = report.errors.filter((e) => /shader error|webglprogram|validate_status/i.test(e))
    if (shaderErrors.length) throw new Error(`shots:weather: ${s.view} ${s.weather}: ${shaderErrors.length} shader error(s); run npm run smoke`)
    await page.screenshot({ path: out })
    console.log(`shots:weather: saved ${out}`)
  })
}
