// Whether this browser/device can give r3f's <Canvas> a WebGL context. Takes
// the context getter so tests can inject a fake one; real callers pass a
// throwaway canvas's own getContext.
//
// failIfMajorPerformanceCaveat: a context the browser would only give us in
// software (no usable GPU) counts as none. This scene renders there at 1-2
// fps, which is worse than the fallback message.
const OPTIONS = { failIfMajorPerformanceCaveat: true }

export function hasWebGL(getContext: (type: string, options?: object) => unknown): boolean {
  try {
    return Boolean(getContext('webgl2', OPTIONS) ?? getContext('webgl', OPTIONS))
  } catch {
    return false
  }
}

export function detectWebGL(): boolean {
  const canvas = document.createElement('canvas')
  return hasWebGL(canvas.getContext.bind(canvas))
}
