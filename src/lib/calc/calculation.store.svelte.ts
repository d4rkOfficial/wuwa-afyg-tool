/** @desc 拉表页状态 store：持有伤害条目/Buff 块/条目绑定/生效配置等全局响应式状态，提供 CRUD 与持久化快照接口 */
import type {
    BuffSet,
    BuffZoneValue,
    CalcState,
    DamageEntry,
    DamageEntryConfig,
    BuffCondition
} from './calculation.types'
import type { TimelineData } from './timeline.types'
import type { CharSlot } from '$lib/types/project'
import { parseValueString } from '$lib/utils/parse-value-string'
import { NON_DIRECT_ELEMENT } from './timeline.consts'
import { getSkillCache } from './timeline.store.svelte'
import { getCharElementMap, ensureCharElements } from '$lib/data/char-elements.svelte'
import { addToast } from '$lib/data/toast.svelte'
import { ZONE_MAP, ZONE_NO_REF_IDS, ZONE_REF_MAP } from './calculation.consts'
import type { ZoneId } from './calculation.consts'
import type { ConditionProfile } from './compute'
import { isConditionEmpty, normalizeCondition, normalizeConditionForScope } from './condition'
import { paneEffectSourcesOf, type PaneEffectSource } from './pane-effects'

let _entries = $state<DamageEntry[]>([])
let _buffSets = $state<BuffSet[]>([])
let _damageEntryBuffSetIds = $state<Record<string, string[]>>({})
let _damageEntryDamageTypes = $state<Record<string, string[]>>({})
let _showBuffModal = $state(false)
let _showDamageTypeModal = $state(false)
let _buffDiffMode = $state(false)
let _locked = $state(false)
/** @desc 全局生效配置：各角色共鸣链 / 武器精炼阶数（由工程变量/队伍槽位派生，结果计算与条件过滤共用） */
let _conditionProfile: ConditionProfile = $state({ chains: [0, 0, 0], refinements: [1, 1, 1] })
/** @desc 默认隐藏条件不匹配（链/阶低于配置、属性/类型对不上条目）的 buff */
let _hideConditionMismatch = $state(true)
/** @desc 锁定态下拦截所有写操作（加锁环节，如对比分锁） */
function assertUnlocked(): boolean {
    if (_locked) {
        addToast('本环节已锁定，请先解锁', 'info')
        return false
    }
    return true
}
let _initTeam: [CharSlot, CharSlot, CharSlot] | null = null
let _initTimelineData: TimelineData | null = null
let _globalBuffSetIds = $state<string[]>([])
let _onupdate: ((state: CalcState) => void) | undefined = $state()

/**
 * @desc ── 拉表撤销/重做：只记录表格变化（Buff 实例与乘区条件 / 绑定 / 条目条件与变量写入 / 变量表）──
 * 所有表格写操作统一调用 `markTableDirty()`；微任务里与基线比较后压栈，因此连续拖拽数值、
 * 批量勾选只会留下一条历史，也不会为每一帧压栈。历史栈与 GUI 的 `canUndoTable/canRedoTable`
 * 通过 `_historyVersion` 计数器保持响应式。
 */
const MAX_TABLE_HISTORY = 100
let _undoStack: CalcState[] = []
let _redoStack: CalcState[] = []
/** @desc 上次提交的表格快照（差异判定；避免无变更时压栈） */
let _historyBase: CalcState | null = null
/** @desc 历史栈版本号（供界面派生 canUndo/canRedo 的响应式依赖） */
let _historyVersion = $state(0)
let _historyDirty = false
let _historyScheduled = false
/**
 * @desc store 自身触发的回写标记：`markTableDirty()` / 撤销重做 / AI 工具改写都会用 `_onupdate` 通知宿主，
 * 宿主把新状态作为 `savedState` 再传回 `init()` —— 这属于「自证回写」，**不是**外部数据变化，
 * 因此不能刷新基线与历史。置位后由下一次 `init()` 消费并清除。
 */
let _updateInFlight = false

/** @desc 表格快照（撤销/重做只覆盖这些数据；条目由时间线派生，不纳入历史） */
const tableSnapshot = (): CalcState => getCalcState()

/** @desc 标记表格已变更：微任务合并后压入撤销栈（与基线无差异时忽略） */
export function markTableDirty(): void {
    // 基线兜底：`markTableDirty()` 必须在写操作**之前**调用（各 mutation 均遵守），
    // 因此此刻的快照就是「变更前状态」。若基线尚未建立（例如本会话还没有任何 init 落基线），
    // 这里同步补种基线 —— 保证第一次修改也能撤销（微任务里的基线会晚于本 tick 内的同步写操作）。
    if (_historyBase === null) _historyBase = tableSnapshot()
    _historyDirty = true
    if (_historyScheduled) return
    _historyScheduled = true
    queueMicrotask(() => {
        _historyScheduled = false
        if (!_historyDirty) return
        _historyDirty = false
        const snap = tableSnapshot()
        if (_historyBase && JSON.stringify(_historyBase) === JSON.stringify(snap)) return
        if (_historyBase) {
            _undoStack = [..._undoStack, _historyBase]
            if (_undoStack.length > MAX_TABLE_HISTORY) _undoStack = _undoStack.slice(1)
            _redoStack = []
        }
        _historyBase = snap
        _historyVersion++
    })
}

/** @desc 用快照覆盖当前表格状态并通知宿主持久化 */
const applyTableSnapshot = (snap: CalcState): void => {
    _buffSets = JSON.parse(JSON.stringify(snap.buffSets ?? []))
    _damageEntryBuffSetIds = JSON.parse(JSON.stringify(snap.damageEntryBuffSetIds ?? {}))
    _damageEntryDamageTypes = JSON.parse(JSON.stringify(snap.damageEntryDamageTypes ?? {}))
    _globalBuffSetIds = _buffSets.filter((bs) => bs.global).map((bs) => bs.id)
    if (_onupdate) {
        _updateInFlight = true
        _onupdate(tableSnapshot())
    }
}

/** @desc 撤销上一次表格变更（只回退表格，不动排轴/词条） */
export function undoTable(): boolean {
    if (!assertUnlocked()) return false
    const prev = _undoStack[_undoStack.length - 1]
    if (!prev) {
        addToast('没有可撤销的表格操作', 'info')
        return false
    }
    _undoStack = _undoStack.slice(0, -1)
    _redoStack = [..._redoStack, tableSnapshot()]
    _historyBase = prev
    applyTableSnapshot(prev)
    _historyVersion++
    return true
}

/** @desc 重做上一次被撤销的表格变更 */
export function redoTable(): boolean {
    if (!assertUnlocked()) return false
    const next = _redoStack[_redoStack.length - 1]
    if (!next) {
        addToast('没有可重做的表格操作', 'info')
        return false
    }
    _redoStack = _redoStack.slice(0, -1)
    _undoStack = [..._undoStack, tableSnapshot()]
    _historyBase = next
    applyTableSnapshot(next)
    _historyVersion++
    return true
}

