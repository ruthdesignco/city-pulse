/// <reference lib="dom" />
// The frame-rate budget (SPEC: 60 fps on a recent MacBook): every camera
// preset in each weather and light, rendered at a Retina laptop's size (a
// 1728 x 1000 window at 2x, which the app draws at its 1.5 pixel-ratio cap:
// 2592 x 1500) with frames not held to the display's refresh, so what's
// measured is the scene's own frame time. A run passes at a median of
// MEDIAN_MS or less (headroom under the 16.7 ms of 60 fps) and a 95th
// percentile within P95_MS; frames over HITCH_MS after the first view has
// settled are counted as hitches.
//
//   npm run fps                                 every preset, weather, time
//   npm run fps -- --views opening,marin --weather fog --time 16:50
//   npm run fps -- --quality high               with SSAO, as shots render
//
// Headless, on the real GPU (scenePage.ts): one dev server and browser, a
// fresh page load per case. Each row says which quality step (quality.ts)
// the page was on when measured, since the frame-rate floor may have
// stepped it down. Uncapped numbers are a measure, not what a viewer sees:
// check a change on the display itself too.

import { PRESETS } from '../src/scene/shots.ts'
import { withScenePage } from './lib/scenePage.ts'

const VIEWPORT = { width: 1728, height: 1000, scale: 2 }
const WARMUP_MS = 3000
const MEASURE_MS = 6000
const MEDIAN_MS = 13.3
const P95_MS = 16.7
const HITCH_MS = 50
// As scenePage.ts waits after the tiles settle on its own first load.
const SETTLE_MS = 2000

function list(args: string[], name: string, all: string[]): string[] {
  const i = args.indexOf(`--${name}`)
  return i < 0 ? all : args[i + 1].split(',')
}

interface Frames {
  step: string
  fps: number
  median: number
  p95: number
  max: number
  hitches: number
}

async function main() {
  const args = process.argv.slice(2)
  const views = list(args, 'views', Object.keys(PRESETS))
  const weathers = list(args, 'weather', ['clear', 'fog', 'overcast'])
  const times = list(args, 'time', ['12:00', '16:50'])
  // The page's own default quality (no ?quality) unless asked.
  const quality = list(args, 'quality', [''])[0]
  const rows: string[] = []
  let failed = 0
  const cases = views.flatMap((view) => weathers.flatMap((weather) => times.map((time) => ({ view, weather, time }))))
  const queryOf = (c: (typeof cases)[number]) => ({ ...c, wind: 'calm', day: 'weekday', quality })
  await withScenePage(
    'fps',
    queryOf(cases[0]),
    async (page) => {
      for (const [k, c] of cases.entries()) {
        if (k > 0) {
          const url = new URL(page.url())
          url.search = String(new URLSearchParams({ demo: '', ...queryOf(c) }))
          await page.goto(String(url), { waitUntil: 'networkidle' })
          await page.waitForSelector('canvas')
          // Every tile in, at the level its distance wants (TileStream.ts).
          await page.waitForFunction(() => (window as { __cityIdle?: boolean }).__cityIdle === true, undefined, { timeout: 60_000, polling: 250 })
          await page.waitForTimeout(SETTLE_MS)
        }
        await page.waitForTimeout(WARMUP_MS)
        const f = await page.evaluate(
          ({ ms, hitch }) =>
            new Promise<Frames>((resolve) => {
              const t: number[] = []
              const tick = (now: number) => {
                t.push(now)
                if (now - t[0] < ms) return requestAnimationFrame(tick)
                const d = t
                  .slice(1)
                  .map((x, i) => x - t[i])
                  .sort((a, b) => a - b)
                resolve({
                  step: document.documentElement.dataset.quality ?? '?',
                  fps: d.length / ((t[t.length - 1] - t[0]) / 1000),
                  median: d[d.length >> 1],
                  p95: d[Math.floor(d.length * 0.95)],
                  max: d[d.length - 1],
                  hitches: d.filter((x) => x > hitch).length,
                })
              }
              requestAnimationFrame(tick)
            }),
          { ms: MEASURE_MS, hitch: HITCH_MS },
        )
        const pass = f.median <= MEDIAN_MS && f.p95 <= P95_MS
        if (!pass) failed++
        const row = `${pass ? 'pass' : 'FAIL'}  ${c.view.padEnd(13)} ${c.weather.padEnd(9)} ${c.time}  step ${f.step}  ${f.fps.toFixed(0).padStart(4)} fps  median ${f.median.toFixed(1).padStart(5)} ms  p95 ${f.p95.toFixed(1).padStart(5)} ms  max ${f.max.toFixed(0).padStart(4)} ms  hitches ${f.hitches}`
        console.log(row)
        rows.push(row)
      }
    },
    { viewport: VIEWPORT, uncapped: true },
  )
  console.log(`\nfps: ${VIEWPORT.width}x${VIEWPORT.height} at ${VIEWPORT.scale}x, uncapped; pass at median <= ${MEDIAN_MS} ms and p95 <= ${P95_MS} ms\n${rows.join('\n')}`)
  console.log(`fps: ${rows.length - failed} of ${rows.length} pass`)
  if (failed) process.exitCode = 1
}

await main()
