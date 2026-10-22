// The render's floor for slower GPUs: the scene starts at full quality and,
// if the frame rate stays below DECLINE_BELOW_FPS, steps down one rung at a
// time (App.tsx, via drei's PerformanceMonitor), cheapest look-loss first.
// It never steps back up, so it can't oscillate. No settings UI (Board of
// Vibes 2026-10-20).
//
// SSAO is for ?quality=high only (shots, calibrate, recordings): with its
// normal pass (a second render of the whole scene) it took ~11 ms of a
// 22 ms frame on an M4 Pro at Retina size (2592 x 1500), holding the page
// to ~46 fps. The ground's baked contact occlusion (groundShading.ts) and
// the walls' base darkening (Buildings.tsx) stand in for it. Then what
// costs most is pixels: the pixel ratio comes down before the shadow map.
//
//   ?quality=low    start at the floor
//   ?quality=high   SSAO on, never step down (shots, calibrate)

export interface QualityStep {
  ssao: boolean // SSAO and the normal pass it needs
  shadowMapSize: number
  maxDpr: number
  // MSAA samples: the canvas's own when drawing straight to it (set when
  // it's made, App.tsx), the composer's with SSAO; 0 draws through the
  // composer without any.
  msaa: number
}

// Step 0 is ?quality=high's; pages start at DEFAULT_STEP.
export const QUALITY_STEPS: readonly QualityStep[] = [
  { ssao: true, shadowMapSize: 4096, maxDpr: 1.5, msaa: 4 },
  { ssao: false, shadowMapSize: 4096, maxDpr: 1.5, msaa: 4 },
  { ssao: false, shadowMapSize: 4096, maxDpr: 1.25, msaa: 4 },
  { ssao: false, shadowMapSize: 2048, maxDpr: 1.25, msaa: 4 },
  { ssao: false, shadowMapSize: 2048, maxDpr: 1, msaa: 4 },
  { ssao: false, shadowMapSize: 2048, maxDpr: 1, msaa: 0 },
]
export const DEFAULT_STEP = 1
export const LOWEST_STEP = QUALITY_STEPS.length - 1

// Under 60 with room for a slow moment: at 30 (until 2026-10) the floor
// never caught a page held to 48.
export const DECLINE_BELOW_FPS = 50
// Load-time hitches (extrusion, shader compiles) don't count.
export const MONITOR_WARMUP_MS = 5000

export type QualityParam = 'low' | 'high' | null

// Software WebGL (no GPU) renders this scene at 1-2 fps; the gate refuses
// it where the browser says so (webgl.ts), and if one gets through anyway it
// starts at the floor.
export function isSoftwareRenderer(renderer: string | null): boolean {
  return !!renderer && /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)
}

export function startStep(param: QualityParam, renderer: string | null): number {
  if (param === 'high') return 0
  if (param === 'low' || isSoftwareRenderer(renderer)) return LOWEST_STEP
  return DEFAULT_STEP
}

// Whether the frame-rate monitor runs at all.
export const monitorEnabled = (param: QualityParam) => param !== 'high'

export const stepDown = (step: number) => Math.min(LOWEST_STEP, step + 1)
