import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'

// 下划线前缀 = 有意未使用（stub 参数 / 占位解构），与项目既有约定一致
const UNUSED_IGNORE = {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_',
    ignoreRestSiblings: true
}

/** @type {import('eslint').Linter.Config[]} */
export default tseslint.config(
    // ── 全局忽略 ────────────────────────────────────────────────
    {
        ignores: [
            'node_modules/**',
            '.svelte-kit/**',
            'build/**',
            '.vercel/**',
            '.cloudflare/**',
            'static/**',
            '**/*.min.js',
            'research/**',
            '.eslint-report.json',
            // 临时草稿（与 .gitignore 的 .tmp* 一致，如 .tmp-compute.ts 之类的导出 dump）
            '**/.tmp*'
        ]
    },

    // ── 基础：纯 JavaScript / 配置文件 ──────────────────────────
    {
        files: ['**/*.{js,mjs,cjs}'],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node }
        },
        rules: {
            'no-unused-vars': ['error', UNUSED_IGNORE]
        }
    },

    // ── TypeScript：全部 TS（含 .svelte.ts）基础 recommended ───
    ...tseslint.configs.recommended.map((config) => ({
        ...config,
        files: ['**/*.{ts,tsx}']
    })),

    // no-unused-vars 下划线忽略：消除 stub 参数噪音
    {
        files: ['**/*.{ts,tsx}'],
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', UNUSED_IGNORE],
            // no-var-requires 在 typescript-eslint v8 已被 no-require-imports 取代
            '@typescript-eslint/no-require-imports': 'error'
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // 函数式偏好（仅作用于「纯逻辑层」）
    // ═══════════════════════════════════════════════════════════════
    // 范围：src/lib 下不含 Runes store 的纯逻辑 TypeScript
    //   - calc/   计算引擎  - api/   API 层  - utils/  工具函数
    //   - consts/ 常量      - types/ 类型   - ai/generate 生成逻辑
    //   - ai/tools AI 工具
    // 另加**按文件名约定**的纯逻辑文件（AGENTS §2 的就近放置产物）：
    //   - src/routes/**/*.{utils,consts,types}.ts       路由级工具/常量/类型
    //   - src/lib/components/**/*.{utils,consts,types}.ts 组件级工具/常量/类型
    //   （整改前组件里没有这类文件，Phase 9 起表格/弹窗重构开始产出，实测 3 个，
    //     均为纯函数、不 import store，符合本层约束 —— 见 .tmp/component-consistency-plan.md）
    // 排除：
    //   - **/*.svelte.ts    Runes 响应式 store（必须保留可变性）
    //   - **/*.test.ts      测试（含 fixture 可变性）
    //   - **/__fixtures__/** 测试夹具
    {
        name: 'functional-preference / pure-logic layer',
        files: [
            'src/lib/calc/**/*.ts',
            'src/lib/api/**/*.ts',
            'src/lib/utils/**/*.ts',
            'src/lib/consts/**/*.ts',
            'src/lib/types/**/*.ts',
            'src/lib/ai/generate/**/*.ts',
            'src/lib/ai/tools/**/*.ts',
            'src/routes/**/*.{utils,consts,types}.ts',
            'src/lib/components/**/*.{utils,consts,types}.ts'
        ],
        ignores: ['**/*.svelte.ts', '**/*.test.ts', '**/__fixtures__/**'],
        rules: {
            // ── 语法层函数式偏好（可 --fix 安全自动修复）────────────
            'prefer-const': 'error', // 拒绝不必要的 let（const-first）
            'prefer-arrow-callback': 'error', // 优先箭头函数回调（AGENTS.md 已要求）
            'prefer-template': 'error', // 优先模板字符串
            'object-shorthand': 'error', // 属性简写
            'arrow-body-style': ['error', 'as-needed'], // 单表达式优先简洁体
            'no-var': 'error',

            // ── 函数式偏好：检测（不可自动修复，提示人工处理）────
            // 禁止在纯逻辑层修改入参（纯函数核心约束）
            'no-param-reassign': ['error', { props: false }]
        }
    },

    // ── Svelte 文件：解析器 + 少量最佳实践（flat/base + 1 条 error）──
    // 理由：用户诉求是「函数式编程风格」，svelte/recommended 的规则
    //（prefer-svelte-reactivity 等）属 Svelte 最佳实践而非函数式，全量开启会淹没函数式信号。
    // 故采用渐进棘轮：只逐条引入能量化收敛的规则（当前仅 svelte/require-each-key: error，
    // 基线 0 处无 key，已清零并升 error）。如需全量启用，将下面的 'flat/base' 换成 'flat/recommended'。
    // 组件一致性规则见 scripts/check-components.mjs 与 .tmp/component-consistency-plan.md。
    ...svelte.configs['flat/base'],
    {
        files: ['**/*.svelte'],
        languageOptions: {
            parserOptions: {
                parser: tseslint.parser
            }
        },
        rules: {
            // ── Svelte 最佳实践：渐进式棘轮（第一步已完成）────────────
            // `{#each}` 必须带 key。Phase 0 实测 141 处 → 6.4 清到 50 → T9 清零，
            // 规则随之由 'warn' 升为 'error'（基线 0 处，无白名单）。
            // 详见 .tmp/component-consistency-plan.md Phase 0.3 / 6.4
            'svelte/require-each-key': 'error'
        }
    },

    // flat/base 的第 3 项会强把 *.svelte.ts 塞给 svelte-eslint-parser，
    // 但该解析器只认 Svelte 标记、不认 TypeScript（interface/type）。
    // 此处在其后覆盖，让 *.svelte.ts 回到 typescript-eslint 解析器。
    {
        files: ['**/*.svelte.ts', '**/*.svelte.js'],
        languageOptions: {
            parser: tseslint.parser
        }
    }
)
