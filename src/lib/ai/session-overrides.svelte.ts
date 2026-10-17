/**
 * @desc AI 会话级覆盖层：让「提供商配置 / 思考强度 / 危险操作策略」可以在助手弹窗里即时切换，
 * 而**不写回** IndexedDB 里的持久化设置。
 *
 * ## 为什么需要这一层（实测的写入方冲突）
 * `ai-config` 这条 IndexedDB 记录本来就有**两个**写入者：设置页 UI 与 AI 自己的
 * `manage_ai_profile` 工具（`$lib/ai/tools/settings.ts`）。若助手弹窗直接调 `setActiveProfile()`，
 * 就出现第三个写入者，两个具体后果：
 *   1. 用户只是想「这次换个模型」，却会把全局默认**永久改掉**；
 *   2. AI 可以在用户操作期间把 `activeProfileId` 换掉，于是弹窗显示与实际发出的请求不一致。
 * 故弹窗一律只写本层；落盘动作仍归设置页与 AI 工具。
 *
 * ## 界面契约：不暴露「覆盖」这个概念
 * 界面（`ai-composer.svelte`）**刻意不显示**「临时值 / 跟随设置 / 恢复默认」之类的提示，
 * 与 DSH 的权限、模型选择器一致 —— 按钮上显示的就是当前生效值。因此本模块**不提供**
 * 「读取覆盖项」「清除覆盖」「是否处于覆盖态」这类接口：没有消费者，接口就是死代码。
 * 想要设置里的默认值，用户从同一个列表里选回它即可（选中的值与持久化值相同时行为完全一致）。
 *
 * ## 解析顺序
 * 会话覆盖 → 持久化配置 → 内置默认。覆盖项只存在于内存、刷新即恢复
 * （与 `turn-state.svelte.ts` 的分段临时禁用同一约定），刻意不落盘。
 *
 * ⚠️ 覆盖的配置若被设置页 / AI 工具删掉，`resolveAiConfig()` 会静默回落到持久化的当前配置，
 * 不抛错（否则弹窗会卡在一个已不存在的配置上）。
 */
import { getAiConfig, getAiProfiles } from './config.svelte'
import { getDangerMode, type DangerMode } from '$lib/data/ai-prefs.svelte'
import { coerceThinkingLevel, type ThinkingLevel } from './thinking'

/** @desc 解析后的**生效**配置（`session.ts` 发请求、助手界面显示，共用这一份） */
export interface ResolvedAiConfig {
    profileId: string
    label: string
    baseUrl: string
    model: string
    apiKey: string
    thinkingLevel: ThinkingLevel
    dangerMode: DangerMode
    /** @desc 上下文窗口（token），用量圈的分母；由配置文件声明，见 `config.svelte.ts` */
    contextWindow: number
    /** @desc 单次请求的最大输出 token（请求体的 `max_tokens`） */
    maxOutputTokens: number
    /** @desc 单回合工具轮次上限 */
    maxToolRounds: number
    /** @desc 浏览器直连（`true` = 绕过站点转发） */
    directRequest: boolean
}

/** @desc 覆盖项初值一律为 `null`（= 跟随持久化设置）；界面不提供清除入口，故无 setter 接受 `null` */
let _profileId = $state<string | null>(null)
let _thinkingLevel = $state<ThinkingLevel | null>(null)
let _dangerMode = $state<DangerMode | null>(null)

/** @desc 切换提供商配置（只切换，增删改仍在设置页 / `manage_ai_profile` 工具） */
export const setSessionProfile = (id: string): void => {
    _profileId = id
}

/** @desc 切换思考强度 */
export const setSessionThinkingLevel = (level: ThinkingLevel): void => {
    _thinkingLevel = level
}

/** @desc 切换危险操作策略 */
export const setSessionDangerMode = (mode: DangerMode): void => {
    _dangerMode = mode
}

/**
 * @desc 生效的危险操作策略。
 * 助手的确认逻辑读它，而**不是**直接读 `getDangerMode()` —— 否则弹窗里的权限切换不会生效。
 */
export const getEffectiveDangerMode = (): DangerMode => _dangerMode ?? getDangerMode()

/**
 * @desc 解析生效配置。
 * @returns 覆盖的配置已不存在时（被设置页 / AI 工具删掉）回落到持久化的当前配置，不抛错。
 */
export const resolveAiConfig = (): ResolvedAiConfig => {
    const fallback = getAiConfig()
    const picked = _profileId === null ? undefined : getAiProfiles().find((p) => p.id === _profileId)
    const profile = picked ?? fallback
    return {
        profileId: profile.id,
        label: profile.label,
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey: profile.apiKey,
        thinkingLevel: _thinkingLevel ?? coerceThinkingLevel(profile.reasoningEffort),
        dangerMode: _dangerMode ?? getDangerMode(),
        contextWindow: profile.contextWindow,
        maxOutputTokens: profile.maxOutputTokens,
        maxToolRounds: profile.maxToolRounds,
        directRequest: profile.directRequest
    }
}
