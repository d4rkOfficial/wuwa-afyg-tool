/** @desc 拉表页状态 store：持有伤害条目/Buff 块/条目绑定/生效配置等全局响应式状态，提供 CRUD 与持久化快照接口 */
import type { BuffSet, BuffZoneValue, CalcState, DamageEntry, BuffCondition } from './calculation.types'
import type { TimelineData } from './timeline.types'
import type { CharSlot } from '$lib/types/project'
import { parseValueString } from '$lib/utils/parse-value-string'
import { NON_DIRECT_ELEMENT } from './timeline.consts'
import { getSkillCache } from './timeline.store.svelte'
import { getCharElementMap, ensureCharElements } from '$lib/data/char-elements.svelte'
import { addToast } from '$lib/data/toast.svelte'
import { ZONE_MAP, ZONE_REF_MAP } from './calculation.consts'
import type { ConditionProfile } from './compute'

let _entries = $state<DamageEntry[]>([])
let _buffSets = $state<BuffSet[]>([])
let _damageEntryBuffSetIds = $state<Record<string, string[]>>({})
let _damageEntryDamageTypes = $state<Record<string, string[]>>({})
let _showBuffModal = $state(false)
let _buffDiffMode = $state(false)
let _locked = $state(false)
/** @desc 全局生效配置：各角色共鸣链 / 武器精炼阶数（结果计算与条件过滤共用） */
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

/** @desc 初始化/重建整个 store：写入队伍与时间线、加载保存态（过滤[配置]自动块）、重建伤害条目、同步全局 buff；返回前清理孤儿绑定 */
/** @desc 上次 init 的轻量指纹（数据未变时幂等短路，避免勾选回写触发全量重建） */
let _lastInitKey = ''

function initKey(
    team: [CharSlot, CharSlot, CharSlot],
    timelineData: TimelineData | null,
    savedState: CalcState | null,
    locked: boolean
): string {
    const tl = timelineData
    const tlFp = tl
        ? `${tl.refLines.length}:${tl.refLines[0]?.id ?? ''}:${tl.refLines[tl.refLines.length - 1]?.id ?? ''}|${tl.opBlocks.length}:${tl.opBlocks[0]?.id ?? ''}:${tl.opBlocks[tl.opBlocks.length - 1]?.id ?? ''}|${tl.damageBlocks.length}:${tl.damageBlocks[0]?.id ?? ''}:${tl.damageBlocks[tl.damageBlocks.length - 1]?.id ?? ''}`
        : 'null'
    const st = savedState ? JSON.stringify(savedState) : null
    const stFp = st ?? 'null'
    const teamFp = team.map((s) => `${s.character ?? ''}|${s.weapon ?? ''}`).join(',')
    return `${teamFp}|${tlFp}|${stFp}|${locked}`
}

