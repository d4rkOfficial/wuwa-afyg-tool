/**
 * @desc 测试路径映射的**唯一口径**（纯函数工具，聚合入口与工具链共用）。
 *
 * 约定：测试统一放仓库根目录 `test/` 下，并**镜像源码路径** —— `src/lib/a.ts` → `test/src/lib/a.test.ts`。
 *
 * 为什么需要它（实测教训）：聚合入口过去是**手写 import 清单**，于是
 *   ① 新写的测试忘了登记 ⇒ 用例永远不跑（实测漏了 3 个文件、41 条用例，`pnpm test` 一点提示都没有）；
 *   ② 某个文件在 import 期抛错 ⇒ 整批静默消失（`node:test` 汇总里看不到任何 fail，只是总数变少）。
 * 改成「按路径约定自动发现」后，测试只要按镜像规则放对位置就会被跑到；`testPathOf` 同时给
 * 「这个模块的测试该放哪」提供机器可查的答案，避免再靠记忆维护清单。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** @desc 仓库根（本文件位于 `<root>/test/paths.ts`） */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** @desc 测试根目录（仓库相对、POSIX 形式） */
export const TEST_DIR = 'test'

/** @desc 测试文件后缀（只有它能被自动发现执行；`*.online.test.ts` 之类需显式指定） */
export const TEST_SUFFIX = '.test.ts'

const toPosix = (p: string): string => p.split(path.sep).join('/')

/** @desc 源码路径 → 它该放哪的测试路径（机械映射，不保证文件存在） */
export const testPathOf = (sourcePath: string): string => {
    const rel = toPosix(sourcePath).replace(/^\.\//, '')
    return `${TEST_DIR}/${rel.replace(/\.[^./\\]+$/, '')}${TEST_SUFFIX}`
}

/** @desc 测试路径 → 它镜像的源码路径（反解，同样不保证存在） */
export const sourcePathOf = (testPath: string): string => {
    const rel = toPosix(testPath)
    const stripped = rel.startsWith(`${TEST_DIR}/`) ? rel.slice(TEST_DIR.length + 1) : rel
    return stripped.endsWith(TEST_SUFFIX) ? `${stripped.slice(0, -TEST_SUFFIX.length)}.ts` : stripped
}

/** @desc 递归发现全部测试文件（仓库相对 POSIX 路径，字典序；目录名也排序，保证跨平台稳定） */
export const discoverTestFiles = (dir: string = path.join(REPO_ROOT, TEST_DIR)): string[] => {
    const out: string[] = []
    const walk = (d: string): void => {
        const entries = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
        for (const e of entries) {
            const p = path.join(d, e.name)
            if (e.isDirectory()) walk(p)
            else if (e.name.endsWith(TEST_SUFFIX)) out.push(toPosix(path.relative(REPO_ROOT, p)))
        }
    }
    walk(dir)
    return out
}

/** @desc 按子串筛选测试文件（`--only=<子串>`；空筛选＝全部） */
export const selectTestFiles = (files: readonly string[], only: string): string[] => {
    const q = only.trim()
    return q ? files.filter((f) => f.includes(q)) : [...files]
}

/** @desc 从 argv 解析「只跑哪些」：支持 `--only=x` / `--only x` / 位置参数（`pnpm test:one calc`） */
export const onlyFromArgv = (argv: readonly string[] = process.argv.slice(2)): string => {
    const eq = argv.find((a) => a.startsWith('--only='))
    if (eq) return eq.slice('--only='.length)
    const i = argv.indexOf('--only')
    if (i >= 0) return argv[i + 1] ?? ''
    return argv.find((a) => !a.startsWith('-')) ?? ''
}
