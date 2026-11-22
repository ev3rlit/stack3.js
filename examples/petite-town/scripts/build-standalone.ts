import { mkdir, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { normalizePath, build } from 'vite'
import sharp from 'sharp'
import { exhibits } from '../src/assemblies'

const atlasDirectory = normalizePath(fileURLToPath(new URL('../atlases/', import.meta.url)))
const placed = new Set(exhibits.flatMap(item => item.parts.map(part => part.id)))

// Let Vite handle module resolution, the inline worker and atlas data URLs.
// Fail if a future dependency would require a second file at runtime.
const built = await build({
  base: './',
  plugins: [{
    name: 'petite-town-offline-atlases',
    enforce: 'pre',
    async load(id) {
      const [path, query] = id.split('?')
      if (!path.startsWith(atlasDirectory) || !path.endsWith('.png') || query !== 'url') return null
      const name = path.slice(atlasDirectory.length, -4)
      if (!placed.has(name)) return 'export default null'
      const png = await sharp(path).png({ adaptiveFiltering: true, compressionLevel: 9 }).toBuffer()
      return 'export default ' + JSON.stringify('data:image/png;base64,' + png.toString('base64'))
    },
  }],
  build: {
    write: false,
    assetsInlineLimit: () => true,
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
const [bundle] = Array.isArray(built) ? built : [built]
if (!('output' in bundle)) throw new Error('Expected a production bundle')
const { output } = bundle
const page = output.find((entry) => entry.fileName === 'index.html')
if (page?.type !== 'asset') throw new Error('Missing index.html')
let html = String(page.source)
for (const entry of output) {
  if (entry === page) continue
  const url = './' + entry.fileName
  if (!html.includes('"' + url + '"')) throw new Error('Unembedded file: ' + url)
  if (entry.type === 'chunk' && entry.isEntry && !entry.imports.length && !entry.dynamicImports.length) {
    html = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (tag, src) =>
      src === url ? '<script type="module">' + entry.code.replace(/<\/script/gi, '<\\/script') + '</script>' : tag)
  } else if (entry.type === 'asset' && entry.fileName.endsWith('.css')) {
    html = html.replace(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g, (tag, href) =>
      href === url ? '<style>' + entry.source + '</style>' : tag)
  } else {
    throw new Error('Unexpected standalone output: ' + entry.fileName)
  }
}
const directory = new URL('../standalone/', import.meta.url)
await mkdir(directory, { recursive: true })
const temp = new URL('index.' + process.pid + '.tmp', directory)
await writeFile(temp, html)
await rename(temp, new URL('index.html', directory))
console.log('Created standalone/index.html (' + (Buffer.byteLength(html) / 1048576).toFixed(1) + ' MiB)')
