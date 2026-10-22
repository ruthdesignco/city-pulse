import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import type { PerspectiveCamera } from 'three'
import { Ground } from './Ground.tsx'
import { Landmarks } from './Landmarks.tsx'
import { Rooftops } from './Rooftops.tsx'
import { Trees } from './Trees.tsx'
import { TileStream } from './stream/TileStream.ts'
import { setStream } from './stream/useStream.ts'
import { type CityBase, useCityBase } from './useCity.ts'
import { DEMO } from '../params.ts'

// The city: once what's city-wide is in (useCity.ts), its tiles stream in
// by distance (stream/TileStream.ts), updated every frame from the camera,
// over the ground around them (Ground.tsx), with the landmark models, and
// the rooftop items and trees of the tiles drawn near.
//
// The stream is the page's one (stream/useStream.ts), so what's outside the canvas
// (App.tsx's loading note, ?net's report) can watch it.

// One per loaded city, for the page's life: StrictMode's double renders
// and effects in development must not make (or dispose) a second, with its
// own workers.
const streams = new WeakMap<CityBase, TileStream>()
function streamFor(base: CityBase): TileStream {
  let s = streams.get(base)
  if (!s) streams.set(base, (s = new TileStream(base)))
  return s
}

export function City() {
  const base = useCityBase()
  const stream = streamFor(base)
  useEffect(() => {
    setStream(stream)
    // ?demo: for scripts that look inside (scratch measurements, not the app).
    if (DEMO) window.__cityStream = stream
  }, [stream])
  useFrame(({ camera, gl, size }) => {
    // The last frame's draw calls and triangles, all passes (?net): counted
    // across every render() of a frame, the composer's and the shadow and
    // reflection passes included.
    gl.info.autoReset = false
    stream.countDrawn(gl.info.render.calls, gl.info.render.triangles)
    gl.info.reset()
    stream.update(camera, (camera as PerspectiveCamera).fov, size.height)
  })
  return (
    <>
      <Ground mask={stream.mask} />
      <primitive object={stream.group} />
      <Landmarks stream={stream} />
      <Rooftops stream={stream} />
      <Trees stream={stream} />
    </>
  )
}

declare global {
  interface Window {
    __cityStream?: TileStream
  }
}
