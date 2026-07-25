import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Resvg } from '@resvg/resvg-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const svg = readFileSync(join(root, 'src/lib/assets/favicon.svg'), 'utf-8')

const sizes = [
    { path: 'static/pwa-192x192.png', size: 192 },
    { path: 'static/pwa-512x512.png', size: 512 },
    { path: 'static/apple-touch-icon.png', size: 180 }
]

for (const { path, size } of sizes) {
    const opts = {
        fitTo: { mode: 'width', value: size },
        background: '#ffffff00'
    }
    const resvg = new Resvg(svg, opts)
    const png = resvg.render().asPng()
    const outPath = join(root, path)
    writeFileSync(outPath, png)
    console.log(`Generated ${path} (${size}x${size}, ${png.length} bytes)`)
}
