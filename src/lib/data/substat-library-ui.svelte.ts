// 词条集面板的开关状态（全局单例挂载：首页卡片、词条页工具栏、AI/WS 面板工具共用一套入口）
// 两种入口对应两套 UI：project = 从工程打开（配队三角色分栏、可套用）；home = 从主页打开（全角色管理，无套用）

export type SubstatLibraryMode = 'project' | 'home'

let _open = $state(false)
let _character = $state<string | null>(null)
let _mode = $state<SubstatLibraryMode>('project')

export function getSubstatLibraryOpen(): boolean {
    return _open
}

/** @desc 打开时希望定位到的角色（词条页传入；首页/工具打开则为 null） */
export function getSubstatLibraryCharacter(): string | null {
    return _character
}

/** @desc 面板形态：project 配队分栏版 / home 全角色管理版 */
export function getSubstatLibraryMode(): SubstatLibraryMode {
    return _mode
}

export function openSubstatLibrary(character?: string | null, mode: SubstatLibraryMode = 'project'): void {
    _character = character ?? null
    _mode = mode
    _open = true
}

export function closeSubstatLibrary(): void {
    _open = false
}

/** @desc 供 AI / WS 面板工具按面板名开关（未指定形态时按工程/主页默认） */
export function setSubstatLibraryOpen(v: boolean): void {
    _open = v
    if (!v) _character = null
}

/** @desc 「从库街区同步」预览弹窗的打开请求（AI/WS 工具发起，词条集弹窗消费后清掉） */
let _kuroPreviewRequested = $state(false)

export function requestKuroSyncPreview(): boolean {
    if (!_open) return false
    _kuroPreviewRequested = true
    return true
}

export function consumeKuroSyncPreviewRequest(): boolean {
    if (!_kuroPreviewRequested) return false
    _kuroPreviewRequested = false
    return true
}