/** @desc 是否可撤销 / 可重做表格变更（底部工具栏按钮禁用态用；读取历史版本号以保持响应式） */
export function canUndoTable(): boolean {
    const version = _historyVersion
    void version
    return _undoStack.length > 0
}

export function canRedoTable(): boolean {
    const version = _historyVersion
    void version
    return _redoStack.length > 0
}

/** @desc 清空表格撤销历史（切换/重载工程时调用，避免跨工程回退） */
export function resetTableHistory(): void {
    _undoStack = []
    _redoStack = []
    _historyBase = null
    _historyDirty = false
    _historyVersion++
}

/** @desc 初始化/重建整个 store：写入队伍与时间线、加载保存态（过滤[配置]自动块）、重建伤害条目、同步全局 buff；返回前清理孤儿绑定 */
/**
 * @desc 上次 init 的「身份指纹」：队伍 + 时间线身份 + 锁定态（**不含** savedState 内容）。
 * 身份变化 = 换工程 / 换队伍 / 换阶段锁定态 → 表格历史必须重置；
 * 同一工程内数据自身变化（勾选回写）只刷新基线，不得清空历史。
 */
let _lastInitIdentity = ''
/**
 * @desc 上次 init 的「数据指纹」：savedState 内容。数据指纹变化只更新基线（不重建、不清历史）。
 */
let _lastInitData = ''

/** @desc 队伍指纹：角色 + 武器（换人/换武器都属于身份变化） */
const teamFingerprint = (team: [CharSlot, CharSlot, CharSlot]): string =>
    team.map((s) => `${s.character ?? ''}|${s.weapon ?? ''}`).join(',')

/** @desc 时间线身份指纹：参考线/操作块/伤害块的数量与首末 id（内容位移不算身份变化） */
const timelineFingerprint = (timelineData: TimelineData | null): string => {
    const tl = timelineData
    if (!tl) return 'null'
    return `${tl.refLines.length}:${tl.refLines[0]?.id ?? ''}:${tl.refLines[tl.refLines.length - 1]?.id ?? ''}|${tl.opBlocks.length}:${tl.opBlocks[0]?.id ?? ''}:${tl.opBlocks[tl.opBlocks.length - 1]?.id ?? ''}|${tl.damageBlocks.length}:${tl.damageBlocks[0]?.id ?? ''}:${tl.damageBlocks[tl.damageBlocks.length - 1]?.id ?? ''}`
}

const initIdentity = (
    team: [CharSlot, CharSlot, CharSlot],
    timelineData: TimelineData | null,
    locked: boolean
): string => `${teamFingerprint(team)}|${timelineFingerprint(timelineData)}|${locked}`

export function init(
    team: [CharSlot, CharSlot, CharSlot],
    timelineData: TimelineData | null,
    savedState: CalcState | null,
    locked = false,
    onupdate?: (state: CalcState) => void
) {
    _locked = locked
    _onupdate = onupdate
    const identity = initIdentity(team, timelineData, locked)
    const dataFp = savedState ? JSON.stringify(savedState) : 'null'
    if (identity === _lastInitIdentity && dataFp === _lastInitData) {
        // 幂等短路：身份与数据都未变（如 onupdate 回写自证），仅更新回调引用，跳过全量重建
        _updateInFlight = false
        _initTeam = team
        _initTimelineData = timelineData
        return
    }
    const identityChanged = identity !== _lastInitIdentity
    /** @desc 本次 savedState 是否来自 store 自身的回写（而非外部数据变化） */
    const selfEcho = _updateInFlight
    _updateInFlight = false
    _lastInitIdentity = identity
    _lastInitData = dataFp
    _initTeam = team
    _initTimelineData = timelineData

    if (!identityChanged && selfEcho) {
        // 自身编辑的回写：store 内部已是权威状态，不做任何重载（避免覆盖进行中的编辑）
        return
    }

    const names = team.map((s) => s.character).filter(Boolean) as string[]
    const haveAllElements = names.every((n) => getCharElementMap()[n])
    _entries = buildDamageEntries(team, timelineData)
    if (names.length > 0 && !haveAllElements) {
        // 元素图异步就绪后重建一次条目（补齐 damageElement）；与排轴页共用共享元素图，
        // 由 data/char-elements 去重在途请求，避免重复抓取与条目二次构建竞态
        void ensureCharElements(names).then(() => {
            if (_initTeam && _initTimelineData) _entries = buildDamageEntries(_initTeam, _initTimelineData)
        })
    }
    if (savedState) {
        const autoIds = (savedState.buffSets ?? []).filter((bs) => bs.name.startsWith('[配置]')).map((bs) => bs.id)
        // 一次深拷贝导出子集，避免对保存态反复 JSON 序列化
        const saved = JSON.parse(JSON.stringify(savedState)) as CalcState
        _buffSets = (saved.buffSets ?? []).filter((bs) => !bs.name.startsWith('[配置]'))
        _damageEntryBuffSetIds = saved.damageEntryBuffSetIds ?? {}
        for (const [entryId, setIds] of Object.entries(_damageEntryBuffSetIds)) {
            _damageEntryBuffSetIds[entryId] = setIds.filter((sid) => !autoIds.includes(sid))
        }
        _damageEntryDamageTypes = Object.fromEntries(
            Object.entries(saved.damageEntryDamageTypes ?? {}).map(([id, types]) => [
                id,
                types.map((t) => (t === '视为效应伤害' ? '效应伤害' : t))
            ])
        )
    } else {
        _buffSets = []
        _damageEntryBuffSetIds = {}
        _damageEntryDamageTypes = {}
    }
    _globalBuffSetIds = _buffSets.filter((bs) => bs.global).map((bs) => bs.id)
    rebindGlobalBuffs()
    if (identityChanged) {
        // 身份变化（换工程/换队伍/换锁定态）：清空历史，避免把上一个身份的表格状态撤销回来；
        // 随后立刻落一次基线 —— 让「第一次修改」也能被撤销
        // （markTableDirty 在没有基线时只建立基线不压栈）。
        resetTableHistory()
        _historyBase = tableSnapshot()
    }
    const pruned = pruneOrphanedBindings()
    if (pruned) {
        if (_onupdate) {
            _updateInFlight = true
            _onupdate(getCalcState())
        }
    }
}

/** @desc 清理绑定表中已不存在条目的孤儿映射（条目被删后残留的 buff 绑定） */
function pruneOrphanedBindings(): boolean {
    const validIds = new Set(_entries.map((e) => e.id))
    let changed = false
    const prune = (table: Record<string, string[]>): Record<string, string[]> | null => {
        const entries = Object.entries(table)
        const kept = entries.filter(([id]) => validIds.has(id))
        if (kept.length !== entries.length) {
            changed = true
            return Object.fromEntries(kept)
        }
        return null
    }
    const buff = prune(_damageEntryBuffSetIds)
    const types = prune(_damageEntryDamageTypes)
    if (buff) _damageEntryBuffSetIds = buff
    if (types) _damageEntryDamageTypes = types
    return changed
}

