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
})
