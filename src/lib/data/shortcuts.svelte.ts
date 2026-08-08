import { browser } from '$app/environment'
import { dbGet, dbSet } from './db'
import { normalizeKeyEvent, physicalLabel } from './keymap.svelte'

export type ShortcutGroup = 'timeline' | 'timeline-quick' | 'calc-spread' | 'calc-dropdown'

export interface ShortcutDef {
    id: string
    group: ShortcutGroup
    label: string
    desc: string
    defaultKey: string
    /** 锁定的修饰键：配置时这些修饰键不可改，仅主键可换（如 Shift+Enter 锁定 Shift） */
    lockedMods?: string[]
}

export const SHORTCUT_GROUPS: { key: ShortcutGroup; label: string }[] = [
    { key: 'timeline', label: '排轴·通用' },
    { key: 'timeline-quick', label: '排轴·快速排轴' },
    { key: 'calc-spread', label: '拉表·平铺' },
    { key: 'calc-dropdown', label: '拉表·下拉' }
]

const KEY = 'shortcuts'

/** 快速排轴输入键项（id 与 keymap entry 对应，仅用于取 blockKey/标签，输入匹配只看配置键） */
export const INPUT_SHORTCUT_IDS = ['attack', 'heavypress', 'dodge', 'q', 'e', 'r', 'f', 't', 'space'] as const

