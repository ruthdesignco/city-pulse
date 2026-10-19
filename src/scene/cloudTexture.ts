// A soft radial-gradient puff, generated once at runtime. drei's <Clouds>
// defaults to fetching its cloud sprite from an external CDN
// (pmndrs/drei-assets) -- a runtime fetch this app never makes elsewhere,
// and that repo carries no clear license to commit the image into a public
// repo. Procedural instead: zero file size, zero licensing question, same
// pattern as every other texture-free surface in this app.
//
// <Clouds>'s `texture` prop only accepts a URL string (it loads it itself
// via drei's useTexture); a data: URL satisfies that without ever being
// fetched over the network -- the browser decodes it inline, same as any
// other image, so this is still "nothing fetched at runtime."
const SIZE = 256

export function createCloudTextureDataUrl(): string {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  const r = SIZE / 2
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.8)')
  gradient.addColorStop(0.75, 'rgba(255,255,255,0.25)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, SIZE, SIZE)
  return canvas.toDataURL('image/png')
}
