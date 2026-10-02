// ── node:test 单进程聚合入口 ────────────────────────────────────────────
// node:test 的 `--test` 会按文件 spawn 子进程（本环境禁止），因此改为单进程
// 直接 import 各测试文件（describe/it 立即在同一进程注册执行）。
// 新增的测试文件在此导入即可一并执行。
// 运行：node --import ./scripts/test/preload.mjs scripts/test/run-provider-tests.ts

import '../../src/lib/api/provider/index.test.ts'
import '../../src/lib/api/provider/nanoka/utils.test.ts'
import '../../src/lib/api/provider/nanoka.provider.test.ts'
import '../../src/lib/calc/standard-substats.test.ts'
import '../../src/lib/calc/condition-contributes.test.ts'
import '../../src/lib/calc/entry-condition-filter.test.ts'
import '../../src/lib/calc/damage-trace-bonus.test.ts'
import '../../src/lib/calc/zone-layer-ref.test.ts'
import '../../src/lib/calc/timeline-styles.test.ts'
import '../../src/lib/calc/quick-lookup.test.ts'
import '../../src/lib/calc/button-contract.test.ts'
import '../../src/lib/calc/each-key-uniqueness.test.ts'
import '../../src/lib/calc/buff-import-owner.test.ts'
import '../../src/lib/data/project-clone.test.ts'
import '../../src/lib/data/project-export-import.test.ts'
import '../../src/lib/theme/bg-mask.test.ts'
import '../../src/lib/theme/default-backgrounds.lazy.test.ts'
import '../../src/lib/theme/tag-ink.test.ts'
import '../../src/lib/ai/proxy-guard.test.ts'
import '../../src/lib/ai/phase-digest.test.ts'
import '../../src/lib/ai/refs.test.ts'
import '../../src/lib/ai/tools/registry.test.ts'
import '../../src/lib/ai/tools/web-fetch.utils.test.ts'
import '../../src/lib/components/page/home/settings/ask-user-card.utils.test.ts'
import '../../src/routes/api/ai/fetch/__tests__/fetch-route.test.ts'
import '../../src/routes/shell-page/__tests__/shell-page.test.ts'
import '../../src/routes/shell-page/__tests__/redirect.test.ts'
import '../../src/routes/shell-page/__tests__/content-type.test.ts'
