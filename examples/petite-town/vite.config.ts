import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
const fingerprint = createHash('sha256')
for (const file of [
  'src/build-model.ts',
  'src/model-settings.ts',
  'package-lock.json',
])
  fingerprint.update(readFileSync(new URL(file, import.meta.url)))
export default defineConfig({
  base: './',
  define: {
    __BUILDER_HASH__: JSON.stringify(fingerprint.digest('hex').slice(0, 20)),
  },
  build: { assetsInlineLimit: 0 },
})
