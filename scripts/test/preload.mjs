// ── node:test 的别名 + 无扩展名解析钩子 ────────────────────────────────────
// 通过 --import 预载：既把 $lib/$app 别名重写，又把 TS 源码里无扩展名的相对
// 导入（如 './consts'）补成 .ts，使 vitest 风格测试能直接用 Node 内置 test runner
// 跑（本环境 rolldown 子进程被禁，vitest/vite 无法启动）。
// 用法：node --import ./scripts/test/preload.mjs --test 'src/lib/api/provider/**/*.test.ts'

import { registerHooks } from 'node:module'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const libDir = path.join(repoRoot, 'src', 'lib')
const appMockDir = path.join(libDir, '__mocks__', 'app')

const aliasMap = [
    ['$lib/', libDir + path.sep],
    ['$lib', libDir],
    ['$app/environment', path.join(appMockDir, 'environment.ts')]
]

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts']

function stripQuery(spec) {
    return spec.includes('?') ? spec.slice(0, spec.indexOf('?')) : spec
}

function resolveAlias(bare) {
    for (const [prefix, target] of aliasMap) {
        if (bare === prefix || bare.startsWith(prefix)) {
            const rest = bare.slice(prefix.length)
            const abs = path.join(target, rest)
            return { abs, isFile: rest.endsWith('.ts') || rest.includes('.') }
        }
    }
    return null
}

function urlFromAbs(abs) {
    return pathToFileURL(abs).href
}

registerHooks({
    resolve(specifier, context, nextResolve) {
        const bare = stripQuery(specifier)

        // 1) 别名（$lib / $app）
        const alias = bare.startsWith('$') ? resolveAlias(bare) : null
        if (alias) {
            if (existsSync(alias.abs)) return { url: urlFromAbs(alias.abs), shortCircuit: true }
            for (const ext of EXTENSIONS) {
                if (existsSync(alias.abs + ext)) return { url: urlFromAbs(alias.abs + ext), shortCircuit: true }
            }
            return nextResolve(specifier, context)
        }

        // 2) 相对/绝对 无扩展名导入 → 尝试补 .ts 等
        if (bare.startsWith('.') || path.isAbsolute(bare)) {
            const parentDir = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : undefined
            const base = parentDir ? path.resolve(parentDir, bare) : bare
            if (!path.extname(base)) {
                for (const ext of EXTENSIONS) {
                    if (path.extname(base) && existsSync(base)) return { url: urlFromAbs(base), shortCircuit: true }
                    if (existsSync(base + ext)) return { url: urlFromAbs(base + ext), shortCircuit: true }
                }
            }
        }

        return nextResolve(specifier, context)
    }
})
