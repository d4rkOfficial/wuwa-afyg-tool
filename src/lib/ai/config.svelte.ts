// AI 助手配置（持久化到 IndexedDB）：多个命名配置文件（Profile），每个含独立的服务地址/模型/API Key/思考强度，一键切换
import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'

export interface AiProfile {
    id: string
    label: string
    baseUrl: string
    model: string
    apiKey: string
    reasoningEffort: 'low' | 'medium' | 'high'
}

export interface AiConfig {
    activeProfileId: string
    profiles: AiProfile[]
}

// 内置默认配置文件（均可删除/修改；首次使用默认激活 DeepSeek 官方 v4-flash）
const DEFAULT_PROFILES: AiProfile[] = [
    {
        id: 'deepseek-official',
        label: 'Deepseek 官方',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: '',
        reasoningEffort: 'medium'
    }
]

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
                reasoningEffort:
                    p.reasoningEffort === 'low' || p.reasoningEffort === 'high' ? p.reasoningEffort : 'medium'
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
        reasoningEffort: patch.reasoningEffort ?? base.reasoningEffort
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
