/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The minified bundle drops dependencies' license comments, so their
    // licenses (three.js and the rest, MIT and similar) ship alongside it
    // instead, at /third-party-licenses.md on the live site.
    license: { fileName: 'third-party-licenses.md' },
  },
  // In CI a failing test is tried twice more, and one that then passes is
  // named (scripts/lib/flakyReporter.ts): a suite failed once on 2026-10-23
  // and 50 runs since didn't repeat it. Locally a failure stays a failure.
  test: process.env.CI ? { retry: 2, reporters: ['default', 'github-actions', './scripts/lib/flakyReporter.ts'] } : {},
})
