// AI 弹窗控制器：页面/组件注册本地弹窗状态的读写，AI 可读取与开关（低耦合：页面只调 registerPanel）
import { getShowBuffModal, setShowBuffModal } from '$lib/calc/calculation.store.svelte'
import { getShowDamageList, setShowDamageList } from '$lib/calc/timeline.store.svelte'

export interface PanelRegistration {
    label: string
    get: () => boolean
    set: (v: boolean) => void
}

const registrations = new Map<string, PanelRegistration>()

export function registerPanel(name: string, label: string, get: () => boolean, set: (v: boolean) => void): void {
    registrations.set(name, { label, get, set })
}

export function unregisterPanel(name: string): void {
    registrations.delete(name)
}

// 实时读取所有面板开闭状态
export function getPanelsState(): Record<string, boolean> {
    const out: Record<string, boolean> = {}
    for (const [name, r] of registrations) out[name] = r.get()
    return out
}

// 当前打开的面板摘要（供 AI 上下文）
export function getOpenPanelsSummary(): string {
    const open = [...registrations.entries()].filter(([, r]) => r.get()).map(([, r]) => r.label)
    return open.length > 0 ? open.join('、') : ''
}

// 打开/关闭面板；成功返回 true
export function openPanel(name: string, open: boolean): boolean {
    const r = registrations.get(name)
    if (!r) return false
    r.set(open)
    return true
}

// 由 store 直接管理的面板（无需页面注册）
registerPanel('buff-config', 'BUFF配置', getShowBuffModal, setShowBuffModal)
registerPanel('damage-list', '伤害列表', getShowDamageList, setShowDamageList)