/** @desc 从时间线数据构建全部伤害条目：遍历 damageBlocks 中的 skillHits（解析倍率成分→按基础类型分组，含固定值条目）与非直伤条目（响应/处决/效应：查技能缓存取倍率、按元素归类、效应层数映射） */
function buildDamageEntriesFromTimeline(tl: TimelineData, _team: [CharSlot, CharSlot, CharSlot]): DamageEntry[] {
    const temp: Array<{ item: DamageEntry; pos: number; order: number }> = []
    let order = 0

    for (const db of tl.damageBlocks) {
        let pos = 0
        if (db.sourceType === 'op') {
            pos = tl.opBlocks.find((o) => o.id === db.sourceId)?.pos ?? 0
        } else {
            pos = tl.refLines.find((r) => r.id === db.sourceId)?.pos ?? 0
        }

        for (const hit of db.skillHits) {
            const comps = parseValueString(hit.ratio)

            // Determine contextual baseType: last part with an explicit suffix
            let contextBaseType = '攻击'
            for (let i = comps.length - 1; i >= 0; i--) {
                const c = comps[i]
                if (c.flatValue !== undefined) continue
                if (!c.implicitSuffix) {
                    contextBaseType = c.baseType
                    break
                }
            }

            const pctMap = new Map<string, number>()
            let flatTotal = 0
            for (const c of comps) {
                if (c.flatValue !== undefined) {
                    flatTotal += c.flatValue
                } else {
                    const resolvedType = c.implicitSuffix ? contextBaseType : c.baseType
                    const weighted = c.ratioNum * (c.mult ?? 1)
                    pctMap.set(resolvedType, (pctMap.get(resolvedType) ?? 0) + weighted)
                }
            }

            const echoName =
                hit.skillType === '声骸技能'
                    ? (_team.find((s) => s.character === hit.character)?.echoes?.[0]?.name ?? null)
                    : null
            const displayName =
                hit.skillType === '声骸技能' && echoName
                    ? echoName + '·' + hit.hitName.replace('伤害', '') + '(' + hit.skillType + ')'
                    : hit.hitName.replace('伤害', '') + '(' + hit.skillType + ')'
            for (const [baseType, ratioSum] of pctMap) {
                const id = `${db.id}-${hit.skillType}|${hit.hitName}#${baseType}`
                temp.push({
                    item: {
                        id,
                        character: hit.character,
                        skillType: hit.skillType,
                        hitName: hit.hitName,
                        displayName,
                        isEffect: false,
                        isTuneBreak: false,
                        isTuneResponse: false,
                        ratioValue: ratioSum * (hit.hits ?? 1),
                        ratioUnit: '%',
                        damageBaseType: baseType,
                        damageElement: hit.element || getCharElementMap()[hit.character] || '',
                        sourceTimelineBlockId: db.sourceId,
                        hits: hit.hits ?? 1
                    },
                    pos,
                    order: order++
                })
            }

            if (flatTotal > 0) {
                const id = `${db.id}-${hit.skillType}|${hit.hitName}#固定`
                temp.push({
                    item: {
                        id,
                        character: hit.character,
                        skillType: hit.skillType,
                        hitName: hit.hitName,
                        displayName,
                        isEffect: false,
                        isTuneBreak: false,
                        isTuneResponse: false,
                        ratioValue: flatTotal * (hit.hits ?? 1),
                        ratioUnit: 'fixed',
                        damageBaseType: '固定',
                        damageElement: hit.element || getCharElementMap()[hit.character] || '',
                        sourceTimelineBlockId: db.sourceId,
                        hits: hit.hits ?? 1
                    },
                    pos,
                    order: order++
                })
            }
        }

        for (const nd of db.nonDirectEntries) {
            if (nd.category === '响应') {
                for (const responder of nd.responders ?? []) {
                    let ratio = 0
                    let element = ''
                    const groups = getSkillCache()[responder]
                    if (groups) {
                        for (const group of groups) {
                            const match = group.hits.find((h) => h.name.includes('震谐') || h.name.includes('骇破'))
                            if (match) {
                                const comps = parseValueString(match.ratio)
                                const total = comps.reduce((sum, c) => {
                                    if (c.flatValue !== undefined) return sum + c.flatValue
                                    return sum + c.ratioNum * (c.mult ?? 1)
                                }, 0)
                                if (ratio === 0) ratio = total
                                if (match.element && !element) element = match.element
                            }
                        }
                    }
                    if (!element) element = getCharElementMap()[responder] ?? ''
                    const id = `${db.id}-nd|${nd.name}#${responder}`
                    temp.push({
                        item: {
                            id,
                            character: responder,
                            skillType: '偏谐响应',
                            hitName: nd.name,
                            displayName: nd.name,
                            isEffect: false,
                            isTuneBreak: false,
                            isTuneResponse: true,
                            ratioValue: ratio,
                            ratioUnit: '%',
                            damageBaseType: '偏谐系数',
                            damageElement: element,
                            sourceTimelineBlockId: db.sourceId,
                            hits: 1
                        },
                        pos,
                        order: order++
                    })
                }
            } else if (nd.category === '处决') {
                const char = nd.responders?.[0] ?? ''
                const id = `${db.id}-nd|${nd.name}`
                temp.push({
                    item: {
                        id,
                        character: char,
                        skillType: '谐度破坏',
                        hitName: '谐度破坏',
                        displayName: '谐度破坏',
                        isEffect: false,
                        isTuneBreak: true,
                        isTuneResponse: false,
                        ratioValue: 1600,
                        ratioUnit: '%',
                        damageBaseType: '偏谐系数',
                        damageElement: '物理',
                        sourceTimelineBlockId: db.sourceId,
                        hits: 1
                    },
                    pos,
                    order: order++
                })
            } else if (nd.category === '效应') {
                if (nd.name === '电磁爆发') continue
                const isDianci = nd.name === '电磁效应'
                const burstLayers = isDianci
                    ? (db.nonDirectEntries.find((n) => n.name === '电磁爆发' && n.category === '效应')?.layers ?? 0)
                    : 0
                const id = `${db.id}-nd|${nd.name}`
                temp.push({
                    item: {
                        id,
                        character: undefined,
                        skillType: '效应结算',
                        hitName: nd.name,
                        displayName:
                            isDianci && burstLayers > 0
                                ? nd.name + nd.layers + '层+爆发' + burstLayers + '层'
                                : nd.name + nd.layers + '层',
                        isEffect: true,
                        isTuneBreak: false,
                        isTuneResponse: false,
                        ratioValue: nd.layers,
                        ratioUnit: '%',
                        damageBaseType: '效应系数',
                        damageElement: NON_DIRECT_ELEMENT[nd.name] ?? '',
                        sourceTimelineBlockId: db.sourceId,
                        burstLayers: isDianci ? burstLayers : 0,
                        hits: nd.hits ?? 1
                    },
                    pos,
                    order: order++
                })
            }
        }
    }

    temp.sort((a, b) => a.pos - b.pos || a.order - b.order)
    return temp.map((t) => t.item)
}

