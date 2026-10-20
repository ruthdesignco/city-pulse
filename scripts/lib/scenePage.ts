// The running dev build in a headless browser, for scripts that need to look
// at the rendered scene (shot.ts, calibrate.ts).
//
// Starts Vite's dev server in-process (its own JS API, not a spawned CLI
// child process, so there's nothing to leak or orphan on Windows) on an
// OS-assigned free port, opens it in a fresh headless Chromium -- Playwright's
// own bundled browser, launched with no userDataDir, so there's no real
// browser profile involved at all, every launch starts from a blank slate --
// waits for the scene to load and settle, hands the page over, and closes
// everything back down.

import { join } from 'node:path'
import { type Page, chromium } from 'playwright'
import { createServer } from 'vite'

export const ROOT = join(import.meta.dirname, '..', '..')
export const WIDTH = 1920
export const HEIGHT = 1080
// Time after the page's own network-idle for city.bin/routes.json to decode,
// the scene to extrude/build, and the first few frames (shadows, SSAO) to
// stabilize -- a guess, not measured; widen it if shots still look mid-load.
const SETTLE_MS = 4000

// `query` is added to ?demo, which hides the dev-only FPS/Stats overlay
// (App.tsx), so the page matches what a viewer, not a developer, would see,
// and to ?quality=high, so the frame-rate monitor never steps a shot or a
// calibration down (quality.ts) and every run renders the same way.
// What the page itself reported: page errors, and console errors (three.js
// logs shader compile failures there). npm run smoke fails on these.
export interface PageReport {
  errors: string[]
}

// SCENE_GL=software renders with SwiftShader instead of the GPU: what CI
// (Linux, no GPU) has. Slow, but it compiles every shader the same way.
const SOFTWARE_GL = process.env.SCENE_GL === 'software'

export async function withScenePage(label: string, query: Record<string, string>, withPage: (page: Page, report: PageReport) => Promise<void>) {
  const server = await createServer({ root: ROOT, server: { port: 0 }, logLevel: 'warn' })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (!url) throw new Error(`${label}: vite did not report a local URL`)
  console.log(`${label}: dev server at ${url}`)

  // On the real GPU: headless Chromium otherwise falls back to software
  // WebGL, which rendered the scene at ~1 fps and, with the street trees,
  // too slowly to load within the page timeouts. (ANGLE's Metal backend is
  // macOS only; elsewhere Chromium ignores the flag and picks its default.)
  const browser = await chromium.launch({
    headless: true,
    args: SOFTWARE_GL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  })
  const report: PageReport = { errors: [] }
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
    // Surface what the page itself saw -- a shot that looks wrong is often a
    // failed asset load or a thrown error, not just a color to retune.
    page.on('console', (msg) => {
      console.log(`${label}: [page ${msg.type()}] ${msg.text()}`)
      if (msg.type() === 'error') report.errors.push(msg.text())
    })
    page.on('pageerror', (err) => {
      console.error(`${label}: [page error] ${err}`)
      report.errors.push(String(err))
    })
    page.on('requestfailed', (req) => console.error(`${label}: [request failed] ${req.url()} -- ${req.failure()?.errorText}`))
    page.on('response', (res) => {
      if (!res.ok()) console.error(`${label}: [http ${res.status()}] ${res.url()}`)
    })
    await page.goto(`${url}?${new URLSearchParams({ demo: '', quality: 'high', ...query })}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await page.waitForTimeout(SETTLE_MS)
    await withPage(page, report)
  } finally {
    await browser.close()
    await server.close()
  }
}