export function init(
    team: [CharSlot, CharSlot, CharSlot],
    timelineData: TimelineData | null,
    savedState: CalcState | null,
    locked = false,
    onupdate?: (state: CalcState) => void
) {
    _locked = locked
    _onupdate = onupdate
    const key = initKey(team, timelineData, savedState, locked)
    if (key === _lastInitKey) {
        // 幂等短路：数据未变（如 onupdate 回写自证），仅更新回调引用，跳过全量重建
        _initTeam = team
        _initTimelineData = timelineData
        return
    }
    _lastInitKey = key
    _initTeam = team
    _initTimelineData = timelineData

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
        // 一次深拷贝导出三个子集，避免对保存态反复 JSON 序列化
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
    _globalBuffSetIds = _buffSets.filter((bs) => bs.global || bs.id.startsWith('global-')).map((bs) => bs.id)
    syncGlobalBuffs(team.map((s) => s.character))
    if (pruneOrphanedBindings()) {
        if (_onupdate) _onupdate(getCalcState())
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

/** @desc 新建空 Buff 块（随机 id，默认全队作用域），返回新块 id */
export function createBuffSet(name: string): string | undefined {
    if (!assertUnlocked()) return undefined
    const buffSet: BuffSet = {
        id: `buffSet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        zones: [],
        scope: 'all'
    }
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
            if (z.ref && ZONE_REF_MAP.has(z.ref.targetZoneId as never)) {
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
        const buffSet: BuffSet = {
            id: `buffSet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name,
            zones,
            scope: mapImportedScope(item.scope, item.ownerIdx ?? ownerIdx, teamSize),
            ...(item.condition ? { condition: { ...item.condition } } : {}),
            ...(item.condition && (item.ownerIdx ?? ownerIdx) >= 0
                ? { conditionRefCharIdx: item.ownerIdx ?? ownerIdx }
                : {})
        }
        fresh.push(buffSet)
    }
    if (!fresh.length) return 0
    // 导入前按条目名自然排序：数字段按数值（1层 < 2层 < 10层 < 11层），其余按 unicode 码点
    fresh.sort((a, b) => compareNatural(a.name, b.name))
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
    _buffSets = next
    return newId
}

/** @desc 设置 Buff 作用域（全局 buff 不允许改） */
export function setBuffSetScope(setId: string, scope: 'all' | number[]) {
    if (!assertUnlocked()) return
    if (_globalBuffSetIds.includes(setId)) return
    _buffSets = _buffSets.map((s) => (s.id === setId ? { ...s, scope } : s))
}

/** @desc 设置生效条件（默认全局 buff 不允许设链/阶条件） */
export function setBuffSetCondition(setId: string, condition: BuffCondition | null) {
    if (!assertUnlocked()) return
    // 默认全局 buff 不允许设置共鸣链/精炼条件
    if (setId.startsWith('global-')) return
    _buffSets = _buffSets.map((s) =>
        s.id === setId ? { ...s, ...(condition ? { condition } : { condition: undefined }) } : s
    )
}

/** @desc 设置条件参考角色槽位（默认全局 buff 不允许设） */
export function setBuffSetConditionRef(setId: string, charIdx: number | null) {
    if (!assertUnlocked()) return
    // 默认全局 buff 不允许设置共鸣链/精炼条件
    if (setId.startsWith('global-')) return
    _buffSets = _buffSets.map((s) =>
        s.id === setId
            ? { ...s, ...(charIdx !== null ? { conditionRefCharIdx: charIdx } : { conditionRefCharIdx: undefined }) }
            : s
    )
}

/** @desc 设置某乘区的引用（存在引用时清除 override 标记） */
export function setBuffSetZoneRef(setId: string, zoneId: string, ref: import('./calculation.types').ZoneRef | null) {
    if (!assertUnlocked()) return
    _buffSets = _buffSets.map((s) =>
        s.id === setId
            ? {
                  ...s,
                  zones: s.zones.map((z) =>
                      z.zoneId === zoneId ? { ...z, ref: ref ?? undefined, override: ref ? undefined : z.override } : z
                  )
              }
            : s
    )
}

/** @desc 切换乘区「追加/覆盖」标记（extraRatio 恒为追加；覆盖时清除引用） */
export function setBuffSetZoneOverride(setId: string, zoneId: string, override: boolean) {
    if (!assertUnlocked()) return
    const nextOverride = zoneId === 'extraRatio' ? false : override
    _buffSets = _buffSets.map((s) =>
        s.id === setId
            ? {
                  ...s,
                  zones: s.zones.map((z) =>
                      z.zoneId === (zoneId as any)
                          ? { ...z, override: nextOverride || undefined, ref: nextOverride ? undefined : z.ref }
                          : z
                  )
              }
            : s
    )
}

/** @desc 切换收藏标记 */
export function toggleBuffSetStarred(id: string) {
    if (!assertUnlocked()) return
    _buffSets = _buffSets.map((s) => (s.id === id ? { ...s, starred: !s.starred } : s))
}

/** @desc 并入/移出全局：并入时清理该 buff 在全部条目上的绑定并加入全局列表，随后重建全局自动绑定 */
export function setBuffSetGlobal(id: string, global: boolean): boolean {
    if (!assertUnlocked()) return false
    // 默认全队/个人全局 buff 不可移出全局
    if (id.startsWith('global-')) return false
    const bs = _buffSets.find((s) => s.id === id)
    if (!bs) return false
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

    syncGlobalBuffs((_initTeam ?? []).map((s) => s.character))
    if (_onupdate) _onupdate(getCalcState())
    return true
}

/** @desc 删除 Buff 块（全局 buff 不可删），同时清理所有条目上的绑定 */
export function deleteBuffSet(id: string) {
    if (!assertUnlocked()) return
    if (_globalBuffSetIds.includes(id)) return
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
    syncGlobalBuffs((_initTeam ?? []).map((s) => s.character))
    if (_onupdate) _onupdate(getCalcState())
    return true
}

/** @desc 重命名 Buff 块 */
export function renameBuffSet(id: string, name: string) {
    if (!assertUnlocked()) return
    _buffSets = _buffSets.map((s) => (s.id === id ? { ...s, name } : s))
}

/** @desc 给 Buff 块新增一个乘区（默认值 0） */
export function addZoneToBuffSet(setId: string, zoneId: string) {
    if (!assertUnlocked()) return
    _buffSets = _buffSets.map((s) =>
        s.id === setId ? { ...s, zones: [...s.zones, { zoneId: zoneId as any, value: 0 } as BuffZoneValue] } : s
    )
}

/** @desc 从 Buff 块移除一个乘区 */
export function removeZoneFromBuffSet(setId: string, zoneId: string) {
    if (!assertUnlocked()) return
    _buffSets = _buffSets.map((s) =>
        s.id === setId ? { ...s, zones: s.zones.filter((z) => z.zoneId !== (zoneId as any)) } : s
    )
}

/** @desc 设置某乘区的数值（$state 深代理原地修改，避免整数组替换触发无关重建） */
export function setBuffSetZoneValue(setId: string, zoneId: string, value: number) {
    if (!assertUnlocked()) return
    const bs = _buffSets.find((s) => s.id === setId)
    if (!bs) return
    const zone = bs.zones.find((z) => z.zoneId === (zoneId as any))
    if (zone) zone.value = value
}

/** @desc ── Entry-BuffSet 绑定 ── */

export function getBuffSetIdsForEntry(entryId: string): string[] {
    return _damageEntryBuffSetIds[entryId] ?? []
}

/** @desc 覆写条目绑定的 Buff 集合（框选/行列头批量用） */
export function setBuffSetIdsForEntry(entryId: string, setIds: string[]): boolean {
    if (!assertUnlocked()) return false
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
    _damageEntryBuffSetIds = next
    return true
}

/** @desc 切换条目↔Buff 的单条绑定 */
export function toggleBuffSetForEntry(entryId: string, setId: string) {
    if (!assertUnlocked()) return
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
    const current = _damageEntryDamageTypes[entryId] ?? []
    if (current.includes(damageType)) {
        _damageEntryDamageTypes = { ..._damageEntryDamageTypes, [entryId]: current.filter((t) => t !== damageType) }
    } else {
        _damageEntryDamageTypes = { ..._damageEntryDamageTypes, [entryId]: [...current, damageType] }
    }
}

/** @desc 覆写条目的伤害类型集合（复制到下段直伤等用） */
export function setDamageTypesForEntry(entryId: string, types: string[]) {
    _damageEntryDamageTypes = { ..._damageEntryDamageTypes, [entryId]: types }
}

/** @desc ── Buff 弹窗开关 ── */

export function getShowBuffModal(): boolean {
    return _showBuffModal
}
export function setShowBuffModal(v: boolean) {
    _showBuffModal = v
}

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
    if (_onupdate) _onupdate(getCalcState())
}