/** @desc 伤害条目入口：无时间线时返回空数组 */
function buildDamageEntries(_team: [CharSlot, CharSlot, CharSlot], _timelineData: TimelineData | null): DamageEntry[] {
    if (!_timelineData) return []

    const items = buildDamageEntriesFromTimeline(_timelineData, _team)

    return items
}

export function getAllDamageEntries(): DamageEntry[] {
    return _entries
}

/** @desc ── BuffSet CRUD ── */

export function getAllBuffSets(): BuffSet[] {
    return _buffSets
}

/** @desc 待定位的 BUFF 集 id（由「以此为名创建BUFF」写入；buff-modal 打开后消费一次并滚动到它） */
let _pendingFocusBuffSetId = $state<string | null>(null)

export function setPendingFocusBuffSetId(id: string | null) {
    _pendingFocusBuffSetId = id
}

/** @desc 取出并清空待定位 id（只消费一次） */
export function takePendingFocusBuffSetId(): string | null {
    const id = _pendingFocusBuffSetId
    _pendingFocusBuffSetId = null
    return id
}

/** @desc 新建空 Buff 块（随机 id，默认全队作用域），返回新块 id */
export function createBuffSet(name: string): string | undefined {
    if (!assertUnlocked()) return undefined
    const buffSet: BuffSet = {
        id: `buffSet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        zones: [],
        scope: 'all'
    }
    markTableDirty()
    _buffSets = [..._buffSets, buffSet]
    return buffSet.id
}

/** @desc 导入接口类型：外部（工坊 share / AI）传入的 Buff 结构，scope 用 share 语义（self/self_except/team/effect_only） */
export interface ImportBuffZone {
    zoneId: string
    value: number
    override?: boolean
    ref?: {
        targetZoneId: string
        pct: number
        threshold?: number
        lower?: number
        upper?: number
        discrete?: boolean
        divisor?: number
        multiplier?: number
        refOwner?: 'self' | 'owner'
    }
}

export interface ImportBuffInput {
    name: string
    scope?: 'self' | 'self_except' | 'team' | 'effect_only'
    ownerIdx?: number
    condition?: BuffCondition
    zones: ImportBuffZone[]
}

/** @desc share 的 scope 语义 → 工具 BuffSet.scope（'all' | number[]）：由导入方传入 ownerIdx（该实体归属的角色槽位，无则 -1），self_except 需要队伍总槽位数 */
export function mapImportedScope(
    scope: ImportBuffInput['scope'],
    ownerIdx: number,
    teamSize: number
): 'all' | number[] {
    switch (scope) {
        case 'self':
            return ownerIdx >= 0 ? [ownerIdx] : []
        case 'self_except': {
            if (ownerIdx < 0) return 'all'
            const idxs: number[] = []
            for (let i = 0; i < teamSize; i++) if (i !== ownerIdx) idxs.push(i)
            return idxs.length ? idxs : []
        }
        case 'effect_only':
        case 'team':
        default:
            return 'all'
    }
}

/** @desc 批量导入 Buff 块：校验乘区合法性、转换引用（ZONE_REF_MAP 校验）、按导入自然序排序后并入列表，返回成功条数 */
export function importBuffSets(items: ImportBuffInput[], ownerIdx = -1, teamSize = 3) {
    if (!assertUnlocked()) return 0
    const fresh: BuffSet[] = []
    for (const item of items) {
        const name = item.name.trim()
        if (!name) continue
        const zones: BuffZoneValue[] = []
        for (const z of item.zones ?? []) {
            const zoneId = z.zoneId as BuffZoneValue['zoneId']
            if (!ZONE_MAP.has(zoneId)) continue
            const zone: BuffZoneValue = { zoneId, value: z.value }
            if (z.ref && ZONE_REF_MAP.has(z.ref.targetZoneId as never) && !ZONE_NO_REF_IDS.has(zoneId)) {
                zone.ref = {
                    characterIdx: item.ownerIdx ?? ownerIdx,
                    zoneId: z.ref.targetZoneId as never,
                    threshold: z.ref.threshold ?? 0,
                    pct: z.ref.pct,
                    lower: z.ref.lower,
                    upper: z.ref.upper,
                    discrete: z.ref.discrete,
                    divisor: z.ref.divisor,
                    multiplier: z.ref.multiplier
                }
            }
            if (z.override) zone.override = true
            zones.push(zone)
        }
        const owner = item.ownerIdx ?? ownerIdx
        /**
         * @desc 来源是某个角色的 buff（有归属角色槽位）且本身没有链/阶条件时，
         * 条件补成「角色 ≥ 0 阶」—— **0 阶表示本体**（未精炼武器），
         * 这样条目既保留了「挂在谁的武器上」的归属（左侧列表按「角色名的武器名」归档），
         * 又不会因为精炼档位把本体效果挡掉。
         */
        const baseCondition = normalizeCondition(item.condition, 'buff', owner)
        const hasGate = (baseCondition.chains?.length ?? 0) > 0 || (baseCondition.refinements?.length ?? 0) > 0
        const condition =
            owner >= 0 && !hasGate ? { ...baseCondition, refinements: [{ charIdx: owner, min: 0 }] } : baseCondition
        const buffSet: BuffSet = {
            id: `buffSet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name,
            zones,
            scope: mapImportedScope(item.scope, owner, teamSize),
            ...(isConditionEmpty(condition) ? {} : { condition }),
            ...(owner >= 0 && !isConditionEmpty(condition) ? { conditionRefCharIdx: owner } : {})
        }
        fresh.push(buffSet)
    }
    if (!fresh.length) return 0
    // 导入前按条目名自然排序：数字段按数值（1层 < 2层 < 10层 < 11层），其余按 unicode 码点
    fresh.sort((a, b) => compareNatural(a.name, b.name))
    markTableDirty()
    _buffSets = [..._buffSets, ...fresh]
    return fresh.length
}

/** @desc 自然排序：数字段按数值比较（1层 < 2层 < 10层 < 11层），其余按 unicode 码点比较 */
export function compareNatural(a: string, b: string): number {
    let i = 0
    let j = 0
    while (i < a.length && j < b.length) {
        const ad = /\d/.test(a[i])
        const bd = /\d/.test(b[j])
        if (ad && bd) {
            let x = i
            let y = j
            while (x < a.length && /\d/.test(a[x])) x++
            while (y < b.length && /\d/.test(b[y])) y++
            const na = BigInt(a.slice(i, x))
            const nb = BigInt(b.slice(j, y))
            if (na !== nb) return na < nb ? -1 : 1
            i = x
            j = y
        } else {
            if (a[i] !== b[j]) return a[i] < b[j] ? -1 : 1
            i++
            j++
        }
    }
    return a.length - b.length
}

