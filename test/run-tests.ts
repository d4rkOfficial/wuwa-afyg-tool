/**
 * @desc **测试聚合入口**：自动发现 `test/**\/*.test.ts` 并逐个隔离加载。
 *
 * 用法（`pnpm test` 就是下面第一条）：
 *   node --import ./test/preload-runes.mjs --import ./test/preload.mjs test/run-tests.ts
 *   node --import ./test/preload-runes.mjs --import ./test/preload.mjs test/run-tests.ts --only=calc
 *   pnpm test:one calc                      # 等价于上面那条（只跑路径含 "calc" 的测试文件）
 *   pnpm test:list                          # 只列出会被跑到的文件，不执行
 * 单个文件直接跑：
 *   node --import ./test/preload-runes.mjs --import ./test/preload.mjs test/test/src/lib/calc/coeff-crit.test.ts
 *
 * 为什么不用 `node --test`：本环境禁止子进程，`--test` 会按文件 spawn 子进程直接失败；
 * 所以改成「同进程内逐个 import」，`describe` / `it` 在 import 时注册、由 `node:test` 汇总。
 *
 * 为什么不再手写 import 清单（历史教训，两条都踩过）：
 *   ① 新测试忘了登记 ⇒ 用例永远不跑（实测漏了 3 个文件、41 条用例，`pnpm test` 毫无提示）；
 *   ② 某文件在 import 期抛错 ⇒ 整批静默消失（汇总里看不到 fail，只是总数变少）。
 * 现在按路径约定自动发现（见 `paths.ts`），且**每个文件单独 try/catch**：加载失败会显式报错并让退出码变 1。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT, discoverTestFiles, onlyFromArgv, selectTestFiles } from './paths'

const argv = process.argv.slice(2)
const only = onlyFromArgv(argv)
const files = selectTestFiles(discoverTestFiles(), only)

if (argv.includes('--list')) {
    for (const f of files) console.log(f)
    process.exit(0)
}

console.log(`[test] 共 ${files.length} 个测试文件${only ? `（--only=${only}）` : ''}`)

/** @desc 加载失败的文件（import 期抛错 = 该文件的用例一条都不会注册，必须显式失败） */
const failed: { file: string; error: unknown }[] = []
for (const file of files) {
    try {
        await import(pathToFileURL(path.join(REPO_ROOT, file)).href)
    } catch (error) {
        failed.push({ file, error })
        console.error(`[test] ✖ 加载失败：${file}`)
        console.error(error)
    }
}

if (failed.length > 0) {
    console.error(`[test] ${failed.length}/${files.length} 个测试文件加载失败（这些文件的用例一条都没跑）：`)
    for (const f of failed) console.error(`  - ${f.file}`)
    process.exitCode = 1
}