/** 旧分组 id → 排轴·快速排轴 id 迁移 */
const LEGACY_ID_MAP: Record<string, string> = {
    'timeline.quick-config': 'timeline-quick.config',
    'timeline.ref-line': 'timeline-quick.ref-line',
    'timeline.cycle-next': 'timeline-quick.cycle-next',
    'timeline.cycle-prev': 'timeline-quick.cycle-prev',
    'timeline.edit-desc': 'timeline-quick.edit-desc',
    'timeline.quick-undo': 'timeline-quick.quick-undo',
    'timeline.char-1': 'timeline-quick.char-1',
    'timeline.char-2': 'timeline-quick.char-2',
    'timeline.char-3': 'timeline-quick.char-3'
}

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
    // ── 排轴·通用 ──
    {
        id: 'timeline.quick-mode',
        group: 'timeline',
        label: '切换快速排轴',
        desc: '开关快速排轴模式',
        defaultKey: 'shift'
    },
    {
        id: 'timeline.scroll-left',
        group: 'timeline',
        label: '向左滚动',
        desc: '排轴时间线向左滚动一屏',
        defaultKey: 'pageup'
    },
    {
        id: 'timeline.scroll-right',
        group: 'timeline',
        label: '向右滚动',
        desc: '排轴时间线向右滚动一屏',
        defaultKey: 'pagedown'
    },
    // ── 排轴·快速排轴 ──
    {
        id: 'timeline-quick.config',
        group: 'timeline-quick',
        label: '快速配置',
        desc: '按住 500ms 打开非直伤配置，松开打开倍率绑定（同一键承担长短按）',
        defaultKey: 'enter'
    },
    {
        id: 'timeline-quick.ref-line',
        group: 'timeline-quick',
        label: '添加参考线',
        desc: '在排轴末尾快速添加参考线',
        defaultKey: '\\'
    },
    {
        id: 'timeline-quick.cycle-next',
        group: 'timeline-quick',
        label: '循环模式·正向',
        desc: '特殊模式（变奏/切回/无）切到下一档',
        defaultKey: '['
    },
    {
        id: 'timeline-quick.cycle-prev',
        group: 'timeline-quick',
        label: '循环模式·反向',
        desc: '特殊模式切到上一档',
        defaultKey: ']'
    },
    {
        id: 'timeline-quick.edit-desc',
        group: 'timeline-quick',
        label: '编辑最近块备注',
        desc: '为最近输入的操作块编辑备注',
        defaultKey: '/'
    },
    {
        id: 'timeline-quick.quick-undo',
        group: 'timeline-quick',
        label: '撤销最近输入',
        desc: '快速排轴下撤销最近一次输入',
        defaultKey: 'backspace'
    },
    {
        id: 'timeline-quick.char-1',
        group: 'timeline-quick',
        label: '快速排轴角色 1',
        desc: '切换到第 1 个角色的轨道',
        defaultKey: '1'
    },
    {
        id: 'timeline-quick.char-2',
        group: 'timeline-quick',
        label: '快速排轴角色 2',
        desc: '切换到第 2 个角色的轨道',
        defaultKey: '2'
    },
    {
        id: 'timeline-quick.char-3',
        group: 'timeline-quick',
        label: '快速排轴角色 3',
        desc: '切换到第 3 个角色的轨道',
        defaultKey: '3'
    },
    {
        id: 'attack',
        group: 'timeline-quick',
        label: '输入·普攻',
        desc: '快速输入普攻操作块',
        defaultKey: 'a'
    },
    {
        id: 'heavypress',
        group: 'timeline-quick',
        label: '输入·重击',
        desc: '快速输入重击操作块',
        defaultKey: 'z'
    },
    {
        id: 'dodge',
        group: 'timeline-quick',
        label: '输入·闪避',
        desc: '快速输入闪避操作块',
        defaultKey: 's'
    },
    { id: 'q', group: 'timeline-quick', label: '输入·Q', desc: '快速输入声骸技能操作块', defaultKey: 'q' },
    { id: 'e', group: 'timeline-quick', label: '输入·E', desc: '快速输入共鸣技能操作块', defaultKey: 'e' },
    { id: 'r', group: 'timeline-quick', label: '输入·R', desc: '快速输入共鸣解放操作块', defaultKey: 'r' },
    { id: 'f', group: 'timeline-quick', label: '输入·F', desc: '快速输入谐度破坏操作块', defaultKey: 'f' },
    { id: 't', group: 'timeline-quick', label: '输入·T', desc: '快速输入探索工具操作块', defaultKey: 't' },
    {
        id: 'space',
        group: 'timeline-quick',
        label: '输入·跳跃',
        desc: '快速输入跳跃操作块',
        defaultKey: ' '
    },
    // ── 拉表·平铺 ──
    {
        id: 'calc-spread.axis-switch',
        group: 'calc-spread',
        label: '切换默认滚动方向',
        desc: '平铺表主轴在纵向/横向之间切换',
        defaultKey: 'shift'
    },
    // ── 拉表·下拉 ──
    {
        id: 'calc-dropdown.expand-next',
        group: 'calc-dropdown',
        label: '展开下一条',
        desc: '展开下一条伤害的增益选择',
        defaultKey: ' '
    },
    {
        id: 'calc-dropdown.copy-dt-next',
        group: 'calc-dropdown',
        label: '复制伤害类型到下一段',
        desc: '把当前伤害类型复制到下一段效应',
        defaultKey: 'shift+enter',
        lockedMods: ['shift']
    },
    {
        id: 'calc-dropdown.copy-from-prev',
        group: 'calc-dropdown',
        label: '从上一段复制增益',
        desc: '从上一段直伤复制增益',
        defaultKey: 'shift+z',
        lockedMods: ['shift']
    },
    {
        id: 'calc-dropdown.copy-to-next',
        group: 'calc-dropdown',
        label: '复制增益到下一段',
        desc: '把当前增益复制到下一段直伤',
        defaultKey: 'shift+x',
        lockedMods: ['shift']
    },
    {
        id: 'calc-dropdown.clear-all',
        group: 'calc-dropdown',
        label: '清空条目增益',
        desc: '清空当前条目的全部增益',
        defaultKey: 'shift+c',
        lockedMods: ['shift']
    }
]

const DEFAULT_MAP: Record<string, ShortcutDef> = Object.fromEntries(DEFAULT_SHORTCUTS.map((s) => [s.id, s]))

let shortcuts = $state<Record<string, string>>({})

export async function loadShortcuts() {
    if (!browser) return
    const saved = await dbGet<Record<string, string>>(KEY)
    const next: Record<string, string> = {}
    if (saved?.data) {
        for (const def of DEFAULT_SHORTCUTS) {
            // 旧分组 id → 新 id 迁移
            const legacyId = Object.keys(LEGACY_ID_MAP).find((k) => LEGACY_ID_MAP[k] === def.id)
            const v = saved.data[def.id] ?? (legacyId ? saved.data[legacyId] : undefined)
            next[def.id] = typeof v === 'string' && v.length > 0 ? v : def.defaultKey
        }
    } else {
        for (const def of DEFAULT_SHORTCUTS) next[def.id] = def.defaultKey
    }
    shortcuts = next
}

