// The render's floor for slower GPUs: the scene starts at full quality and,
// if the frame rate stays below DECLINE_BELOW_FPS, steps down one rung at a
// time (App.tsx, via drei's PerformanceMonitor), cheapest look-loss first.
// It never steps back up, so it can't oscillate. Four steps, no settings UI
// (Board of Vibes 2026-10-20): what breaks first on integrated GPUs is
// per-pixel cost (SSAO and its normal-pass re-render, 4x MSAA in half
// float), then shadow-map size.
//
//   ?quality=low    start at the floor
//   ?quality=high   stay at full quality, never step down (shots, calibrate)

export interface QualityStep {
  ssao: boolean // SSAO and the normal pass it needs
  shadowMapSize: number
  maxDpr: number
  msaa: number // EffectComposer multisampling
}

export const QUALITY_STEPS: readonly QualityStep[] = [
  { ssao: true, shadowMapSize: 4096, maxDpr: 1.5, msaa: 4 },
  { ssao: false, shadowMapSize: 4096, maxDpr: 1.5, msaa: 4 },
  { ssao: false, shadowMapSize: 2048, maxDpr: 1.5, msaa: 4 },
  { ssao: false, shadowMapSize: 2048, maxDpr: 1, msaa: 4 },
  { ssao: false, shadowMapSize: 2048, maxDpr: 1, msaa: 0 },
]
export const LOWEST_STEP = QUALITY_STEPS.length - 1

export const DECLINE_BELOW_FPS = 30
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
  return 0
}

// Whether the frame-rate monitor runs at all.
export const monitorEnabled = (param: QualityParam) => param !== 'high'

export const stepDown = (step: number) => Math.min(LOWEST_STEP, step + 1)
