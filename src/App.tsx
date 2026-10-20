import { Suspense, useCallback, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Stats } from '@react-three/drei'
import { EffectComposer, SSAO, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { Buildings } from './city/Buildings.tsx'
import { Credits } from './Credits.tsx'
import { CALIBRATE, DEMO, QUALITY, REPLAY, REPLAY_HOLD_S, REPLAY_START_S, SHOW_FPS, VIEW } from './params.ts'
import { Ground } from './city/Ground.tsx'
import { Rooftops } from './city/Rooftops.tsx'
import { Streets } from './city/Streets.tsx'
import { Trees } from './city/Trees.tsx'
import { loadCity } from './city/useCity.ts'
import { Atmosphere } from './scene/Atmosphere.tsx'
import { Calibration } from './scene/Calibration.tsx'
import { CameraRig } from './scene/CameraRig.tsx'
import { QUALITY_STEPS, monitorEnabled, startStep, stepDown } from './scene/quality.ts'
import { QualityMonitor } from './scene/QualityMonitor.tsx'
import { presetPose } from './scene/shots.ts'
import { Freshness } from './transit/Freshness.tsx'
import { RecordedBadge } from './transit/RecordedBadge.tsx'
import { Vehicles } from './transit/Vehicles.tsx'
import { useCurrentState } from './transit/useCurrentState.ts'
import { type ReplayStatus, useRecordedState } from './transit/useRecordedState.ts'
import { WebGLGate } from './scene/WebGLGate.tsx'

// The live feed, or ?replay=<name>'s recording. Chosen once per page load, so
// the hooks called never change between renders.
const REPLAY_OPTIONS = { startS: REPLAY_START_S, holdS: REPLAY_HOLD_S }
const replayName = REPLAY
// The camera's first pose: ?view's preset (shots.ts PRESETS), or the opening view.
const START_POSE = presetPose(VIEW)
const useFeed: () => ReturnType<typeof useCurrentState> & { replay: ReplayStatus | null } =
  replayName !== null ? () => useRecordedState(replayName, REPLAY_OPTIONS) : () => ({ ...useCurrentState(), replay: null })

// In demo mode, `h` hides the overlay for shots that should show only the city.
function useOverlayToggle(): boolean {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (!DEMO) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'h' && !e.metaKey && !e.ctrlKey && !e.altKey) setHidden((h) => !h)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return hidden
}

// The GPU's name, for spotting software renderers (quality.ts). null where
// the browser hides it.
function rendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string | null {
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null
}

export default function App() {
  const feed = useFeed()
  const overlayHidden = useOverlayToggle()
  // The render's quality step (quality.ts): full to start, lower while the
  // frame rate stays under the floor.
  const [step, setStep] = useState(() => startStep(QUALITY, null))
  const quality = QUALITY_STEPS[step]
  useEffect(() => {
    document.documentElement.dataset.quality = String(step)
    if (step > 0) console.info(`quality: step ${step}`, quality)
  }, [step, quality])
  const decline = useCallback(() => setStep(stepDown), [])
  // A lost WebGL context (a driver reset, or memory pressure on an
  // integrated GPU) leaves a dead canvas: say so instead of claiming "live".
  const [contextLost, setContextLost] = useState(false)
  // Until the city arrives the canvas shows only sky: say it's coming.
  const [cityReady, setCityReady] = useState(false)
  useEffect(() => {
    loadCity().then(
      () => setCityReady(true),
      () => {}, // the scene's ErrorBoundary handles a failed load
    )
  }, [])
  if (contextLost)
    return (
      <div className="error-boundary" role="alert">
        <p>The browser reset the graphics, which can happen on laptops under heavy load.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  return (
    <WebGLGate>
      {/* The effect composer renders the whole scene again into a 4x
          multisampled half-float buffer, so pixel count is the frame cost:
          cap the pixel ratio at 1.5 (44% fewer pixels than 2 on Retina) and
          skip the canvas's own antialiasing, which the composer replaces. */}
      <Canvas
        dpr={[1, quality.maxDpr]}
        gl={{ antialias: false }}
        // PCF: hardware depth comparisons over a small disk (shadow-radius,
        // Atmosphere.tsx), crisp edges without stair-steps. VSM's blur read
        // as soft blobs on walls and roofs; "soft" (PCFSoft) was removed in
        // this three.js version.
        shadows="percentage"
        camera={{ position: START_POSE.position, fov: 40, near: 10, far: 20000 }}
        onCreated={({ gl }) => {
          const ctx = gl.getContext()
          setStep((s) => Math.max(s, startStep(QUALITY, rendererName(ctx))))
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault()
            setContextLost(true)
          })
        }}
      >
        {/* Each independently-loading resource (city.bin, trees.bin, routes.json)
            gets its own Suspense boundary. Sharing one boundary across
            siblings suspending on different promises that resolve at
            different real times makes React discard and remount the WHOLE
            subtree every time any one of them resolves -- Buildings' city
            geometry was extruding 4 times on a single page load because of
            this, not twice (React StrictMode's expected dev-only double
            render). */}
        <Suspense fallback={null}>
          <Atmosphere shadowMapSize={quality.shadowMapSize} />
        </Suspense>
        <Suspense fallback={null}>
          <Ground />
          <Streets />
          <Buildings />
          <Rooftops />
        </Suspense>
        <Suspense fallback={null}>
          <Trees />
        </Suspense>
        <Suspense fallback={null}>
          {/* A looping recording restarts its clock: start the buses fresh. */}
          <Vehicles key={feed.replay?.loop ?? 0} state={feed.state} />
        </Suspense>
        {CALIBRATE && <Calibration />}
        <CameraRig start={START_POSE} />
        {/* No bloom: the look is realistic, nothing in the scene glows. The
            composer turns off the renderer's tone mapping, so it's applied
            here: Khronos PBR Neutral, which shows base colors as authored
            and only rolls off highlights (lighting.ts). SSAO: soft contact shadows in corners
            and at street level, subtle enough not to compete with the real
            shadows from Atmosphere's sun. */}
        <EffectComposer enableNormalPass={quality.ssao} multisampling={quality.msaa}>
          {quality.ssao ? <SSAO radius={0.12} intensity={12} luminanceInfluence={0.6} distanceFalloff={0.5} /> : <></>}
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        </EffectComposer>
        {monitorEnabled(QUALITY) && step < QUALITY_STEPS.length - 1 && <QualityMonitor key={step} onDecline={decline} />}
        {((import.meta.env.DEV && !DEMO) || SHOW_FPS) && <Stats />}
      </Canvas>
      {!cityReady && (
        <div className="loading" role="status">
          Loading the city…
        </div>
      )}
      {!overlayHidden && <Freshness feed={feed} />}
      {feed.replay && <RecordedBadge replay={feed.replay} />}
      <Credits />
    </WebGLGate>
  )
}
