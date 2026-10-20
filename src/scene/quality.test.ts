import { describe, expect, it } from 'vitest'
import { LOWEST_STEP, QUALITY_STEPS, isSoftwareRenderer, monitorEnabled, startStep, stepDown } from './quality.ts'

describe('quality steps', () => {
  it('starts at full quality and only ever gets cheaper', () => {
    const full = QUALITY_STEPS[0]
    expect(full).toEqual({ ssao: true, shadowMapSize: 4096, maxDpr: 1.5, msaa: 4 })
    for (let i = 1; i < QUALITY_STEPS.length; i++) {
      const [a, b] = [QUALITY_STEPS[i - 1], QUALITY_STEPS[i]]
      expect(Number(b.ssao)).toBeLessThanOrEqual(Number(a.ssao))
      expect(b.shadowMapSize).toBeLessThanOrEqual(a.shadowMapSize)
      expect(b.maxDpr).toBeLessThanOrEqual(a.maxDpr)
      expect(b.msaa).toBeLessThanOrEqual(a.msaa)
      expect(b).not.toEqual(a) // every step changes something
    }
  })

  it('drops in the board order: SSAO, then shadows, then dpr, then MSAA', () => {
    expect(QUALITY_STEPS.slice(1).map((s) => [s.ssao, s.shadowMapSize, s.maxDpr, s.msaa])).toEqual([
      [false, 4096, 1.5, 4],
      [false, 2048, 1.5, 4],
      [false, 2048, 1, 4],
      [false, 2048, 1, 0],
    ])
  })

  it('steps down one rung at a time and stops at the floor', () => {
    expect(stepDown(0)).toBe(1)
    expect(stepDown(LOWEST_STEP)).toBe(LOWEST_STEP)
  })
})

describe('starting step', () => {
  it('starts full by default, at the floor on ?quality=low or a software renderer', () => {
    expect(startStep(null, 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)')).toBe(0)
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
