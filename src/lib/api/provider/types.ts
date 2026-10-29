// ── Data provider contract ────────────────────────────────────────────────
// 应用对上游的唯一抽象：任何上游只需实现 DataProvider 接口，把各自原始数据
// 抓取并转换成语义一致的规范化契约类型（见 $lib/api/types）。其余代码只依赖
// 该接口，不再感知具体上游。接入新上游的工作流程见 docs/upstream-integration.md。

import type {
    Character,
    CharacterInfo,
    Echo,
    EchoInfo,
    EchoSetInfo,
    EchoSetItem,
    Weapon,
    WeaponInfo
} from '$lib/api/types'

/** 列表/详情接口的语言选项；lang 原样交给上游，适配器在不支持时回退中文 */
export interface LangOptions {
    lang?: string
}

export interface InfoOptions extends LangOptions {
    /** 详情是否保留原始富文本（v3 使用） */
    rich?: boolean
}

export interface DataProvider {
    /** 唯一 id，用于持久化选择与日志标识 */
    readonly id: string
    /** 人类可读名称，用于设置界面展示 */
    readonly label: string

    // ── 版本 ──
    getLatestVersion(): Promise<string>
    getAvailableVersions(): Promise<string[]>

    // ── 列表（规范化契约） ──
    getCharacterList(opts?: LangOptions): Promise<Character[]>
    getWeaponList(opts?: LangOptions): Promise<Weapon[]>
    getEchoList(opts?: LangOptions): Promise<Echo[]>
    getEchoSetList(opts?: LangOptions): Promise<EchoSetItem[]>

    // ── 图标（名称 → 可直接渲染的图片 URL） ──
    getCharacterIcons(): Promise<Record<string, string>>
    getWeaponIcons(): Promise<Record<string, string>>
    getEchoIcons(): Promise<Record<string, string>>
    getEchoSetIcons(): Promise<Record<string, string>>

    // ── 角色 tag 图标 ──
    // 角色详情只返回短标识（如 SP_RoleLabelI8），这里扫描角色详情汇总成短标识 → 完整 URL。
    getTagIcons(): Promise<Record<string, string>>

    // ── 详情（规范化契约） ──
    // rich=true 时角色详情保留原始描述文本（statNodes/chains 不去标签），
    // 供 v2 富文本展示使用。
    getCharacterInfo(name: string, opts?: InfoOptions): Promise<CharacterInfo>
    getWeaponInfo(name: string, opts?: LangOptions): Promise<WeaponInfo>
    getEchoInfo(name: string, opts?: LangOptions): Promise<EchoInfo>
    getEchoSetInfo(name: string, opts?: LangOptions): Promise<EchoSetInfo>

    // ── 推荐武器 ──
    getRecommendedWeapons(characterName: string): Promise<string[]>
}
