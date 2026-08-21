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
            '.eslint-report.json'
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
            'src/lib/ai/tools/**/*.ts'
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

    // ── Svelte 文件：仅解析器（flat/base，0 规则）──────────────
    // 理由：用户诉求是「函数式编程风格」，svelte/recommended 的规则
    //（require-each-key / prefer-svelte-reactivity 等，共 228 处）属
    // Svelte 最佳实践而非函数式，开启会淹没函数式信号。如需启用，
    // 将下面的 'flat/base' 换成 'flat/recommended' 即可。
    ...svelte.configs['flat/base'],
    {
        files: ['**/*.svelte'],
        languageOptions: {
            parserOptions: {
                parser: tseslint.parser
            }
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
