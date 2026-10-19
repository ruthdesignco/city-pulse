import { type ReactNode, useState } from 'react'
import { detectWebGL } from './webgl.ts'

// Checked once per page load: WebGL support doesn't change mid-session, and
// mounting <Canvas> without it throws from deep inside three.js/r3f instead
// of showing anything a visitor can make sense of.
let supported: boolean | undefined

export function WebGLGate({ children }: { children: ReactNode }) {
  const [ok] = useState(() => (supported ??= detectWebGL()))
  if (ok) return children
  return (
    <div className="webgl-fallback">
      <p>This demo needs WebGL, which this browser or device isn't offering right now.</p>
      <p>Try a recent Chrome, Firefox, or Edge, with hardware acceleration turned on.</p>
    </div>
  )
}
