import { describe, expect, it } from 'vitest'
import { waterNormalData } from './waterNormals.ts'

const SIZE = 64
const data = waterNormalData(SIZE)
const at = (i: number, j: number) => {
  const k = ((((j % SIZE) + SIZE) % SIZE) * SIZE + (((i % SIZE) + SIZE) % SIZE)) * 4
  return [data[k], data[k + 1], data[k + 2]].map((v) => (v / 255) * 2 - 1)
}

describe('waterNormalData', () => {
  it('tiles seamlessly: the step across an edge is no bigger than steps inside', () => {
    const step = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1])
    let inside = 0
    let edge = 0
    for (let j = 0; j < SIZE; j++) {
      inside = Math.max(inside, step(at(SIZE / 2 - 1, j), at(SIZE / 2, j)))
      edge = Math.max(edge, step(at(SIZE - 1, j), at(SIZE, j)))
    }
    expect(edge).toBeLessThan(inside * 1.5)
  })

  it('is gentle water on average: flat overall, every normal pointing up', () => {
    let sx = 0
    let sz = 0
    for (let j = 0; j < SIZE; j++)
      for (let i = 0; i < SIZE; i++) {
        const [x, z, up] = at(i, j)
        sx += x
        sz += z
        expect(up).toBeGreaterThan(0.6)
      }
    expect(Math.abs(sx / SIZE ** 2)).toBeLessThan(0.02)
    expect(Math.abs(sz / SIZE ** 2)).toBeLessThan(0.02)
  })
})
