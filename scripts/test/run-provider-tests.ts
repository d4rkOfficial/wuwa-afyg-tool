// ── provider 测试聚合入口 ─────────────────────────────────────────────────
// node:test 的 `--test` 会按文件 spawn 子进程（本环境禁止），因此改为单进程
// 直接 import 各测试文件（describe/it 立即在同一进程注册执行）。
// 新增 provider 的测试文件在此导入即可一并执行。
// 运行：node --import ./scripts/test/preload.mjs scripts/test/run-provider-tests.ts

import '../../src/lib/api/provider/index.test.ts'
import '../../src/lib/api/provider/nanoka/utils.test.ts'
import '../../src/lib/api/provider/nanoka.provider.test.ts'
