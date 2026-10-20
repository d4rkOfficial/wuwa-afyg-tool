import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const commit = (process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }))
    .trim()
    .slice(0, 7)
const manifest = {
    version: pkg.version,
    commit,
    builtAt: new Date().toISOString(),
    archive: 'toolbox.tar.gz'
}
const output = resolve(root, 'build', 'manifest.json')

writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`[manifest] ${output} (${commit})`)
