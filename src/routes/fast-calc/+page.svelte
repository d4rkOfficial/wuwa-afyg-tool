<script lang="ts">
    /**
     * @desc fast-calc：独立页。工程来源有两种：
     *  - `?import_project=<工程 JSON 地址>`（浏览器 / 普通 iframe）；
     *  - 宿主在 `fast-calc:ready` 后发送 `{ type: 'fast-calc:load', project }`
     *    （wuwacalc-conv 报告页的本地重算走这条路径）。
     *  页面上半部是角色 / 敌怪编辑，下半部是计算结果表格；计算全部走 `$lib/calc` 引擎，
     *  乘区列由 `ResultEntry.multiplierZones` 动态得出（引擎新增乘区会自动出现，页面不写死乘区清单）。
     *  计算完成后按旧协议回传 `fast-calc:result`，供 conv 报告页对齐逐技能差异。
     *
     *  postMessage 协议（父窗口 → 本页）：
     *  - `{ type:'fast-calc:load', project }` 或纯字符串 / `{version, project}`：载入工程
     *  - `{ type:'fast-calc:update', target, action, ... }`：修改并回传工程
     *    target=chain/refinement：`{ index, value }`（只支持 set）
     *    target=mainStat：`{ charIndex, slotIndex, action:'set'|'remove', label? }`
     *    target=substat：`{ charIndex, slotIndex, action:'add'|'update'|'remove', index?, label?, value? }`
     *    target=enemy：`{ action:'set', patch:{ type?, level?, defense?, dmgReduction?, resistances? } }`（无增删）
     *    target=timing：`{ action:'add'|'update'|'remove', refLineId, seconds? }`
     *  - `{ type:'fast-calc:request-detail', requestId? }`：取回 `fast-calc:detail`（表头 + 逐条目 + 乘区溯源）
     *  - `{ type:'fast-calc:request-state', requestId? }`：取回 `fast-calc:state`（链/阶、词条配置、敌怪、记点）
     *  本页 → 父窗口：`ready` / `project-loaded` / `project-updated` / `result` / `update-ack` / `detail` / `state`
     */
    import { onDestroy, onMount } from 'svelte'
    import { getCharacterInfo, getWeaponInfo, setApiBase } from '$lib/api/data-cache'
    import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
    import { computeAll } from '$lib/calc/compute'
    import {
        buildDamageSegments,
        type DamageSegments,
        type DamageTraceCtx,
        type TracePart
    } from '$lib/calc/damage-trace'
    import { getAllDamageEntries, getCalcState, init as initCalculation } from '$lib/calc/calculation.store.svelte'
    import type { CalcState } from '$lib/calc/calculation.types'
    import { enemyDefenseForLevel } from '$lib/calc/config.consts'
    import type { ConfigState, EchoSlotConfig } from '$lib/calc/config.types'
    import type { ResultEntry } from '$lib/calc/result.types'
    import type { TimelineData } from '$lib/calc/timeline.types'
    import { ensureSkillCache } from '$lib/calc/timeline.store.svelte'
    import { ensureEchoSkillText } from '$lib/data/char-info.svelte'
    import { ensureCharElements } from '$lib/data/char-elements.svelte'
    import type { CharSlot } from '$lib/types/project'
    import { ELEMENTS, ENEMY_TYPES, CHAIN_MAX, REFINE_MAX, type EnemyType } from '$lib/consts/game-terms'
    import { SUBSTAT_OPTIONS } from '$lib/consts/stat-data'
    import { hideSplash } from '$lib/utils/splash'
    import type { FastCalcTiming, LoadedProject, SegmentView } from './types'
    import type { TimelineLike } from './utils'
    import {
        SUBSTAT_LIMIT,
        applyEdits,
        availableSubstatLabels,
        calculationOf,
        chainsOf,
        defaultSubstat,
        formatEchoStat,
        initialConfig,
        mainStatFromOption,
        mainStatOptions,
        readProjectFile,
        refinementsOf,
        segmentsOf,
        timingsOf,
        timelineOf,
        zoneColumnsOf,
        zoneValueOf
    } from './utils'

    const CHAIN_OPTIONS = Array.from({ length: CHAIN_MAX + 1 }, (_, index) => index)
    const REFINE_OPTIONS = Array.from({ length: REFINE_MAX + 1 }, (_, index) => index)

    /** @desc 静态页 / 跨域 iframe 里同源没有 /api，退回工具箱主站的公开数据接口 */
    const FALLBACK_API_BASE = 'https://wuwa-afyg-tool.200503.xyz'

    /**
     * @desc 解析数据接口基址：
     *  - `?api_base=` 或宿主注入的 `window.__FAST_CALC_API_BASE__` 优先；
     *  - 否则先探测同源 `/api/v1/version/latest`，失败再退回主站。
     *  这样浏览器同源打开时零配置，静态/iframe 部署时也不需要宿主额外代理。
     */
    const resolveApiBase = async () => {
        const explicit =
            new URLSearchParams(location.search).get('api_base') ??
            (window as unknown as Record<string, unknown>).__FAST_CALC_API_BASE__ ??
            ''
        if (typeof explicit === 'string' && explicit) {
            setApiBase(explicit)
            return
        }
        try {
            const response = await fetch('/api/v1/version/latest', { cache: 'no-store' })
            if (response.ok) {
                await response.json()
                return
            }
        } catch {
            /* 同源没有接口：落到主站 */
        }
        setApiBase(FALLBACK_API_BASE)
    }

    let loaded = $state<LoadedProject | null>(null)
    let config = $state<ConfigState | null>(null)
    let chains = $state<number[]>([])
    let refinements = $state<number[]>([])
    let timings = $state<FastCalcTiming[]>([])
    let segments = $state<SegmentView[]>([])
    let error = $state('')
    let loading = $state(false)
    /** @desc 溯源上下文（与最近一次计算同源；展开行时用它还原乘区组成） */
    let traceCtx = $state<DamageTraceCtx | null>(null)
    let lastComputeMs = 0
    /** @desc 引擎原始结果（乘区手工覆盖以它为基础重算本行） */
    let baseResults = $state<ResultEntry[]>([])
    /** @desc 手工乘区覆盖：条目 id → 乘区名 → 乘数值 */
    let zoneOverrides = $state<Record<string, Record<string, number>>>({})

    let project = $derived(loaded?.project ?? null)

    /** @desc 角色/武器数据（引擎入参；不参与页面渲染，故不用 `$state`） */
    let charInfoMap: Record<string, CharacterInfo> = {}
    let weaponInfoMap: Record<string, WeaponInfo> = {}

    const characterName = (index: number): string => project?.team[index]?.character || `角色 ${index + 1}`

    const echoName = (charIndex: number, slotIndex: number): string =>
        project?.team[charIndex]?.echoes?.[slotIndex]?.name || ''

    const slotOf = (charIndex: number, slotIndex: number): EchoSlotConfig | undefined =>
        config?.characters[charIndex]?.echoes[slotIndex]

    const emitProject = () => {
        if (!loaded || !config) return
        const root = applyEdits(loaded, config, chains, refinements, timings)
        const payload = JSON.parse(
            JSON.stringify({ type: 'fast-calc:project-updated', name: project?.name ?? '', project: root })
        ) as { type: string; name: string; project: unknown }
        parent.postMessage(payload, '*')
        ;(window as unknown as Record<string, unknown>).__FAST_CALC_PROJECT__ = payload.project
    }

    /**
     * @desc 兼容 wuwacalc-conv 报告页：它按 `fast-calc:result` 的逐条目 / 时段结构对齐计算差异。
     *  这里只做 ResultEntry → 报告字段的映射，乘区清单仍来自引擎结果；协议字段是双方约定，勿随意改名。
     */
    const postResult = (computed: ResultEntry[], computeMs: number, segmentList: SegmentView[]) => {
        if (!project) return
        const blocks = (timelineOf(project)?.damageBlocks ?? []) as NonNullable<TimelineLike['damageBlocks']>
        const blockById = new Map(blocks.map((block) => [block.id, block]))
        const catalogOf = (result: ResultEntry): string | null => {
            const byId = blockById.get(result.id.split('-')[0])
            const bySource =
                blockById.get(result.sourceTimelineBlockId) ??
                blocks.find((block) => block.sourceId === result.sourceTimelineBlockId)
            const block = byId ?? bySource
            const catalogId = block?.skillHits?.find((hit) => hit.catalogId)?.catalogId
            return catalogId ? String(catalogId) : null
        }
        const reportEntry = (result: ResultEntry) => ({
            id: result.id,
            blockId: result.sourceTimelineBlockId,
            catalogId: catalogOf(result),
            character: result.character,
            name: result.displayName,
            damage: result.totalDamage,
            hits: result.hits,
            fixed: result.baseUnit === '固定',
            zones: {
                baseMult: result.ratioNum * result.hits,
                dmgBonus: 1 + result.dmgBonus,
                deepen: 1 + result.deepen,
                vulnerability: 1 + result.vulnerability,
                resistance: result.resMulti,
                defense: result.defMulti,
                critRate: result.critRate * 100,
                critDmg: result.critDmg * 100,
                critExpect: 1 + result.critRate * (result.critDmg - 1),
                multBoost: result.customMult,
                multAdd: result.extraRatio || 0,
                attack: result.totalAtk,
                hp: result.totalHp,
                def: result.totalDef
            }
        })
        const total = computed.reduce((sum, entry) => sum + entry.totalDamage, 0)
        const duration = segmentList.length ? segmentList[segmentList.length - 1].end : 0
        const payload = JSON.parse(
            JSON.stringify({
                type: 'fast-calc:result',
                total,
                duration,
                computeMs,
                entries: computed.map(reportEntry),
                segments: segmentList.map((segment) => ({
                    time: segment.time,
                    start: segment.start,
                    end: segment.end,
                    total: segment.total,
                    dps: segment.dps,
                    entries: segment.entries.map(reportEntry)
                }))
            })
        ) as Record<string, unknown>
        parent.postMessage(payload, '*')
        ;(window as unknown as Record<string, unknown>).__FAST_CALC_RESULT__ = payload
    }

    const makeTraceCtx = (): DamageTraceCtx | null => {
        if (!project || !config) return null
        const calc = getCalcState()
        return {
            buffSets: calc.buffSets,
            damageEntryBuffSetIds: calc.damageEntryBuffSetIds,
            damageEntryDamageTypes: calc.damageEntryDamageTypes,
            configState: config,
            team: project.team,
            charInfoMap,
            weaponInfoMap,
            conditionProfile: { chains: [...chains], refinements: [...refinements] }
        }
    }

    const ensureInfos = async (team: CharSlot[], extraCharacters: string[] = []) => {
        const names = new Set(extraCharacters.filter((name): name is string => !!name))
        for (const slot of team) if (slot.character) names.add(slot.character)
        await Promise.all(
            [...names].map(async (name) => {
                if (!charInfoMap[name]) {
                    const info = await getCharacterInfo(name).catch(() => null)
                    if (info) charInfoMap[name] = info
                }
            })
        )
        await Promise.all(
            team.map(async (slot) => {
                if (slot.weapon && !weaponInfoMap[slot.weapon]) {
                    const info = await getWeaponInfo(slot.weapon).catch(() => null)
                    if (info) weaponInfoMap[slot.weapon] = info
                }
            })
        )
    }

    const buildSegments = (entries: ResultEntry[]): SegmentView[] => {
        if (!project) return []
        const split = segmentsOf(entries, timings, project)
        const total = entries.reduce((sum, entry) => sum + entry.totalDamage, 0)
        return split.length
            ? split
            : entries.length
              ? [
                    {
                        key: 'all',
                        time: '全部',
                        start: 0,
                        end: 0,
                        total,
                        dps: 0,
                        seconds: 0,
                        entries
                    }
                ]
              : []
    }

    /** @desc 乘区手工覆盖 → 按「新值 / 原值」等比缩放本行伤害；不改引擎原始结果 */
    const applyOverrides = (entries: ResultEntry[]): ResultEntry[] =>
        entries.map((entry) => {
            const row = zoneOverrides[entry.id]
            if (!row) return entry
            let factor = 1
            let changed = false
            const zones = entry.multiplierZones.map((zone) => {
                const next = row[zone.label]
                if (next === undefined) return zone
                changed = true
                if (zone.value !== 0) factor *= next / zone.value
                return { ...zone, value: next }
            })
            if (!changed) return entry
            return {
                ...entry,
                multiplierZones: zones,
                expectedPerHit: entry.expectedPerHit * factor,
                critPerHit: entry.critPerHit * factor,
                nonCritPerHit: entry.nonCritPerHit * factor,
                totalDamage: entry.totalDamage * factor,
                totalDamageRaw: entry.totalDamageRaw * factor,
                rawPerHit: entry.rawPerHit * factor
            }
        })

    const rebuildSegments = () => {
        if (!project) return
        const adjusted = applyOverrides(baseResults)
        const nextSegments = buildSegments(adjusted)
        segments = nextSegments
        postResult(adjusted, lastComputeMs, nextSegments)
    }

    const hasZoneOverride = (id: string): boolean => Object.keys(zoneOverrides[id] ?? {}).length > 0

    const setZoneOverride = (id: string, label: string, raw: string) => {
        const value = Number(raw)
        if (!Number.isFinite(value) || value < 0) return
        zoneOverrides = { ...zoneOverrides, [id]: { ...(zoneOverrides[id] ?? {}), [label]: value } }
        rebuildSegments()
    }

    const resetZoneOverride = (id: string) => {
        const next = { ...zoneOverrides }
        delete next[id]
        zoneOverrides = next
        rebuildSegments()
    }

    const recalc = async () => {
        if (!project || !config) return
        try {
            // 条目里的角色未必都还在队伍里（改过队后旧时间线仍可能有它的命中），一并取属性
            const entryCharacters = getAllDamageEntries()
                .map((entry) => entry.character)
                .filter((name): name is string => !!name)
            await ensureInfos(project.team, entryCharacters)
            const missing = [...new Set([...project.team.map((slot) => slot.character), ...entryCharacters])].filter(
                (name): name is string => !!name && !charInfoMap[name]
            )
            if (missing.length) throw new Error(`角色数据加载失败：${missing.join('、')}`)
            const calc = getCalcState()
            const computeStarted = performance.now()
            const computed = computeAll(
                getAllDamageEntries(),
                calc.buffSets,
                calc.damageEntryBuffSetIds,
                calc.damageEntryDamageTypes,
                config,
                project.team,
                charInfoMap,
                weaponInfoMap,
                { chains: [...chains], refinements: [...refinements] }
            )
            const computeMs = performance.now() - computeStarted
            baseResults = computed
            const adjusted = applyOverrides(computed)
            const nextSegments = buildSegments(adjusted)
            segments = nextSegments
            lastComputeMs = computeMs
            traceCtx = makeTraceCtx()
            error = ''
            postResult(adjusted, computeMs, nextSegments)
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
            segments = []
        }
    }

    const traceOf = (entry: ResultEntry): DamageSegments | null => {
        if (!traceCtx) return null
        try {
            return buildDamageSegments(entry, traceCtx)
        } catch {
            return null
        }
    }

    const traceDialogId = (id: string): string => `trace-${id}`

    const openTrace = (id: string) => {
        const dialog = document.getElementById(traceDialogId(id))
        if (dialog instanceof HTMLDialogElement) dialog.showModal()
    }

    const DETAIL_BASE_HEADERS = ['来源', '条目', '倍率', '命中', '期望伤害', '暴击伤害', '不暴击伤害']

    /** @desc 回传「各表头 + 逐条目 + 逐乘区溯源」的详细结果（供宿主做报告 / 对齐） */
    const postDetail = (requestId?: unknown) => {
        if (!project || !config || !traceCtx) {
            parent.postMessage({ type: 'fast-calc:detail', requestId, ok: false, error: '工程未就绪' }, '*')
            return
        }
        const allEntries = segments.flatMap((segment) => segment.entries)
        const zoneLabels = zoneColumnsOf(allEntries)
        const detailRow = (entry: ResultEntry) => ({
            id: entry.id,
            blockId: entry.sourceTimelineBlockId,
            character: entry.character,
            name: entry.displayName,
            skillType: entry.skillType,
            damageTypes: entry.damageTypes,
            element: entry.element,
            ratio: (entry.ratioNum / entry.hits) * 100,
            hits: entry.hits,
            expected: entry.expectedPerHit,
            crit: entry.canCrit ? entry.critPerHit : null,
            nonCrit: entry.nonCritPerHit,
            damage: entry.totalDamage,
            fixed: entry.baseUnit === '固定',
            zones: entry.multiplierZones.map((zone) => ({
                label: zone.label,
                value: zone.value,
                detail: zone.detail
            })),
            trace: traceOf(entry)
        })
        const payload = {
            type: 'fast-calc:detail',
            requestId,
            ok: true,
            project: { name: project.name ?? '' },
            headers: {
                base: DETAIL_BASE_HEADERS,
                zones: zoneLabels,
                columns: [...DETAIL_BASE_HEADERS, ...zoneLabels]
            },
            total: allEntries.reduce((sum, entry) => sum + entry.totalDamage, 0),
            duration: segments.length ? segments[segments.length - 1].end : 0,
            computeMs: lastComputeMs,
            segments: segments.map((segment) => ({
                key: segment.key,
                time: segment.time,
                start: segment.start,
                end: segment.end,
                total: segment.total,
                dps: segment.dps,
                seconds: segment.seconds,
                entries: segment.entries.map(detailRow)
            }))
        }
        const plain = JSON.parse(JSON.stringify(payload))
        parent.postMessage(plain, '*')
        ;(window as unknown as Record<string, unknown>).__FAST_CALC_DETAIL__ = plain
    }

    /** @desc 回传当前可编辑状态（链/阶、词条配置、敌怪、参考线记点），供宿主做「查」与回显 */
    const postState = (requestId?: unknown) => {
        if (!project || !config) {
            parent.postMessage({ type: 'fast-calc:state', requestId, ok: false, error: '工程未就绪' }, '*')
            return
        }
        const plain = JSON.parse(
            JSON.stringify({
                type: 'fast-calc:state',
                requestId,
                ok: true,
                project: { name: project.name ?? '' },
                chains: [...chains],
                refinements: [...refinements],
                config,
                timings
            })
        )
        parent.postMessage(plain, '*')
        ;(window as unknown as Record<string, unknown>).__FAST_CALC_STATE__ = plain
    }

    const postAck = (ok: boolean, target: string, action: string, extra: Record<string, unknown> = {}) => {
        parent.postMessage({ type: 'fast-calc:update-ack', target, action, ok, ...extra }, '*')
    }

    const timingLabelOf = (refLineId: string): string => {
        const round = /^round(\d+)$/.exec(refLineId)
        if (round) return `第 ${round[1]} 轮结束`
        if (refLineId === 'end') return '结束'
        const ref = (timelineOf(project!)?.refLines ?? []).find((line) => line.id === refLineId)
        return ref?.time || '参考线'
    }

    const addTiming = (refLineId: string, seconds: number | null) => {
        if (!project) throw new Error('工程未加载')
        if (!(timelineOf(project)?.refLines ?? []).some((line) => line.id === refLineId))
            throw new Error(`参考线不存在：${refLineId}`)
        if (timings.some((timing) => timing.refLineId === refLineId)) throw new Error(`记点已存在：${refLineId}`)
        timings = [...timings, { refLineId, label: timingLabelOf(refLineId), seconds }]
        afterEdit()
    }

    const updateTiming = (refLineId: string, seconds: number | null) => {
        if (!timings.some((timing) => timing.refLineId === refLineId)) throw new Error(`记点不存在：${refLineId}`)
        timings = timings.map((timing) => (timing.refLineId === refLineId ? { ...timing, seconds } : timing))
        afterEdit()
    }

    const removeTiming = (refLineId: string) => {
        if (!timings.some((timing) => timing.refLineId === refLineId)) throw new Error(`记点不存在：${refLineId}`)
        timings = timings.filter((timing) => timing.refLineId !== refLineId)
        afterEdit()
    }

    const applyEnemyPatch = (patch: Record<string, unknown>) => {
        if (!config) throw new Error('工程未加载')
        const next = { ...config.enemy }
        if (patch.type !== undefined) {
            if (typeof patch.type !== 'string' || !(ENEMY_TYPES as readonly string[]).includes(patch.type))
                throw new Error(`敌人类型非法：${String(patch.type)}`)
            next.type = patch.type as EnemyType
        }
        for (const key of ['level', 'defense', 'dmgReduction'] as const) {
            if (patch[key] === undefined) continue
            const value = Number(patch[key])
            if (!Number.isFinite(value)) throw new Error(`${key} 必须是数字`)
            next[key] = value
        }
        // 等级变化时防御强制跟随（与工具箱敌人面板同一公式）
        if (patch.level !== undefined) {
            next.level = Math.min(150, Math.max(0, next.level))
            next.defense = enemyDefenseForLevel(next.level)
        }
        if (patch.resistances !== undefined) {
            if (typeof patch.resistances !== 'object' || patch.resistances === null)
                throw new Error('resistances 必须是对象')
            const resistances = { ...next.resistances }
            for (const [element, raw] of Object.entries(patch.resistances as Record<string, unknown>)) {
                const value = Number(raw)
                if (!Number.isFinite(value)) throw new Error(`抗性 ${element} 必须是数字`)
                resistances[element] = value
            }
            next.resistances = resistances
        }
        config.enemy = next
        afterEdit()
    }

    const addSubstatByLabel = (charIndex: number, slotIndex: number, label?: string, value?: number) => {
        const slot = slotOf(charIndex, slotIndex)
        if (!slot) throw new Error('声骸槽不存在')
        if (label === undefined) {
            addSubstat(charIndex, slotIndex)
            return
        }
        const option = SUBSTAT_OPTIONS.find((item) => item.label === label)
        if (!option) throw new Error(`副词条非法：${label}`)
        if (slot.substats.some((sub) => sub.type === label)) throw new Error(`副词条已存在：${label}`)
        if (slot.substats.length >= SUBSTAT_LIMIT) throw new Error('副词条已满 5 条')
        if (value !== undefined && !Number.isFinite(value)) throw new Error('副词条数值必须是数字')
        const stat = defaultSubstat(label)
        if (value !== undefined) stat.value = value
        slot.substats = [...slot.substats, stat]
        afterEdit()
    }

    const patchSubstat = (
        charIndex: number,
        slotIndex: number,
        index: number,
        patch: { label?: string; value?: number }
    ) => {
        const slot = slotOf(charIndex, slotIndex)
        const sub = slot?.substats[index]
        if (!slot || !sub) throw new Error('副词条不存在')
        if (patch.label !== undefined && patch.label !== sub.type) {
            if (!SUBSTAT_OPTIONS.some((option) => option.label === patch.label))
                throw new Error(`副词条非法：${patch.label}`)
            if (slot.substats.some((item, i) => i !== index && item.type === patch.label))
                throw new Error(`副词条已存在：${patch.label}`)
            slot.substats[index] = defaultSubstat(patch.label)
        }
        if (patch.value !== undefined) {
            if (!Number.isFinite(patch.value)) throw new Error('副词条数值必须是数字')
            slot.substats[index].value = patch.value
        }
        afterEdit()
    }

    const removeSubstatAt = (charIndex: number, slotIndex: number, index: number) => {
        if (!slotOf(charIndex, slotIndex)?.substats[index]) throw new Error('副词条不存在')
        removeSubstat(charIndex, slotIndex, index)
    }

    const handleUpdateMessage = (message: Record<string, unknown>) => {
        const target = String(message.target ?? '')
        const action = String(message.action ?? 'set')
        try {
            if (target === 'chain' || target === 'refinement') {
                const index = Number(message.index)
                const value = Number(message.value)
                if (!Number.isInteger(index) || index < 0 || index >= (project?.team.length ?? 0))
                    throw new Error('角色序号非法')
                const max = target === 'chain' ? CHAIN_MAX : REFINE_MAX
                if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`${target} 取值非法`)
                if (target === 'chain') setChain(index, value)
                else setRefinement(index, value)
            } else if (target === 'enemy') {
                if (action !== 'set') throw new Error('敌人配置只支持 set')
                if (typeof message.patch !== 'object' || message.patch === null) throw new Error('缺少 patch')
                applyEnemyPatch(message.patch as Record<string, unknown>)
            } else if (target === 'mainStat') {
                const charIndex = Number(message.charIndex)
                const slotIndex = Number(message.slotIndex)
                if (!Number.isInteger(charIndex) || !Number.isInteger(slotIndex)) throw new Error('声骸槽序号非法')
                const slot = slotOf(charIndex, slotIndex)
                if (!slot) throw new Error('声骸槽不存在')
                if (action === 'remove' || message.label === null || message.label === '') {
                    setMainStat(charIndex, slotIndex, '')
                } else if (action === 'set' || action === 'update') {
                    const label = String(message.label ?? '')
                    if (!mainStatOptions(slot.cost).some((option) => option.label === label))
                        throw new Error(`主词条非法：${label}`)
                    setMainStat(charIndex, slotIndex, label)
                } else {
                    throw new Error(`主词条不支持的操作：${action}`)
                }
            } else if (target === 'substat') {
                const charIndex = Number(message.charIndex)
                const slotIndex = Number(message.slotIndex)
                if (!Number.isInteger(charIndex) || !Number.isInteger(slotIndex)) throw new Error('声骸槽序号非法')
                if (action === 'add') {
                    addSubstatByLabel(
                        charIndex,
                        slotIndex,
                        typeof message.label === 'string' ? message.label : undefined,
                        message.value !== undefined ? Number(message.value) : undefined
                    )
                } else if (action === 'update') {
                    const index = Number(message.index)
                    if (!Number.isInteger(index)) throw new Error('副词条序号非法')
                    patchSubstat(charIndex, slotIndex, index, {
                        ...(typeof message.label === 'string' ? { label: message.label } : {}),
                        ...(message.value !== undefined ? { value: Number(message.value) } : {})
                    })
                } else if (action === 'remove') {
                    const index = Number(message.index)
                    if (!Number.isInteger(index)) throw new Error('副词条序号非法')
                    removeSubstatAt(charIndex, slotIndex, index)
                } else {
                    throw new Error(`副词条不支持的操作：${action}`)
                }
            } else if (target === 'timing') {
                const refLineId = String(message.refLineId ?? '')
                if (!refLineId) throw new Error('缺少 refLineId')
                const rawSeconds = message.seconds
                const seconds =
                    rawSeconds === null || rawSeconds === undefined || rawSeconds === '' ? null : Number(rawSeconds)
                if (seconds !== null && !Number.isFinite(seconds)) throw new Error('seconds 必须是数字或 null')
                if (action === 'add') addTiming(refLineId, seconds)
                else if (action === 'update') updateTiming(refLineId, seconds)
                else if (action === 'remove') removeTiming(refLineId)
                else throw new Error(`记点不支持的操作：${action}`)
            } else {
                throw new Error(`未知的更新目标：${target}`)
            }
            postAck(true, target, action)
        } catch (cause) {
            const errorMessage = cause instanceof Error ? cause.message : String(cause)
            error = errorMessage
            postAck(false, target, action, { error: errorMessage })
        }
    }

    const afterEdit = () => {
        emitProject()
        void recalc()
    }

    const prepareData = async (team: CharSlot[]) => {
        const names = team.map((slot) => slot.character).filter((name): name is string => !!name)
        // 角色属性是伤害的基数，必须先拿到；元素图 / 技能表 / 声骸文案只影响元素与伤害类型，后台补齐后重算
        await ensureInfos(team)
        void ensureCharElements(names).then(() => {
            if (loaded) void recalc()
        })
        void ensureSkillCache(names).then(() => {
            if (loaded) void recalc()
        })
        for (const slot of team) {
            for (const echo of slot.echoes) {
                if (echo.name) void ensureEchoSkillText(echo.name).catch(() => {})
            }
        }
    }

    const applyProject = async (file: LoadedProject) => {
        clearWaitTimer()
        zoneOverrides = {}
        baseResults = []
        charInfoMap = {}
        weaponInfoMap = {}
        // 角色数据先行：编辑器一旦可见就允许改动，避免「先渲染、后补数据」窗口里算出一版 0
        await prepareData(file.project.team)
        initCalculation(
            file.project.team as [CharSlot, CharSlot, CharSlot],
            timelineOf(file.project) as TimelineData | null,
            calculationOf(file.project) as CalcState | null,
            false
        )
        chains = chainsOf(file.project)
        refinements = refinementsOf(file.project)
        config = initialConfig(file.project)
        timings = timingsOf(file.project)
        loaded = file
        await recalc()
        parent.postMessage({ type: 'fast-calc:project-loaded', name: file.project.name ?? '' }, '*')
        emitProject()
    }

    /** @desc 从 `?import_project=` 拉取工程 */
    const loadFromUrl = async (url: string) => {
        loading = true
        error = ''
        try {
            await resolveApiBase()
            const response = await fetch(url, { cache: 'no-store' })
            if (!response.ok) throw new Error(`工程下载失败：HTTP ${response.status}`)
            await applyProject(readProjectFile(await response.text()))
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        } finally {
            loading = false
        }
    }

    /**
     * @desc 兼容宿主 / wuwacalc-conv 报告页：旧协议在 `fast-calc:ready` 后发送
     *  `{ type: 'fast-calc:load', project }`（也接受纯字符串 / `{version, project}`）。
     */
    const loadPosted = async (data: unknown) => {
        if (!data) return
        const raw =
            typeof data === 'object' && data !== null && 'project' in data
                ? (data as { project: unknown }).project
                : data
        loading = true
        error = ''
        try {
            await resolveApiBase()
            await applyProject(readProjectFile(typeof raw === 'string' ? raw : JSON.stringify(raw)))
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        } finally {
            loading = false
        }
    }

    const onMessage = (event: MessageEvent) => {
        const data = event.data
        if (!data) return
        if (typeof data === 'string') {
            void loadPosted(data)
            return
        }
        if (typeof data === 'object' && data !== null) {
            const message = data as { type?: string; project?: unknown; version?: unknown }
            if ((message.type === 'fast-calc:load' || message.version !== undefined) && message.project) {
                void loadPosted(message.project)
                return
            }
            if (message.type === 'fast-calc:update') {
                handleUpdateMessage(message as Record<string, unknown>)
                return
            }
            if (message.type === 'fast-calc:request-detail') {
                postDetail((message as { requestId?: unknown }).requestId)
                return
            }
            if (message.type === 'fast-calc:request-state') {
                postState((message as { requestId?: unknown }).requestId)
            }
        }
    }

    let waitTimer: ReturnType<typeof setTimeout> | null = null
    const clearWaitTimer = () => {
        if (waitTimer) {
            clearTimeout(waitTimer)
            waitTimer = null
        }
    }

    onMount(() => {
        hideSplash()
        window.addEventListener('message', onMessage)
        parent.postMessage({ type: 'fast-calc:ready' }, '*')
        const url = new URLSearchParams(location.search).get('import_project') ?? ''
        if (url) {
            void loadFromUrl(url)
            return
        }
        // 无 URL 时等待宿主 postMessage；报告页（wuwacalc-conv）走这条路径
        loading = true
        waitTimer = setTimeout(() => {
            if (loaded || error) return
            error = '未收到工程：请使用 ?import_project=<地址>，或由宿主发送 fast-calc:load'
            loading = false
        }, 15000)
    })

    /** @desc 离开本页时恢复同源数据接口，避免基址泄漏到工具箱其它页面 */
    onDestroy(() => {
        clearWaitTimer()
        window.removeEventListener('message', onMessage)
        setApiBase('')
    })

    const setChain = (index: number, value: number) => {
        chains = chains.map((current, i) => (i === index ? value : current))
        afterEdit()
    }

    const setRefinement = (index: number, value: number) => {
        refinements = refinements.map((current, i) => (i === index ? value : current))
        afterEdit()
    }

    const setMainStat = (charIndex: number, slotIndex: number, label: string) => {
        const slot = slotOf(charIndex, slotIndex)
        if (!slot) return
        const option = mainStatOptions(slot.cost).find((item) => item.label === label)
        slot.mainStat = option ? mainStatFromOption(option) : null
        afterEdit()
    }

    const addSubstat = (charIndex: number, slotIndex: number) => {
        const slot = slotOf(charIndex, slotIndex)
        if (!slot || slot.substats.length >= SUBSTAT_LIMIT) return
        const used = new Set(slot.substats.map((sub) => sub.type))
        const option = SUBSTAT_OPTIONS.find((item) => !used.has(item.label))
        if (!option) return
        slot.substats = [...slot.substats, defaultSubstat(option.label)]
        afterEdit()
    }

    const setSubstatType = (charIndex: number, slotIndex: number, subIndex: number, label: string) => {
        const slot = slotOf(charIndex, slotIndex)
        if (!slot) return
        if (slot.substats.some((sub, i) => i !== subIndex && sub.type === label)) return
        slot.substats[subIndex] = defaultSubstat(label)
        afterEdit()
    }

    const setSubstatValue = (charIndex: number, slotIndex: number, subIndex: number, raw: string) => {
        const sub = slotOf(charIndex, slotIndex)?.substats[subIndex]
        if (!sub) return
        const value = Number(raw)
        if (!Number.isFinite(value)) return
        sub.value = value
        afterEdit()
    }

    const removeSubstat = (charIndex: number, slotIndex: number, subIndex: number) => {
        const slot = slotOf(charIndex, slotIndex)
        if (!slot) return
        slot.substats = slot.substats.filter((_, i) => i !== subIndex)
        afterEdit()
    }

    const setEnemyType = (type: EnemyType) => {
        if (!config) return
        config.enemy = { ...config.enemy, type }
        afterEdit()
    }

    const setEnemyNumber = (key: 'level' | 'defense' | 'dmgReduction', raw: string) => {
        if (!config) return
        const value = Number(raw)
        if (!Number.isFinite(value)) return
        if (key === 'level') {
            const level = Math.min(150, Math.max(0, value))
            config.enemy = { ...config.enemy, level, defense: enemyDefenseForLevel(level) }
        } else {
            config.enemy = { ...config.enemy, [key]: value }
        }
        afterEdit()
    }

    const setResistance = (element: string, raw: string) => {
        if (!config) return
        const value = Number(raw)
        if (!Number.isFinite(value)) return
        config.enemy = { ...config.enemy, resistances: { ...config.enemy.resistances, [element]: value } }
        afterEdit()
    }

    const critOf = (result: { canCrit: boolean; critPerHit: number }): string =>
        result.canCrit ? Math.round(result.critPerHit).toLocaleString() : '—'

    const formatPartValue = (part: TracePart): string => {
        if (part.unit === '%') return `${part.value}%`
        if (part.unit === 'mult') return `×${part.value.toFixed(3)}`
        return String(part.value)
    }