/** 输入键匹配：只比较 shortcuts 配置（与 keymap 存储的 physical 无关），命中返回输入键项 id */
export function getInputShortcutId(rawKey: string): string | null {
    for (const id of INPUT_SHORTCUT_IDS) {
        if (getShortcutKey(id) === rawKey) return id
    }
    return null
}

export function getShortcuts(): ShortcutDef[] {
    return DEFAULT_SHORTCUTS
}

export function getShortcutKey(id: string): string {
    return shortcuts[id] ?? DEFAULT_MAP[id]?.defaultKey ?? ''
}

export function getShortcutDef(id: string): ShortcutDef | undefined {
    return DEFAULT_MAP[id]
}

/** 同分组内是否被其他项占用（跨组允许同键） */
export function findShortcutConflict(id: string, key: string): ShortcutDef | null {
    const def = DEFAULT_MAP[id]
    if (!def) return null
    return DEFAULT_SHORTCUTS.find((s) => s.id !== id && s.group === def.group && getShortcutKey(s.id) === key) ?? null
}

/** 应用锁定修饰键：保证最终键包含 lockedMods 指定的修饰（去重，其他修饰保留） */
export function applyLockedMods(def: ShortcutDef | undefined, key: string): string {
    if (!def?.lockedMods?.length) return key
    const parts = key.split('+')
    const mods = new Set(parts.slice(0, -1))
    for (const m of def.lockedMods) mods.add(m)
    return `${[...mods].join('+')}+${parts[parts.length - 1]}`
}

export async function updateShortcut(id: string, key: string): Promise<ShortcutDef | null> {
    const def = DEFAULT_MAP[id]
    const final = applyLockedMods(def, key)
    const conflict = findShortcutConflict(id, final)
    if (conflict) return conflict
    shortcuts = { ...shortcuts, [id]: final }
    await dbSet(KEY, shortcuts)
    return null
}

export async function resetShortcuts() {
    shortcuts = Object.fromEntries(DEFAULT_SHORTCUTS.map((s) => [s.id, s.defaultKey]))
    await dbSet(KEY, shortcuts)
}

/**
 * 快捷键事件归一化：修饰键前缀（ctrl/meta/shift/alt）+ 主键。
 * 裸修饰键（如仅按 Shift）返回 'shift'（左右不区分）；含中文输入法全角符号转换。
 */
export function normalizeShortcutEvent(e: KeyboardEvent): string {
    const k = e.key
    if (k === 'Shift') return 'shift'
    if (k === 'Control') return 'ctrl'
    if (k === 'Alt') return 'alt'
    if (k === 'Meta') return 'meta'
    const mods: string[] = []
    if (e.ctrlKey) mods.push('ctrl')
    if (e.metaKey) mods.push('meta')
    if (e.shiftKey) mods.push('shift')
    if (e.altKey) mods.push('alt')
    // 全角符号归一化（中文输入法下 ；。，／、＼【】 与半角同键）
    const norm =
        k === '；'
            ? ';'
            : k === '。'
              ? '.'
              : k === '，'
                ? ','
                : k === '／'
                  ? '/'
                  : k === '、' || k === '＼'
                    ? '\\'
                    : k === '【'
                      ? '['
                      : k === '】'
                        ? ']'
                        : k
    const main = normalizeKeyEvent({ ...e, key: norm } as KeyboardEvent)
    return mods.length > 0 ? `${mods.join('+')}+${main}` : main
}

const MOD_LABELS: Record<string, string> = {
    ctrl: 'Ctrl',
    meta: 'Cmd',
    shift: 'Shift',
    alt: 'Alt'
}

/** 快捷键显示文本（修饰键 + 主键，如 Shift + Enter） */
export function shortcutLabel(key: string): string {
    if (!key) return '—'
    const parts = key.split('+')
    const mods = parts.slice(0, -1)
    const main = parts[parts.length - 1]
    const label = physicalLabel(main)
    return [...mods.map((m) => MOD_LABELS[m] ?? m.toUpperCase()), label].join(' + ')
}
