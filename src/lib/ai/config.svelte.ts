// AI 助手配置（持久化到 IndexedDB）：多个命名配置文件（Profile），每个含独立的服务地址/模型/API Key/思考强度，一键切换
import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import { coerceThinkingLevel, type ThinkingLevel } from './thinking'

export interface AiProfile {
    id: string
    label: string
    baseUrl: string
    model: string
    apiKey: string
    /**
     * @desc 思考强度**持久化默认**（档位定义与协议映射见 `./thinking`）。
     * 助手弹窗可作会话级覆盖，但覆盖不写回这里 —— 见 `./session-overrides.svelte`。
     */
    reasoningEffort: ThinkingLevel
    /**
     * @desc 上下文窗口（token 数），助手弹窗**用量圈的分母**。
     *
     * 为什么必须由用户声明：本应用的服务地址与模型名都是自由文本，没有 `pi-ai` 那样的模型目录
     * 可查 `contextWindow`，服务商也不会在响应里下发窗口大小。故只能按配置文件填，
     * 缺失/非法由 `coerceContextWindow()` 回落默认值（不臆造、也不让分母为 0）。
     */
    contextWindow: number
}

/** @desc 上下文窗口默认值（token）：128k，覆盖当前主流模型的常见窗口 */
export const DEFAULT_CONTEXT_WINDOW = 128_000

/** @desc 上下文窗口的合法区间：下限 1k 防止分母为 0 / 弧长失真，上限 10M 防止误填溢出 */
const MIN_CONTEXT_WINDOW = 1_000
const MAX_CONTEXT_WINDOW = 10_000_000

/**
 * @desc 归一化「上下文窗口」：只接受区间内的有限数值并取整，其余（缺失 / 非数 / 越界）一律回落默认。
 * 与 `coerceThinkingLevel` 同一口径：老数据缺字段时静默补默认，而不是报错或留 `undefined`。
 */
export const coerceContextWindow = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CONTEXT_WINDOW
    const rounded = Math.round(value)
    if (rounded < MIN_CONTEXT_WINDOW || rounded > MAX_CONTEXT_WINDOW) return DEFAULT_CONTEXT_WINDOW
    return rounded
}

export interface AiConfig {
    activeProfileId: string
    profiles: AiProfile[]
}

// 内置默认配置文件（均可删除/修改）。**刻意不预填任何服务商**：服务地址与模型名全部留白，
// 由用户自己填；预填某一家会把「换个模型」变成「改掉别人的默认」。
const DEFAULT_PROFILES: AiProfile[] = [
    {
        id: 'default',
        label: '默认配置',
        baseUrl: '',
        model: '',
        apiKey: '',
        reasoningEffort: 'medium',
        contextWindow: DEFAULT_CONTEXT_WINDOW
    }
]

/**
 * @desc 一份**空白**的新配置草稿（`id` 为空 = 尚未创建）。
 *
 * 三个刻意的选择：
 * 1. **不预先落库** —— 它只是弹窗的初始值；用户点保存时才 `addProfile`，取消则什么都不发生
 *    （原先「新建」会先落库再开弹窗，取消也会留下一条空配置）。
 * 2. **不拿当前生效配置预填** —— 否则用户会以为已经建好，且容易存出一份和现有配置重复的东西。
 * 3. 名称给一个随便取的占位（配置总得有个名字），其余输入框留白。
 */
export const createBlankAiProfile = (): AiProfile => ({
    id: '',
    label: '新配置',
    baseUrl: '',
    model: '',
    apiKey: '',
    reasoningEffort: 'medium',
    contextWindow: DEFAULT_CONTEXT_WINDOW
})

const AI_CONFIG_KEY = 'ai-config'

// ── API Key 加密（AES-GCM，密钥由内置常量经 PBKDF2 派生；避免明文落盘，仅本地应用级防护）──
const ENC_PREFIX = 'enc:'
const SECRET_SOURCE = 'wuwa-afyg-tool-ai-key-v1'
const PBKDF2_SALT = 'wuwa-afyg-ai-salt'

let _encKeyPromise: Promise<CryptoKey> | null = null

function getEncKey(): Promise<CryptoKey> {
    if (!_encKeyPromise) {
        _encKeyPromise = (async () => {
            const base = await crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode(SECRET_SOURCE),
                'PBKDF2',
                false,
                ['deriveKey']
            )
            return crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt: new TextEncoder().encode(PBKDF2_SALT), iterations: 100_000, hash: 'SHA-256' },
                base,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            )
        })()
    }
    return _encKeyPromise
}

function b64Encode(bytes: Uint8Array): string {
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return btoa(bin)
}

function b64Decode(b64: string): Uint8Array {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
}

async function encryptApiKey(plain: string): Promise<string> {
    if (!plain) return ''
    try {
        const key = await getEncKey()
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain))
        const combined = new Uint8Array(iv.length + cipher.byteLength)
        combined.set(iv)
        combined.set(new Uint8Array(cipher), iv.length)
        return ENC_PREFIX + b64Encode(combined)
    } catch {
        // 非安全上下文等场景降级为明文保存
        return plain
    }
}