/** @desc 复制 Buff 块（插入到原块之后，返回新 id；复制品自动解除全局） */
export function duplicateBuffSet(id: string, customName?: string): string | undefined {
    if (!assertUnlocked()) return
    const source = _buffSets.find((s) => s.id === id)
    if (!source) return
    const newId = `buffSet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const buffSet: BuffSet = {
        ...source,
        id: newId,
        name: customName ?? source.name + ' 复制',
        global: false
    }
    const idx = _buffSets.findIndex((s) => s.id === id)
    const next = [..._buffSets]
    next.splice(idx + 1, 0, buffSet)
    markTableDirty()
    _buffSets = next
    return newId
}

/** @desc 设置 Buff 作用域（全局 buff 不允许改） */
export function setBuffSetScope(setId: string, scope: 'all' | number[]) {
    if (!assertUnlocked()) return
    if (_globalBuffSetIds.includes(setId)) return
    markTableDirty()
    _buffSets = _buffSets.map((s) => (s.id === setId ? { ...s, scope } : s))
}

/** @desc 设置 Buff 实例级生效条件（链条件 / 阶条件等硬性条件挂这里） */
export function setBuffSetCondition(setId: string, condition: BuffCondition | null) {
    if (!assertUnlocked()) return
    const normalized = condition ? normalizeCondition(condition, 'buff') : null
    markTableDirty()
    _buffSets = _buffSets.map((s) =>
        s.id === setId
            ? {
                  ...s,
                  ...(normalized && !isConditionEmpty(normalized)
                      ? { condition: normalized }
                      : { condition: undefined })
              }
            : s
    )
}

/** @desc 设置条件参考角色槽位（链/精炼条件的参考角色） */
export function setBuffSetConditionRef(setId: string, charIdx: number | null) {
    if (!assertUnlocked()) return
    markTableDirty()
    _buffSets = _buffSets.map((s) =>
        s.id === setId
            ? { ...s, ...(charIdx !== null ? { conditionRefCharIdx: charIdx } : { conditionRefCharIdx: undefined }) }
            : s
    )
}

/** @desc 对某个 Buff 的乘区条目列表做不可变变换 */
const withZones = (buff: BuffSet, transform: (zones: BuffZoneValue[]) => BuffZoneValue[]): BuffSet => ({
    ...buff,
    zones: transform(buff.zones ?? [])
})

/**
 * @desc 按**下标**修改某个乘区条目（同一乘区可被添加多次，各自独立配置数值/引用/条件）。
 * 右栏「添加乘区」后每个条目就是一个独立实例，因此界面按位置而非 zoneId 定位。
 */
export function updateZoneAt(setId: string, zoneIndex: number, updater: (zone: BuffZoneValue) => BuffZoneValue): void {
    if (!assertUnlocked()) return
    markTableDirty()
    _buffSets = _buffSets.map((s) =>
        s.id === setId ? withZones(s, (zones) => zones.map((z, i) => (i === zoneIndex ? updater(z) : z))) : s
    )
}

/** @desc 按下标移除某个乘区条目 */
export function removeZoneAt(setId: string, zoneIndex: number): void {
    if (!assertUnlocked()) return
    markTableDirty()
    _buffSets = _buffSets.map((s) =>
        s.id === setId ? withZones(s, (zones) => zones.filter((_, i) => i !== zoneIndex)) : s
    )
}

/** @desc 按下标设置某乘区条目的数值 */
export function setZoneValueAt(setId: string, zoneIndex: number, value: number): void {
    updateZoneAt(setId, zoneIndex, (z) => ({ ...z, value }))
}

/** @desc 按下标设置某乘区条目的生效条件（链/阶会被强制剥离，属整块硬性条件） */
export function setZoneConditionAt(setId: string, zoneIndex: number, condition: BuffCondition | null): void {
    const normalized = condition ? normalizeConditionForScope(normalizeCondition(condition, 'zone'), 'zone') : null
    const isEmpty = !normalized || isConditionEmpty(normalized)
    updateZoneAt(setId, zoneIndex, (z) => ({
        ...z,
        ...(isEmpty ? { condition: undefined } : { condition: normalized })
    }))
}

/** @desc 按下标切换某乘区条目的「追加/覆盖」标记（extraRatio 恒为追加；覆盖时清除引用） */
export function setZoneOverrideAt(setId: string, zoneIndex: number, override: boolean): void {
    if (!assertUnlocked()) return
    const zoneId = _buffSets.find((s) => s.id === setId)?.zones?.[zoneIndex]?.zoneId
    if (!zoneId) return
    const nextOverride = zoneId === 'extraRatio' ? false : override
    markTableDirty()
    _buffSets = _buffSets.map((s) => {
        if (s.id !== setId) return s
        return withZones(s, (list) =>
            list.map((z, i) => {
                if (i === zoneIndex) {
                    return { ...z, override: nextOverride || undefined, ref: nextOverride ? undefined : z.ref }
                }
                // 同一 Buff 内每个乘区只允许一个覆盖条目：开启覆盖时清掉同乘区其它条目的覆盖
                if (nextOverride && z.zoneId === zoneId && z.override) return { ...z, override: undefined }
                return z
            })
        )
    })
}

/** @desc 按下标设置某乘区条目的引用转模配置（有引用时清除覆盖标记） */
export function setZoneRefAt(
    setId: string,
    zoneIndex: number,
    ref: import('./calculation.types').ZoneRef | null
): void {
    updateZoneAt(setId, zoneIndex, (z) => ({ ...z, ref: ref ?? undefined, override: ref ? undefined : z.override }))
}

/** @desc ── 乘区级生效条件（条件挂在具体乘区条目上）── */

/** @desc 读取某乘区条目的生效条件（同一乘区可有多条，取第一条命中的） */
export function getBuffSetZoneCondition(setId: string, zoneId: string): BuffCondition | undefined {
    const bs = _buffSets.find((s) => s.id === setId)
    if (!bs) return undefined
    return bs.zones.find((z) => z.zoneId === (zoneId as ZoneId))?.condition
}

/**
 * @desc 设置某乘区的生效条件（伤害类型 / 伤害属性）。
 * 链条件与阶条件是整个 Buff 的硬性条件，这里会被强制剥离（不允许挂到乘区上）。
 */
export function setBuffSetZoneCondition(setId: string, zoneId: string, condition: BuffCondition | null): void {
    if (!assertUnlocked()) return
    const normalized = condition ? normalizeConditionForScope(normalizeCondition(condition, 'zone'), 'zone') : null
    const isEmpty = !normalized || isConditionEmpty(normalized)
    markTableDirty()
    _buffSets = _buffSets.map((s) => {
        if (s.id !== setId) return s
        return withZones(s, (zones) =>
            zones.map((z) =>
                z.zoneId === (zoneId as ZoneId)
                    ? { ...z, ...(isEmpty ? { condition: undefined } : { condition: normalized }) }
                    : z
            )
        )
    })
}

/** @desc 设置某乘区的引用（存在引用时清除 override 标记） */
export function setBuffSetZoneRef(setId: string, zoneId: string, ref: import('./calculation.types').ZoneRef | null) {
    if (!assertUnlocked()) return
    markTableDirty()
    _buffSets = _buffSets.map((s) => {
        if (s.id !== setId) return s
        return withZones(s, (zones) =>
            zones.map((z) =>
                z.zoneId === zoneId ? { ...z, ref: ref ?? undefined, override: ref ? undefined : z.override } : z
            )
        )
    })
}

/**
 * @desc 按乘区 id 切换「追加/覆盖」标记（extraRatio 恒为追加；覆盖时清除引用）。
 * 覆盖唯一：同一 Buff 内每个乘区只保留一个覆盖条目 —— 开启时落在该乘区的第一条，其余条目取消覆盖。
 */
export function setBuffSetZoneOverride(setId: string, zoneId: string, override: boolean) {
    if (!assertUnlocked()) return
    const nextOverride = zoneId === 'extraRatio' ? false : override
    markTableDirty()
    let assigned = false
    _buffSets = _buffSets.map((s) => {
        if (s.id !== setId) return s
        return withZones(s, (zones) =>
            zones.map((z) => {
                if (z.zoneId !== (zoneId as ZoneId)) return z
                if (!nextOverride) return { ...z, override: undefined }
                if (assigned) return { ...z, override: undefined }
                assigned = true
                return { ...z, override: true, ref: undefined }
            })
        )
    })
}

/** @desc 切换收藏标记 */
export function toggleBuffSetStarred(id: string) {
    if (!assertUnlocked()) return
    markTableDirty()
    _buffSets = _buffSets.map((s) => (s.id === id ? { ...s, starred: !s.starred } : s))
}

/** @desc 并入/移出全局：并入时清理该 buff 在全部条目上的绑定并加入全局列表，随后重建全局绑定 */
export function setBuffSetGlobal(id: string, global: boolean): boolean {
    if (!assertUnlocked()) return false
    const bs = _buffSets.find((s) => s.id === id)
    if (!bs) return false
    markTableDirty()
    _buffSets = _buffSets.map((s) => (s.id === id ? { ...s, global } : s))
    _globalBuffSetIds = global
        ? [..._globalBuffSetIds.filter((sid) => sid !== id), id]
        : _globalBuffSetIds.filter((sid) => sid !== id)

    if (global) {
        const next: Record<string, string[]> = {}
        for (const [entryId, setIds] of Object.entries(_damageEntryBuffSetIds)) {
            const filtered = setIds.filter((sid) => sid !== id)
            if (filtered.length > 0) next[entryId] = filtered
        }
        _damageEntryBuffSetIds = next
    }

    rebindGlobalBuffs()
    if (_onupdate) {
        _updateInFlight = true
        _onupdate(getCalcState())
    }
    return true
}

/** @desc 删除 Buff 块（全局 buff 不可删），同时清理所有条目上的绑定 */
export function deleteBuffSet(id: string) {
    if (!assertUnlocked()) return
    if (_globalBuffSetIds.includes(id)) return
    markTableDirty()
    _buffSets = _buffSets.filter((s) => s.id !== id)
    const next: Record<string, string[]> = {}
    for (const [entryId, setIds] of Object.entries(_damageEntryBuffSetIds)) {
        const filtered = setIds.filter((sid) => sid !== id)
        if (filtered.length > 0) next[entryId] = filtered
    }
    _damageEntryBuffSetIds = next
}

/** @desc 批量删除 Buff 块（跳过全局 buff），同时清理所有条目上的绑定 */
export function deleteBuffSets(ids: string[]) {
    if (!assertUnlocked()) return
    const targets = ids.filter((id) => !_globalBuffSetIds.includes(id))
    if (targets.length === 0) return
    const idSet = new Set(targets)
    markTableDirty()
    _buffSets = _buffSets.filter((s) => !idSet.has(s.id))
    const next: Record<string, string[]> = {}
    for (const [entryId, setIds] of Object.entries(_damageEntryBuffSetIds)) {
        const filtered = setIds.filter((sid) => !idSet.has(sid))
        if (filtered.length > 0) next[entryId] = filtered
    }
    _damageEntryBuffSetIds = next
}

/** @desc 批量并入/移出全局（跳过 global- 内置块），并入时清理条目绑定并重建全局自动绑定 */
export function setBuffSetsGlobal(ids: string[], global: boolean): boolean {
    if (!assertUnlocked()) return false
    const targets = ids.filter((id) => !id.startsWith('global-') && _buffSets.some((s) => s.id === id))
    if (targets.length === 0) return false
    const idSet = new Set(targets)
    _buffSets = _buffSets.map((s) => (idSet.has(s.id) ? { ...s, global } : s))
    _globalBuffSetIds = global
        ? [..._globalBuffSetIds.filter((sid) => !idSet.has(sid)), ...targets]
        : _globalBuffSetIds.filter((sid) => !idSet.has(sid))
    if (global) {
        const next: Record<string, string[]> = {}
        for (const [entryId, setIds] of Object.entries(_damageEntryBuffSetIds)) {
            const filtered = setIds.filter((sid) => !idSet.has(sid))
            if (filtered.length > 0) next[entryId] = filtered
        }
        _damageEntryBuffSetIds = next
    }
    rebindGlobalBuffs()
    if (_onupdate) {
        _updateInFlight = true
        _onupdate(getCalcState())
    }
    return true
}

/** @desc 重命名 Buff 块 */
export function renameBuffSet(id: string, name: string) {
    if (!assertUnlocked()) return
    markTableDirty()
    _buffSets = _buffSets.map((s) => (s.id === id ? { ...s, name } : s))
}

/** @desc 给 Buff 块新增一个乘区条目（默认值 0；同一乘区可添加多次） */
export function addZoneToBuffSet(setId: string, zoneId: string) {
    if (!assertUnlocked()) return
    markTableDirty()
    _buffSets = _buffSets.map((s) =>
        s.id === setId
            ? withZones(s, (zones) => [...zones, { zoneId: zoneId as ZoneId, value: 0 } as BuffZoneValue])
            : s
    )
}

/** @desc 从 Buff 块移除某乘区的全部条目 */
export function removeZoneFromBuffSet(setId: string, zoneId: string) {
    if (!assertUnlocked()) return
    markTableDirty()
    _buffSets = _buffSets.map((s) =>
        s.id === setId ? withZones(s, (zones) => zones.filter((z) => z.zoneId !== (zoneId as ZoneId))) : s
    )
}

/** @desc 设置某乘区条目的数值（按 zoneId 命中第一条；$state 深代理原地修改，避免整数组替换） */
export function setBuffSetZoneValue(setId: string, zoneId: string, value: number) {
    if (!assertUnlocked()) return
    const bs = _buffSets.find((s) => s.id === setId)
    if (!bs) return
    const zone = bs.zones.find((z) => z.zoneId === (zoneId as ZoneId))
    if (!zone) return
    markTableDirty()
    zone.value = value
}

/** @desc ── 跨角色引用：本条目可勾选的「影响源」Buff ── */

export type { PaneEffectSource } from './pane-effects'

/**
 * @desc 某条目的「影响源」Buff：这些 Buff 的作用域指向**被本条目引用的角色**，且会改写被引用的那个面板乘区。
 *
 * 口径与引擎一致（伤害是当下的）：本条目引用的角色面板只由**绑定到本条目**的 Buff 组成，
 * 所以把这些 Buff 勾到本条目上就会参与该角色在这一段的面板计算 —— 因此它们要作为本条目的可勾选项
 * 出现在拉表里（平铺的该角色组、下拉的该条目 BUFF 区），而不是塞进引用配置弹窗。
 *
 * @returns buffId → { 被引用角色槽位, 被改写的面板乘区键 }
 */
export function getPaneEffectSources(entryId: string): Record<string, PaneEffectSource> {
    const entry = _entries.find((e) => e.id === entryId)
    if (!entry) return {}
    const team = _initTeam
    const charIdx = entry.character && team ? team.findIndex((s) => s.character === entry.character) : -1
    return paneEffectSourcesOf(charIdx, entry.isEffect, _damageEntryBuffSetIds[entryId] ?? [], _buffSets)
}

/** @desc ── Entry-BuffSet 绑定 ── */

export function getBuffSetIdsForEntry(entryId: string): string[] {
    return _damageEntryBuffSetIds[entryId] ?? []
}

/** @desc 覆写条目绑定的 Buff 集合（框选/行列头批量用） */
export function setBuffSetIdsForEntry(entryId: string, setIds: string[]): boolean {
    if (!assertUnlocked()) return false
    markTableDirty()
    _damageEntryBuffSetIds = { ..._damageEntryBuffSetIds, [entryId]: [...setIds] }
    return true
}

/** @desc 批量覆写多个条目绑定的 Buff 集合（框选批量用；单次变更单次通知） */
export function setBuffSetIdsForEntries(map: Record<string, string[]>): boolean {
    if (!assertUnlocked()) return false
    if (Object.keys(map).length === 0) return false
    const next = { ..._damageEntryBuffSetIds }
    for (const [entryId, setIds] of Object.entries(map)) {
        next[entryId] = [...setIds]
    }
    markTableDirty()
    _damageEntryBuffSetIds = next
    return true
}

/** @desc 切换条目↔Buff 的单条绑定 */
export function toggleBuffSetForEntry(entryId: string, setId: string) {
    if (!assertUnlocked()) return
    markTableDirty()
    const current = _damageEntryBuffSetIds[entryId] ?? []
    if (current.includes(setId)) {
        _damageEntryBuffSetIds = { ..._damageEntryBuffSetIds, [entryId]: current.filter((id) => id !== setId) }
    } else {
        _damageEntryBuffSetIds = { ..._damageEntryBuffSetIds, [entryId]: [...current, setId] }
    }
}

/** @desc ── 条目伤害类型（视为某类伤害）── */

export function getDamageTypesForEntry(entryId: string): string[] {
    return _damageEntryDamageTypes[entryId] ?? []
}

/** @desc 切换条目↔伤害类型的绑定 */
export function toggleDamageTypeForEntry(entryId: string, damageType: string) {
    if (!assertUnlocked()) return
    markTableDirty()
    const current = _damageEntryDamageTypes[entryId] ?? []
    if (current.includes(damageType)) {
        _damageEntryDamageTypes = { ..._damageEntryDamageTypes, [entryId]: current.filter((t) => t !== damageType) }
    } else {
        _damageEntryDamageTypes = { ..._damageEntryDamageTypes, [entryId]: [...current, damageType] }
    }
}

/** @desc 覆写条目的伤害类型集合（复制到下段直伤等用） */
export function setDamageTypesForEntry(entryId: string, types: string[]) {
    markTableDirty()
    _damageEntryDamageTypes = { ..._damageEntryDamageTypes, [entryId]: types }
}

/** @desc 同名伤害的范围：同一角色 + 同一技能类型 + 同名（避免不同技能类型下重名条目互相覆盖） */
function sameNameEntryIds(entry: DamageEntry): string[] {
    return _entries
        .filter(
            (e) =>
                e.character === entry.character &&
                (e.skillType ?? '') === (entry.skillType ?? '') &&
                e.displayName === entry.displayName
        )
        .map((e) => e.id)
}

/**
 * @desc 把某条目的伤害类型同步到所有同名伤害（同角色 + 同技能类型 + 同名）
 * @returns 实际写入的条目数（含自身；少于 2 表示没有同名同伴）
 */
export function syncDamageTypesToSameName(entryId: string): number {
    const entry = _entries.find((e) => e.id === entryId)
    if (!entry) return 0
    if (!assertUnlocked()) return 0
    const types = _damageEntryDamageTypes[entryId] ?? []
    const targets = sameNameEntryIds(entry)
    if (targets.length <= 1) return targets.length
    const next = { ..._damageEntryDamageTypes }
    for (const id of targets) next[id] = [...types]
    _damageEntryDamageTypes = next
    return targets.length
}

/** @desc 与某条目同名的其它倍率条目 id（不含自身）：界面用它判断「是否已全部一致」 */
export function getSameNameEntryIds(entryId: string): string[] {
    const entry = _entries.find((e) => e.id === entryId)
    if (!entry) return []
    return sameNameEntryIds(entry).filter((id) => id !== entryId)
}

/** @desc 与某条目同名的伤害条目数（含自身），用于界面提示可用性 */
export function countSameNameEntries(entryId: string): number {
    const entry = _entries.find((e) => e.id === entryId)
    return entry ? sameNameEntryIds(entry).length : 0
}

/** @desc ── Buff 弹窗开关 ── */

export function getShowBuffModal(): boolean {
    return _showBuffModal
}
export function setShowBuffModal(v: boolean) {
    _showBuffModal = v
}

/** @desc ── 「编辑伤害类型」弹窗开关（底部工具栏按钮打开，与 BUFF 配置同一条路径）── */

export function getShowDamageTypeModal(): boolean {
    return _showDamageTypeModal
}
export function setShowDamageTypeModal(v: boolean) {
    _showDamageTypeModal = v
}

/** @desc ── 条目配置（伤害类型）── */

export function getDamageEntryConfig(entryId: string): DamageEntryConfig {
    return {
        ...(damageTypesOf(entryId).length ? { damageTypes: damageTypesOf(entryId) } : {})
    }
}

const damageTypesOf = (entryId: string): string[] => _damageEntryDamageTypes[entryId] ?? []

/** @desc ── Buff 差异模式（拉表页按段展示 新增/移除/不变/全局 的 buff 变化）── */

export function getBuffDiffMode(): boolean {
    return _buffDiffMode
}
export function toggleBuffDiffMode() {
    _buffDiffMode = !_buffDiffMode
}

/** @desc ── 生效配置（链/阶）与条件不符隐藏 ── */

export function getConditionProfile(): ConditionProfile {
    return _conditionProfile
}

/** @desc 链/阶档位变更回调（由 +page 注入写回工程，覆盖弹窗/AI 工具等全部改动路径，保证 restore 恒为最新） */
let _profileChangeListener: (() => void) | undefined = $state()

export function setProfileChangeListener(fn: (() => void) | undefined) {
    _profileChangeListener = fn
}

/** @desc 从工程文件恢复链/阶配置（导入/加载工程时调用） */
export function setConditionProfile(profile: ConditionProfile | undefined) {
    if (profile && Array.isArray(profile.chains) && Array.isArray(profile.refinements)) {
        _conditionProfile = { chains: profile.chains, refinements: profile.refinements }
    }
}

/** @desc 设置某角色槽位的共鸣链档位 */
export function setConditionProfileChains(idx: number, value: number) {
    _conditionProfile = {
        ..._conditionProfile,
        chains: _conditionProfile.chains.map((c, j) => (j === idx ? value : c))
    }
    _profileChangeListener?.()
}

/** @desc 设置某角色槽位的武器精炼档位 */
export function setConditionProfileRefinements(idx: number, value: number) {
    _conditionProfile = {
        ..._conditionProfile,
        refinements: _conditionProfile.refinements.map((r, j) => (j === idx ? value : r))
    }
    _profileChangeListener?.()
}

/** @desc 隐藏不匹配开关的读取/切换 */
export function getHideConditionMismatch(): boolean {
    return _hideConditionMismatch
}

export function toggleHideConditionMismatch() {
    _hideConditionMismatch = !_hideConditionMismatch
}

/** @desc 按拖拽结果重排非全局 Buff 块（全局固定在最前） */
export function reorderNonGlobalBuffSets(orderedIds: string[]) {
    if (!assertUnlocked()) return
    const global = _buffSets.filter((bs) => _globalBuffSetIds.includes(bs.id))
    const nonGlobalMap = new Map(_buffSets.filter((bs) => !_globalBuffSetIds.includes(bs.id)).map((bs) => [bs.id, bs]))
    const reordered = orderedIds.map((id) => nonGlobalMap.get(id)).filter(Boolean) as BuffSet[]
    const remaining = _buffSets.filter((bs) => !_globalBuffSetIds.includes(bs.id) && !orderedIds.includes(bs.id))
    markTableDirty()
    _buffSets = [...global, ...reordered, ...remaining]
}

/** @desc ── 持久化 ── */

export function getCalcElementMap() {
    return getCharElementMap()
}

export function getGlobalBuffSetIds(): string[] {
    return _globalBuffSetIds
}

/** @desc 导出当前计算态深拷贝快照（供工程保存/导出） */
export function getCalcState(): CalcState {
    return JSON.parse(
        JSON.stringify({
            buffSets: _buffSets,
            damageEntryBuffSetIds: _damageEntryBuffSetIds,
            damageEntryDamageTypes: _damageEntryDamageTypes
        })
    )
}

/** @desc 通知宿主持久化当前计算态（AI 工具修改后调用） */
export function notifyCalcUpdate() {
    markTableDirty()
    if (_onupdate) {
        _updateInFlight = true
        _onupdate(getCalcState())
    }
}

/** @desc 伤害条目被复制/拆分后，按旧 id→新 id 映射重绑 buff 与伤害类型（key 前缀匹配） */
export function remapDuplicatedDamageBuffs(damageMap: Record<string, string>) {
    const pairs = Object.entries(damageMap).filter(([, newId]) => Boolean(newId))
    if (pairs.length === 0) return

    const remapTable = <T>(table: Record<string, T>): Record<string, T> => {
        const next: Record<string, T> = { ...table }
        for (const [oldId, newId] of pairs) {
            for (const [key, value] of Object.entries(table)) {
                if (!key.startsWith(oldId + '-')) continue
                next[newId + key.slice(oldId.length)] = value
            }
        }
        return next
    }

    markTableDirty()
    _damageEntryBuffSetIds = remapTable(_damageEntryBuffSetIds)
    _damageEntryDamageTypes = remapTable(_damageEntryDamageTypes)
    rebindGlobalBuffs()
    if (_onupdate) {
        _updateInFlight = true
        _onupdate(getCalcState())
    }
}

/** @desc 重建全局 buff 绑定：把每个标记为 global 的 buff 按作用域挂到所有适用条目上。
 *  工程不再自动创建「默认全局 buff」（原 global-{角色名} / global-all 空块已由 migration 清除），
 *  全局 buff 完全由用户按需并入。 */
export function rebindGlobalBuffs() {
    if (_globalBuffSetIds.length === 0) return

    const globalIdSet = new Set(_globalBuffSetIds)
    // 先清空所有全局 buff 的旧绑定，再按作用域规则重建（避免残留过期绑定）
    const newBindings: Record<string, string[]> = {}
    for (const entryId of Object.keys(_damageEntryBuffSetIds)) {
        const filtered = (_damageEntryBuffSetIds[entryId] ?? []).filter((sid) => !globalIdSet.has(sid))
        if (filtered.length > 0) newBindings[entryId] = filtered
    }

    const charIdxByName = new Map<string, number>()
    for (const [i, s] of (_initTeam ?? []).entries()) {
        if (s.character) charIdxByName.set(s.character, i)
    }
    const globalBuffs = _buffSets.filter((bs) => globalIdSet.has(bs.id))

    for (const entry of _entries) {
        const entryCharIdx = entry.character ? charIdxByName.get(entry.character) : undefined
        const applicable: string[] = []
        for (const gb of globalBuffs) {
            if (gb.scope === 'all') {
                applicable.push(gb.id)
            } else if (Array.isArray(gb.scope)) {
                if (gb.scope.length === 0) {
                    if (entry.isEffect) applicable.push(gb.id)
                } else if (entryCharIdx !== undefined && gb.scope.includes(entryCharIdx)) {
                    applicable.push(gb.id)
                }
            }
        }
        if (applicable.length === 0) continue
        const current = newBindings[entry.id] ?? []
        newBindings[entry.id] = [...new Set([...current, ...applicable])]
    }

    _damageEntryBuffSetIds = newBindings
}