/** @desc 伤害条目被复制/拆分后，按旧 id→新 id 映射重绑 buff 与伤害类型（key 前缀匹配） */
export function remapDuplicatedDamageBuffs(damageMap: Record<string, string>) {
    const pairs = Object.entries(damageMap).filter(([, newId]) => Boolean(newId))
    if (pairs.length === 0) return

    const remapTable = (table: Record<string, string[]>): Record<string, string[]> => {
        const next: Record<string, string[]> = { ...table }
        for (const [oldId, newId] of pairs) {
            for (const [key, value] of Object.entries(table)) {
                if (!key.startsWith(oldId + '-')) continue
                const newKey = newId + key.slice(oldId.length)
                const existing = next[newKey]
                next[newKey] = existing ? [...new Set([...existing, ...value])] : [...value]
            }
        }
        return next
    }

    _damageEntryBuffSetIds = remapTable(_damageEntryBuffSetIds)
    _damageEntryDamageTypes = remapTable(_damageEntryDamageTypes)
    syncGlobalBuffs((_initTeam ?? []).map((s) => s.character))
    if (_onupdate) _onupdate(getCalcState())
}

/** @desc 同步全局 buff：清除无主角色的 global-{角色名} 孤儿块、按当前队伍补齐每个角色与全队的全局块，并按「角色/全队/效应专属/手动并入」规则重建所有条目上的全局绑定 */
export function syncGlobalBuffs(charNames: (string | null)[]) {
    const validCharNames = new Set(charNames.filter(Boolean) as string[])

    const orphanIds = _globalBuffSetIds.filter((id) => {
        if (id === 'global-all') return false
        if (!id.startsWith('global-')) return false
        const charName = id.slice('global-'.length)
        return !validCharNames.has(charName)
    })
    let newBuffSets = _buffSets.slice()
    let newBindings = { ..._damageEntryBuffSetIds }
    let newGlobalIds = _globalBuffSetIds.slice()

    if (orphanIds.length > 0) {
        newBuffSets = newBuffSets.filter((bs) => !orphanIds.includes(bs.id))
        const nextBindings: Record<string, string[]> = {}
        for (const [entryId, setIds] of Object.entries(newBindings)) {
            const filtered = setIds.filter((sid) => !orphanIds.includes(sid))
            if (filtered.length > 0) nextBindings[entryId] = filtered
        }
        newBindings = nextBindings
        newGlobalIds = newGlobalIds.filter((id) => !orphanIds.includes(id))
    }

    for (let i = 0; i < 3; i++) {
        const charName = charNames[i]
        if (!charName) continue
        const id = `global-${charName}`

        if (newBuffSets.some((bs) => bs.id === id)) {
            if (!newGlobalIds.includes(id)) {
                newGlobalIds = [...newGlobalIds, id]
            }
            continue
        }

        newBuffSets = [
            ...newBuffSets,
            {
                id,
                name: `${charName}·全局`,
                zones: [],
                scope: [i],
                global: true
            }
        ]
        if (!newGlobalIds.includes(id)) {
            newGlobalIds = [...newGlobalIds, id]
        }
    }

    const TEAM_GLOBAL_ID = 'global-all'
    if (validCharNames.size > 0) {
        if (!newBuffSets.some((bs) => bs.id === TEAM_GLOBAL_ID)) {
            newBuffSets = [
                ...newBuffSets,
                { id: TEAM_GLOBAL_ID, name: '全队·全局', zones: [], scope: 'all', global: true }
            ]
        }
        if (!newGlobalIds.includes(TEAM_GLOBAL_ID)) {
            newGlobalIds = [...newGlobalIds, TEAM_GLOBAL_ID]
        }
    }

    // 先清空所有全局 buff 的旧绑定，再按适用规则重建
    const globalIdSet = new Set(newGlobalIds)
    for (const entryId of Object.keys(newBindings)) {
        newBindings[entryId] = newBindings[entryId].filter((sid) => !globalIdSet.has(sid))
    }
    const charIdxByName = new Map<string, number>()
    for (const [i, s] of (_initTeam ?? []).entries()) {
        if (s.character) charIdxByName.set(s.character, i)
    }
    const mergedGlobalBuffs = _buffSets.filter((bs) => newGlobalIds.includes(bs.id) && !bs.id.startsWith('global-'))
    for (const entry of _entries) {
        const entryCharIdx = entry.character ? charIdxByName.get(entry.character) : undefined
        const applicable: string[] = []
        if (entry.character) {
            if (newGlobalIds.includes(`global-${entry.character}`)) applicable.push(`global-${entry.character}`)
            if (newGlobalIds.includes(TEAM_GLOBAL_ID)) applicable.push(TEAM_GLOBAL_ID)
        }
        for (const mg of mergedGlobalBuffs) {
            if (mg.scope === 'all') {
                applicable.push(mg.id)
            } else if (Array.isArray(mg.scope)) {
                if (mg.scope.length === 0) {
                    if (entry.isEffect) applicable.push(mg.id)
                } else if (entryCharIdx !== undefined && mg.scope.includes(entryCharIdx)) {
                    applicable.push(mg.id)
                }
            }
        }
        for (const gid of applicable) {
            const current = newBindings[entry.id] ?? []
            if (!current.includes(gid)) newBindings[entry.id] = [...current, gid]
        }
    }

    _buffSets = newBuffSets
    _damageEntryBuffSetIds = newBindings
    _globalBuffSetIds = newGlobalIds
}
