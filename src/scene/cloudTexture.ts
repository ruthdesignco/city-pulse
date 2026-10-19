import { CanvasTexture } from 'three'

// A cumulus-ish puff -- several overlapping soft lobes, not one uniform
// circle, so a single sprite reads as a lumpy cloud silhouette instead of a
// blurry blob. Generated once at runtime, used as a three.js Sprite's map
// (Atmosphere.tsx's clouds), not loaded via a URL at all, so there's no
// fetch, no license question (drei's <Clouds> defaults to an external CDN
// image of unclear license, which this avoids entirely) and no
// texture-loading pipeline to debug: a Sprite just needs a Texture object,
// synchronously available the moment this returns.
const SIZE = 256

// Deterministic lobe layout (fraction of SIZE): a wide base with smaller
// lobes piled toward the top, the classic cumulus silhouette.
const LOBES = [
  { x: 0.5, y: 0.62, r: 0.4 },
  { x: 0.28, y: 0.64, r: 0.28 },
  { x: 0.74, y: 0.62, r: 0.3 },
  { x: 0.4, y: 0.42, r: 0.26 },
  { x: 0.62, y: 0.4, r: 0.25 },
  { x: 0.5, y: 0.3, r: 0.2 },
]

export function createCloudTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  ctx.globalCompositeOperation = 'lighter' // overlapping lobes build a denser, bumpier core
  for (const lobe of LOBES) {
    const cx = lobe.x * SIZE
    const cy = lobe.y * SIZE
    const r = lobe.r * SIZE
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)')
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.55)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}