async function decryptApiKey(stored: string): Promise<string> {
    if (!stored) return ''
    if (!stored.startsWith(ENC_PREFIX)) return stored
    try {
        const key = await getEncKey()
        const combined = b64Decode(stored.slice(ENC_PREFIX.length))
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: combined.slice(0, 12) },
            key,
            combined.slice(12)
        )
        return new TextDecoder().decode(plain)
    } catch {
        return ''
    }
}

const DEFAULT_CONFIG: AiConfig = {
    activeProfileId: DEFAULT_PROFILES[0].id,
    profiles: DEFAULT_PROFILES
}

let _config: AiConfig = $state({
    activeProfileId: DEFAULT_CONFIG.activeProfileId,
    profiles: DEFAULT_PROFILES.map((p) => ({ ...p }))
})
let _loaded = false

// 持久化：内存保持明文，落盘前逐个加密 apiKey
async function persist(): Promise<void> {
    if (!browser) return
    const profiles: AiProfile[] = []
    for (const p of _config.profiles) {
        profiles.push({ ...p, apiKey: await encryptApiKey(p.apiKey) })
    }
    await dbSet(AI_CONFIG_KEY, { activeProfileId: _config.activeProfileId, profiles })
}

function findProfile(id: string): AiProfile | undefined {
    return _config.profiles.find((p) => p.id === id)
}

function activeProfile(): AiProfile {
    return findProfile(_config.activeProfileId) ?? _config.profiles[0]
}

export function getAiConfig(): AiProfile {
    return activeProfile()
}

export function getAiProfiles(): AiProfile[] {
    return _config.profiles
}

export function getActiveProfileId(): string {
    return _config.activeProfileId
}

export async function loadAiConfig(): Promise<void> {
    if (!browser || _loaded) return
    const stored = await dbGet<AiConfig>(AI_CONFIG_KEY)
    if (stored?.data && Array.isArray(stored.data.profiles) && stored.data.profiles.length > 0) {
        const profiles: AiProfile[] = []
        for (const p of stored.data.profiles) {
            if (!p || typeof p.baseUrl !== 'string' || typeof p.model !== 'string') continue
            profiles.push({
                id: p.id || crypto.randomUUID(),
                label: p.label || p.model,
                baseUrl: p.baseUrl,
                model: p.model,
                apiKey: await decryptApiKey(p.apiKey ?? ''),
                // 归一化交给 `thinking.ts`：非法/缺失回落 medium，与新增 `off` 档前的读盘容错一致
                reasoningEffort: coerceThinkingLevel(p.reasoningEffort),
                contextWindow: coerceContextWindow(p.contextWindow)
            })
        }
        if (profiles.length > 0) {
            const activeId = profiles.some((p) => p.id === stored.data.activeProfileId)
                ? stored.data.activeProfileId
                : profiles[0].id
            _config = { activeProfileId: activeId, profiles }
        }
    }
    _loaded = true
}

export async function setActiveProfile(id: string): Promise<boolean> {
    if (!findProfile(id)) return false
    _config.activeProfileId = id
    await persist()
    return true
}

export async function addProfile(label: string, patch: Partial<AiProfile> = {}): Promise<AiProfile> {
    const base = activeProfile()
    const profile: AiProfile = {
        id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: label.trim() || '自定义',
        baseUrl: patch.baseUrl ?? base.baseUrl,
        model: patch.model ?? base.model,
        apiKey: patch.apiKey ?? '',
        reasoningEffort: patch.reasoningEffort ?? base.reasoningEffort,
        contextWindow: patch.contextWindow ?? base.contextWindow
    }
    _config = { ..._config, profiles: [..._config.profiles, profile] }
    _config.activeProfileId = profile.id
    await persist()
    return profile
}

export async function deleteProfile(id: string): Promise<boolean> {
    // 删除最后一个配置文件时自动恢复默认
    if (_config.profiles.length <= 1) {
        await resetAiConfig()
        return true
    }
    const idx = _config.profiles.findIndex((p) => p.id === id)
    if (idx === -1) return false
    const profiles = _config.profiles.filter((p) => p.id !== id)
    _config = {
        activeProfileId: _config.activeProfileId === id ? profiles[Math.max(0, idx - 1)].id : _config.activeProfileId,
        profiles
    }
    await persist()
    return true
}

export async function updateProfile(id: string, patch: Partial<AiProfile>): Promise<boolean> {
    const profile = findProfile(id)
    if (!profile) return false
    Object.assign(profile, patch)
    await persist()
    return true
}

export async function resetAiConfig(): Promise<void> {
    _config = {
        activeProfileId: DEFAULT_PROFILES[0].id,
        profiles: DEFAULT_PROFILES.map((p) => ({ ...p }))
    }
    await persist()
}