</script>

<svelte:head>
    <title>{project ? `${project.name ?? '未命名工程'} · 快速计算` : '快速计算'} · 椰果工具箱</title>
</svelte:head>

<div class="fast-calc">
    {#if !project}
        {#if error}
            <p class="error">{error}</p>
        {:else}
            <div class="loading" role="status" aria-live="polite">
                <span></span><span></span><span></span>
            </div>
        {/if}
    {:else}
        {#each project.team as slot, charIndex (charIndex)}
            <h2>{slot.character || `角色 ${charIndex + 1}`}</h2>
            {#if config}
                {@const character = config.characters[charIndex]}
                <table class="form">
                    <tbody>
                        <tr>
                            <th>共鸣链</th>
                            <td>
                                {#each CHAIN_OPTIONS as value (value)}
                                    <label class="tab">
                                        <input
                                            type="radio"
                                            name={`chain-${charIndex}`}
                                            {value}
                                            checked={chains[charIndex] === value}
                                            onchange={() => setChain(charIndex, value)}
                                        />
                                        <span>{value}</span>
                                    </label>
                                {/each}
                            </td>
                        </tr>
                        <tr>
                            <th>武器精炼</th>
                            <td>
                                {#each REFINE_OPTIONS as value (value)}
                                    <label class="tab">
                                        <input
                                            type="radio"
                                            name={`refine-${charIndex}`}
                                            {value}
                                            checked={refinements[charIndex] === value}
                                            onchange={() => setRefinement(charIndex, value)}
                                        />
                                        <span>{value}</span>
                                    </label>
                                {/each}
                            </td>
                        </tr>
                        <tr>
                            <th>声骸</th>
                            <td>
                                <div class="echo-grid">
                                    {#each character.echoes as echoSlot, slotIndex (slotIndex)}
                                        {@const echoLabel = echoName(charIndex, slotIndex)}
                                        <table class="nested">
                                            <tbody>
                                                <tr>
                                                    <td colspan="2">
                                                        {#if echoLabel}{echoLabel} ·
                                                        {/if}{echoSlot.cost} cost
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <th>主词条</th>
                                                    <td>
                                                        <table class="fields-table">
                                                            <tbody>
                                                                <tr>
                                                                    <td>
                                                                        <select
                                                                            value={echoSlot.mainStat?.type ?? ''}
                                                                            onchange={(event) =>
                                                                                setMainStat(
                                                                                    charIndex,
                                                                                    slotIndex,
                                                                                    event.currentTarget.value
                                                                                )}
                                                                        >
                                                                            <option value="">未设置</option>
                                                                            {#each mainStatOptions(echoSlot.cost) as option (option.label)}
                                                                                <option value={option.label}>
                                                                                    {option.label} +{option.maxValue}{option.unit}
                                                                                </option>
                                                                            {/each}
                                                                        </select>
                                                                    </td>
                                                                    {#if echoSlot.secondMainStat}
                                                                        <td>
                                                                            副：{formatEchoStat(
                                                                                echoSlot.secondMainStat
                                                                            )}
                                                                        </td>
                                                                    {/if}
                                                                </tr>
                                                            </tbody>
                                                        </table>
                                                    </td>
                                                </tr>
                                                {#each Array.from({ length: SUBSTAT_LIMIT }, (_, index) => index) as subIndex (subIndex)}
                                                    {@const sub = echoSlot.substats[subIndex]}
                                                    <tr>
                                                        <th>副词条 {subIndex + 1}</th>
                                                        <td>
                                                            <table class="fields-table">
                                                                <tbody>
                                                                    <tr>
                                                                        {#if sub}
                                                                            <td>
                                                                                <select
                                                                                    aria-label="副词条类型"
                                                                                    value={sub.type}
                                                                                    onchange={(event) =>
                                                                                        setSubstatType(
                                                                                            charIndex,
                                                                                            slotIndex,
                                                                                            subIndex,
                                                                                            event.currentTarget.value
                                                                                        )}
                                                                                >
                                                                                    {#each availableSubstatLabels(echoSlot, sub.type) as label (label)}
                                                                                        <option value={label}
                                                                                            >{label}</option
                                                                                        >
                                                                                    {/each}
                                                                                </select>
                                                                            </td>
                                                                            <td>
                                                                                <input
                                                                                    aria-label="副词条数值"
                                                                                    type="number"
                                                                                    step="0.1"
                                                                                    value={sub.value}
                                                                                    onchange={(event) =>
                                                                                        setSubstatValue(
                                                                                            charIndex,
                                                                                            slotIndex,
                                                                                            subIndex,
                                                                                            event.currentTarget.value
                                                                                        )}
                                                                                />
                                                                            </td>
                                                                            <td>{sub.unit}</td>
                                                                            <td>
                                                                                <button
                                                                                    onclick={() =>
                                                                                        removeSubstat(
                                                                                            charIndex,
                                                                                            slotIndex,
                                                                                            subIndex
                                                                                        )}
                                                                                >
                                                                                    删除
                                                                                </button>
                                                                            </td>
                                                                        {:else}
                                                                            <td>
                                                                                <select
                                                                                    aria-label="副词条类型"
                                                                                    value=""
                                                                                    onchange={(event) =>
                                                                                        addSubstatByLabel(
                                                                                            charIndex,
                                                                                            slotIndex,
                                                                                            event.currentTarget.value
                                                                                        )}
                                                                                >
                                                                                    <option value="">未设置</option>
                                                                                    {#each availableSubstatLabels(echoSlot, '') as label (label)}
                                                                                        <option value={label}
                                                                                            >{label}</option
                                                                                        >
                                                                                    {/each}
                                                                                </select>
                                                                            </td>
                                                                            <td></td>
                                                                            <td></td>
                                                                            <td></td>
                                                                        {/if}
                                                                    </tr>
                                                                </tbody>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                {/each}
                                            </tbody>
                                        </table>
                                    {/each}
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            {/if}
        {/each}

        <h2>敌怪配置</h2>
        {#if config}
            <table class="form">
                <tbody>
                    <tr>
                        <th>类型</th>
                        <td>
                            {#each ENEMY_TYPES as type (type)}
                                <label class="tab">
                                    <input
                                        type="radio"
                                        name="enemy-type"
                                        value={type}
                                        checked={config.enemy.type === type}
                                        onchange={() => setEnemyType(type)}
                                    />
                                    <span>{type}</span>
                                </label>
                            {/each}
                        </td>
                    </tr>
                    <tr>
                        <th>属性</th>
                        <td>
                            <table class="fields-table">
                                <tbody>
                                    <tr>
                                        <td>
                                            等级
                                            <input
                                                type="number"
                                                value={config.enemy.level}
                                                onchange={(event) => setEnemyNumber('level', event.currentTarget.value)}
                                            />
                                        </td>
                                        <td>
                                            防御
                                            <input
                                                type="number"
                                                value={config.enemy.defense}
                                                onchange={(event) =>
                                                    setEnemyNumber('defense', event.currentTarget.value)}
                                            />
                                        </td>
                                        <td>
                                            减伤%
                                            <input
                                                type="number"
                                                step="0.1"
                                                value={config.enemy.dmgReduction}
                                                onchange={(event) =>
                                                    setEnemyNumber('dmgReduction', event.currentTarget.value)}
                                            />
                                        </td>
                                        {#each ELEMENTS as element (element)}
                                            <td>
                                                {element}%
                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    value={config.enemy.resistances[element] ?? 0}
                                                    onchange={(event) =>
                                                        setResistance(element, event.currentTarget.value)}
                                                />
                                            </td>
                                        {/each}
                                    </tr>
                                </tbody>
                            </table>
                        </td>
                    </tr>
                </tbody>
            </table>
        {/if}

        <hr />

        {#if error}
            <p class="error">{error}</p>
        {:else if !segments.length}
            <p>没有可展示的时间段（工程缺少参考线计时）。</p>
        {:else}
            {#each segments as segment (segment.key)}
                {@const columns = zoneColumnsOf(segment.entries)}
                <h2>
                    {segment.time} · 总伤 {Math.round(segment.total).toLocaleString()}
                    {segment.seconds > 0
                        ? ` · DPS ${Math.round(segment.dps).toLocaleString()} · ${segment.seconds.toFixed(2)}s`
                        : ''}
                </h2>
                <table>
                    <thead>
                        <tr>
                            <th>来源</th>
                            <th>条目</th>
                            <th class="num">倍率</th>
                            <th class="num">命中</th>
                            {#each columns as label (label)}
                                <th class="num">{label}</th>
                            {/each}
                            <th class="num">期望伤害</th>
                            <th class="num">暴击伤害</th>
                            <th class="num">不暴击伤害</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each segment.entries as result (result.id)}
                            {@const trace = traceOf(result)}
                            {@const edited = hasZoneOverride(result.id)}
                            <tr>
                                <td>{result.character || '—'}</td>
                                <td>
                                    <strong>{result.displayName}</strong>
                                </td>
                                <td class="num">
                                    {((result.ratioNum / result.hits) * 100).toFixed(2)}%
                                    {#if result.hits > 1}×{result.hits}{/if}
                                </td>
                                <td class="num">{result.hits}</td>
                                {#each columns as label (label)}
                                    {@const zone = zoneValueOf(result, label)}
                                    <td class="num">
                                        {#if zone}
                                            <input
                                                class="zone-input"
                                                class:manual={zoneOverrides[result.id]?.[label] !== undefined}
                                                type="number"
                                                step="0.001"
                                                value={zone.value}
                                                onchange={(event) =>
                                                    setZoneOverride(result.id, label, event.currentTarget.value)}
                                            />
                                        {:else}
                                            —
                                        {/if}
                                    </td>
                                {/each}
                                <td class="num" class:manual={edited}>
                                    {Math.round(result.expectedPerHit).toLocaleString()}
                                </td>
                                <td class="num" class:manual={edited}>{critOf(result)}</td>
                                <td class="num" class:manual={edited}>
                                    {Math.round(result.nonCritPerHit).toLocaleString()}
                                </td>
                                <td>
                                    {#if edited}
                                        <button onclick={() => resetZoneOverride(result.id)}>复原</button>
                                    {:else}
                                        <button onclick={() => openTrace(result.id)}>溯源</button>
                                        <dialog id={traceDialogId(result.id)} class="trace-dialog">
                                            <form method="dialog">
                                                <button>关闭</button>
                                            </form>
                                            {#if trace}
                                                <table class="nested">
                                                    <tbody>
                                                        <tr>
                                                            <th>{trace.baseLabel}</th>
                                                            <td>
                                                                白值 {Math.round(trace.baseWhite).toLocaleString()} · 绿值
                                                                {Math.round(trace.baseGreen).toLocaleString()} · 面板
                                                                {Math.round(trace.totalStat).toLocaleString()} · 倍率
                                                                {trace.ratioPct.toFixed(2)}% × {trace.hits} 段 · 基础伤害
                                                                {Math.round(trace.baseValue).toLocaleString()}
                                                            </td>
                                                        </tr>
                                                        {#each trace.segments as seg, segIndex (segIndex)}
                                                            <tr>
                                                                <th>{seg.label}</th>
                                                                <td>
                                                                    ×{seg.value.toFixed(4)} <small>{seg.detail}</small>
                                                                    {#if seg.parts.length > 0}
                                                                        <table class="nested">
                                                                            <tbody>
                                                                                {#each seg.parts as part, partIndex (partIndex)}
                                                                                    <tr>
                                                                                        <td>
                                                                                            {part.source} · {part.label}
                                                                                        </td>
                                                                                        <td>{formatPartValue(part)}</td>
                                                                                        <td>
                                                                                            {part.contribution !==
                                                                                            undefined
                                                                                                ? part.contribution.toFixed(
                                                                                                      4
                                                                                                  )
                                                                                                : ''}
                                                                                        </td>
                                                                                    </tr>
                                                                                {/each}
                                                                            </tbody>
                                                                        </table>
                                                                    {/if}
                                                                </td>
                                                            </tr>
                                                        {/each}
                                                        {#if trace.factors.length > 1}
                                                            <tr>
                                                                <th>倍率因子</th>
                                                                <td>
                                                                    <table class="nested">
                                                                        <tbody>
                                                                            {#each trace.factors as factor, factorIndex (factorIndex)}
                                                                                <tr>
                                                                                    <td>{factor.label}</td>
                                                                                    <td>
                                                                                        {(factor.share * 100).toFixed(
                                                                                            2
                                                                                        )}%
                                                                                    </td>
                                                                                    <td>
                                                                                        {Math.round(
                                                                                            factor.damage
                                                                                        ).toLocaleString()}
                                                                                    </td>
                                                                                </tr>
                                                                            {/each}
                                                                        </tbody>
                                                                    </table>
                                                                </td>
                                                            </tr>
                                                        {/if}
                                                    </tbody>
                                                </table>
                                            {:else}
                                                <p>无溯源信息</p>
                                            {/if}
                                        </dialog>
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            {/each}
        {/if}
    {/if}
</div>

<style>
    :global(body) {
        margin: 0;
        background: #fff;
        color: #000;
    }
    .fast-calc {
        background: #fff;
        color: #000;
        font:
            13px/1.5 ui-monospace,
            SFMono-Regular,
            Menlo,
            Consolas,
            monospace;
    }
    .loading {
        display: flex;
        min-height: 100vh;
        align-items: center;
        justify-content: center;
        gap: 6px;
    }
    .loading span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #000;
        animation: breathe 1s ease-in-out infinite;
    }
    .loading span:nth-child(2) {
        animation-delay: 0.15s;
    }
    .loading span:nth-child(3) {
        animation-delay: 0.3s;
    }
    @keyframes breathe {
        0%,
        100% {
            opacity: 0.2;
            transform: scale(0.8);
        }
        50% {
            opacity: 1;
            transform: scale(1);
        }
    }
    table {
        width: 100%;
        border-collapse: collapse;
        margin: 4px 0;
    }
    th,
    td {
        border: 1px solid #000;
        padding: 2px 6px;
        text-align: left;
        vertical-align: top;
    }
    th {
        font-weight: 600;
    }
    .form th {
        width: 1%;
        white-space: nowrap;
    }
    .nested {
        width: 100%;
    }
    .echo-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
    }
    @media (min-width: 900px) {
        .echo-grid {
            grid-template-columns: 1fr 1fr;
        }
    }
    .fields-table {
        margin: 0;
    }
    .fields-table td {
        white-space: nowrap;
    }
    .fields-table input[type='number'] {
        width: 64px;
    }
    input:not([type='radio']),
    select {
        font-style: italic;
    }
    button {
        text-decoration: underline;
    }
    .manual {
        color: #c00;
    }
    .zone-input {
        width: 72px;
        text-align: right;
    }
    .zone-input.manual {
        border-color: #c00;
    }
    .tab {
        position: relative;
        display: inline-block;
        margin: 0 4px 4px 0;
        cursor: pointer;
    }
    .tab input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
    }
    .tab span {
        display: inline-block;
        border: 1px solid #000;
        padding: 1px 6px;
    }
    .tab input:checked + span {
        background: #000;
        color: #fff;
    }
    .tab input:focus-visible + span {
        outline: 2px solid #000;
        outline-offset: 1px;
    }
    .num {
        text-align: right;
    }
    .error {
        color: #b00;
    }
    .trace-dialog {
        position: fixed;
        inset: 8px;
        width: auto;
        height: auto;
        max-width: none;
        max-height: none;
        margin: 0;
        border: 1px solid #000;
        background: #fff;
        color: #000;
        padding: 8px;
        overflow: auto;
        box-sizing: border-box;
    }
    .trace-dialog::backdrop {
        background: rgba(0, 0, 0, 0.25);
    }
</style>
