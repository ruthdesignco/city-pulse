import { describe, expect, it } from 'vitest'
import { DEFAULT_STEP, LOWEST_STEP, QUALITY_STEPS, isSoftwareRenderer, monitorEnabled, startStep, stepDown } from './quality.ts'

describe('quality steps', () => {
  it('starts at full quality and only ever gets cheaper', () => {
    expect(QUALITY_STEPS[0]).toEqual({ ssao: true, shadowMapSize: 4096, maxDpr: 1.5, msaa: 4 })
    expect(QUALITY_STEPS[DEFAULT_STEP]).toEqual({ ssao: false, shadowMapSize: 4096, maxDpr: 1.5, msaa: 4 })
    for (let i = 1; i < QUALITY_STEPS.length; i++) {
      const [a, b] = [QUALITY_STEPS[i - 1], QUALITY_STEPS[i]]
      expect(Number(b.ssao)).toBeLessThanOrEqual(Number(a.ssao))
      expect(b.shadowMapSize).toBeLessThanOrEqual(a.shadowMapSize)
      expect(b.maxDpr).toBeLessThanOrEqual(a.maxDpr)
      expect(b.msaa).toBeLessThanOrEqual(a.msaa)
      expect(b).not.toEqual(a) // every step changes something
    }
  })

  it('drops pixels first, then shadows, then the rest of the pixels, then MSAA', () => {
    expect(QUALITY_STEPS.slice(DEFAULT_STEP + 1).map((s) => [s.ssao, s.shadowMapSize, s.maxDpr, s.msaa])).toEqual([
      [false, 4096, 1.25, 4],
      [false, 2048, 1.25, 4],
      [false, 2048, 1, 4],
      [false, 2048, 1, 0],
    ])
  })

  it('keeps SSAO for ?quality=high alone', () => {
    expect(QUALITY_STEPS.filter((s) => s.ssao)).toEqual([QUALITY_STEPS[0]])
  })

  it('steps down one rung at a time and stops at the floor', () => {
    expect(stepDown(DEFAULT_STEP)).toBe(DEFAULT_STEP + 1)
    expect(stepDown(LOWEST_STEP)).toBe(LOWEST_STEP)
  })
})

describe('starting step', () => {
  it('starts at the default step, at the floor on ?quality=low or a software renderer', () => {
    expect(startStep(null, 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)')).toBe(DEFAULT_STEP)
    expect(startStep('low', null)).toBe(LOWEST_STEP)
    expect(startStep(null, 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(LOWEST_STEP)
    expect(startStep(null, 'llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(LOWEST_STEP)
  })

  it('pins full quality on ?quality=high, with no monitor', () => {
    expect(startStep('high', 'llvmpipe')).toBe(0)
    expect(monitorEnabled('high')).toBe(false)
    expect(monitorEnabled(null)).toBe(true)
  })

  it('treats real GPUs as hardware', () => {
    for (const r of ['ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)', 'NVIDIA GeForce GTX 1650/PCIe/SSE2', 'Mali-G78'])
      expect(isSoftwareRenderer(r)).toBe(false)
    expect(isSoftwareRenderer(null)).toBe(false)
  })
})
