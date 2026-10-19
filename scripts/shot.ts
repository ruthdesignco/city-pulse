// Headless screenshot of the running dev build, so visual changes can be
// reviewed without a live browser connection.
//
//   npm run shot              shots/opening.png
//   npm run shot -- closer    shots/closer.png (any name, same opening camera)
//   npm run shot -- closeup --view market
//                             shots/closeup.png from a camera preset
//                             (src/scene/shots.ts PRESETS, ?view=<name>)
//
// Starts Vite's dev server in-process (its own JS API, not a spawned CLI
// child process, so there's nothing to leak or orphan on Windows) on an
// OS-assigned free port, opens it in a fresh headless Chromium -- Playwright's
// own bundled browser, launched with no userDataDir, so there's no real
// browser profile involved at all, every launch starts from a blank slate --
// waits for the scene to load and settle, screenshots the viewport, and
// closes everything back down.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = join(import.meta.dirname, '..')
const SHOTS_DIR = join(ROOT, 'shots')
const WIDTH = 1920
const HEIGHT = 1080
// Time after the page's own network-idle for city.bin/routes.json to decode,
// the scene to extrude/build, and the first few frames (shadows, SSAO) to
// stabilize -- a guess, not measured; widen it if shots still look mid-load.
const SETTLE_MS = 4000

async function main() {
  const args = process.argv.slice(2)
  const viewAt = args.indexOf('--view')
  const view = viewAt >= 0 ? args[viewAt + 1] : undefined
  if (viewAt >= 0 && !view) throw new Error('shot: --view needs a preset name')
  const name = args.find((a, i) => !a.startsWith('--') && i !== viewAt + 1) ?? 'opening'
  mkdirSync(SHOTS_DIR, { recursive: true })

  const server = await createServer({ root: ROOT, server: { port: 0 }, logLevel: 'warn' })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (!url) throw new Error('shot: vite did not report a local URL')
  console.log(`shot: dev server at ${url}`)

  const browser = await chromium.launch({ headless: true })
  try {
    // ?demo hides the dev-only FPS/Stats overlay (App.tsx), for a clean shot
    // that matches what a viewer, not a developer, would see.
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
    // Surface what the page itself saw -- a shot that looks wrong is often a
    // failed asset load or a thrown error, not just a color to retune.
    page.on('console', (msg) => console.log(`shot: [page ${msg.type()}] ${msg.text()}`))
    page.on('pageerror', (err) => console.error(`shot: [page error] ${err}`))
    page.on('requestfailed', (req) => console.error(`shot: [request failed] ${req.url()} -- ${req.failure()?.errorText}`))
    page.on('response', (res) => {
      if (!res.ok()) console.error(`shot: [http ${res.status()}] ${res.url()}`)
    })
    const query = new URLSearchParams({ demo: '' })
    if (view) query.set('view', view)
    await page.goto(`${url}?${query}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await page.waitForTimeout(SETTLE_MS)
    const out = join(SHOTS_DIR, `${name}.png`)
    await page.screenshot({ path: out })
    console.log(`shot: saved ${out}`)
  } finally {
    await browser.close()
    await server.close()
  }
}

await main()
