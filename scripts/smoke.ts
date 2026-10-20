/// <reference lib="dom" />
// The scene actually renders: for each time of day and camera below, the
// city mesh's shader compiles and draws, and nothing logs a shader or page
// error. A building shader that fails to compile drops the whole city while
// rooftops, trees and vehicles still render; nothing else would notice.
//
//   npm run smoke                       on this machine's GPU
//   SCENE_GL=software npm run smoke     with SwiftShader, as CI runs it

import { withScenePage } from './lib/scenePage.ts'

declare global {
  interface Window {
    __cityDrawn?: boolean // src/city/Buildings.tsx, in ?demo
  }
}

// Every time-of-day path (day, blue hour, night) and three cameras.
const CASES = [
  { view: 'opening', time: '12:00' },
  { view: 'cinematic', time: '18:30' },
  { view: 'street', time: '22:00' },
  // The drone-height night view: what broke there once (pools, windows) only
  // showed from that camera.
  { view: 'opening', time: '22:00' },
]
const DRAW_TIMEOUT_MS = 90_000
const SHADER_ERROR = /shader error|webglprogram|validate_status|compile/i

let failed = 0
for (const c of CASES) {
  const label = `smoke ${c.view} ${c.time}`
  await withScenePage(label, c, async (page, report) => {
    let drawn = false
    try {
      await page.waitForFunction(() => window.__cityDrawn === true, undefined, { timeout: DRAW_TIMEOUT_MS, polling: 250 })
      drawn = true
    } catch {
      drawn = false
    }
    const shaderErrors = report.errors.filter((e) => SHADER_ERROR.test(e))
    if (!drawn || shaderErrors.length) {
      failed++
      console.error(`${label}: FAIL -- city drawn: ${drawn}; shader errors: ${shaderErrors.length}`)
      for (const e of shaderErrors.slice(0, 3)) console.error(`  ${e.slice(0, 300)}`)
    } else {
      console.log(`${label}: ok -- city drawn, no shader errors (${report.errors.length} other page errors)`)
    }
  })
}
if (failed) {
  console.error(`\nsmoke: ${failed} of ${CASES.length} cases failed`)
  process.exit(1)
}
console.log(`\nsmoke: all ${CASES.length} cases passed`)
