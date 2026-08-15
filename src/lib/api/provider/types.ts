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

export interface DataProvider {
    /** 唯一 id，用于持久化选择与日志标识 */
    readonly id: string
    /** 人类可读名称，用于设置界面展示 */
    readonly label: string

    // ── 版本 ──
    getLatestVersion(): Promise<string>
    getAvailableVersions(): Promise<string[]>

    // ── 列表（规范化契约） ──
    getCharacterList(): Promise<Character[]>
    getWeaponList(): Promise<Weapon[]>
    getEchoList(): Promise<Echo[]>
    getEchoSetList(): Promise<EchoSetItem[]>

    // ── 图标（名称 → 可直接渲染的图片 URL） ──
    getCharacterIcons(): Promise<Record<string, string>>
    getWeaponIcons(): Promise<Record<string, string>>
    getEchoIcons(): Promise<Record<string, string>>
    getEchoSetIcons(): Promise<Record<string, string>>

    // ── 详情（规范化契约） ──
    // rich=true 时角色详情保留原始描述文本（statNodes/chains 不去标签），
    // 供 v2 富文本展示使用。
    getCharacterInfo(name: string, opts?: { rich?: boolean }): Promise<CharacterInfo>
    getWeaponInfo(name: string): Promise<WeaponInfo>
    getEchoInfo(name: string): Promise<EchoInfo>
    getEchoSetInfo(name: string): Promise<EchoSetInfo>

    // ── 推荐武器 ──
    getRecommendedWeapons(characterName: string): Promise<string[]>
}
