/// <reference lib="dom" />
// How bright palette colors actually render: opens the scene with
// ?calibrate (src/scene/Calibration.tsx), screenshots the sunlit swatches,
// and prints each one's palette value next to what it rendered as.
//
//   npm run calibrate                 at the real San Francisco time
//   npm run calibrate -- --time 12:00 at a set time (?time=)
//
// By day the exposure keeps sunlit ground at its palette value, so the
// ratios hold from morning to golden hour; at night the scene is exposed
// down to NIGHT_EXPOSURE (skyState.ts), and the ratios with it.
//
// "ratio" is rendered / palette relative luminance in linear light: 1.00
// means a sunlit horizontal surface shows exactly its palette value.

import { withScenePage } from './lib/scenePage.ts'

const SAMPLE_PX = 7 // averaged square around each swatch's center

type Rgb = [number, number, number] // sRGB 0-255
// Written by src/scene/Calibration.tsx each frame.
type Spot = { name: string; hex: string; x: number; y: number }

const toLinear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]: Rgb) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
const fromHex = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

async function main() {
  const i = process.argv.indexOf('--time')
  const time = i >= 0 ? process.argv[i + 1] : undefined
  if (time !== undefined && !/^\d{1,2}:\d{2}$/.test(time)) throw new Error('calibrate: --time must be HH:MM')
  await withScenePage('calibrate', { view: 'calibrate', calibrate: '', ...(time ? { time } : {}) }, async (page) => {
    const png = (await page.screenshot()).toString('base64')
    const samples = await page.evaluate(
      async ({ png, half }) => {
        const spots = (window as Window & { __calibration?: Spot[] }).__calibration
        if (!spots) throw new Error('no window.__calibration: is ?calibrate wired up?')
        const img = new Image()
        img.src = `data:image/png;base64,${png}`
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        return spots.map(({ name, hex, x, y }) => {
          const d = ctx.getImageData(Math.round(x) - half, Math.round(y) - half, 2 * half + 1, 2 * half + 1).data
          const sum = [0, 0, 0]
          for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += d[i + c]
          return { name, hex, rendered: sum.map((v) => v / (d.length / 4)) }
        })
      },
      { png, half: Math.floor(SAMPLE_PX / 2) },
    )

    console.log('\nswatch                palette   rendered  ratio')
    const ratios = samples.map((s) => {
      const ratio = luminance(s.rendered as Rgb) / luminance(fromHex(s.hex))
      console.log(`${s.name.padEnd(21)} ${s.hex}   ${toHex(s.rendered)}   ${ratio.toFixed(2)}`)
      return ratio
    })
    ratios.sort((a, b) => a - b)
    console.log(`\nmedian ratio ${ratios[ratios.length >> 1].toFixed(2)} at ${time ?? 'the real time'} (1.00 = renders as its palette value)`)
  })
}

await main()
