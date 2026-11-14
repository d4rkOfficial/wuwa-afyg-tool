<script lang="ts">
    import type { CharSlot, ResultAnalysisData } from '$lib/types/project'
    import type { CalcState } from '$lib/calc/calculation.types'
    import type { ConfigState } from '$lib/calc/config.types'
    import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
    import { getCharacterInfo, getWeaponInfo, getCharacterIcons, getWeaponIcons } from '$lib/api/data-cache'
    import { ensureEchoSkillText, getEchoSkillText } from '$lib/data/char-info.svelte'
    import { getCharElementMap } from '$lib/calc/timeline.store.svelte'
    import { getActiveProject, updateResultAnalysis, updateComparisonPoints } from '$lib/data/project.svelte'
    import { getMultiEntryExpand } from '$lib/data/interaction-prefs.svelte'
    import { nextExpandedIds } from '$lib/utils/expand-state'
    import { computeAll as computeAllDamage } from '$lib/calc/compute'
    import {
        getAllDamageEntries,
        getCalcState,
        getConditionProfile,
        getGlobalBuffSetIds,
        getTableVersion
    } from '$lib/calc/calculation.store.svelte'
    import { getConfig } from '$lib/calc/config.store.svelte'
    import type { ResultEntry, CharSummary, CharSubstatAnalysis, CharBuffAnalysis } from '$lib/calc/result.types'
    import { DAMAGE_TYPE_SHORT } from '$lib/consts/game-terms'
    import { ALGORITHMS_INFO } from '$lib/calc/substat-algorithms'
    import type { AlgorithmId, AlgorithmInfo } from '$lib/calc/substat-algorithms/types'
    import { runContributionAnalysisAsync } from '$lib/calc/substat-algorithms/analysis-runner'
    import type { ContributionAnalysisRequest } from '$lib/calc/substat-algorithms/analysis'
    import {
        analysisNeeded,
        nextAnalysisCache,
        type AnalysisCache,
        type AnalysisInputs,
        type AnalysisPart
    } from './analysis/analysis-cache.utils'
    import { tick, untrack, onMount } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { registerPanel, unregisterPanel } from '$lib/ai/panels.svelte'
    import { slide } from 'svelte/transition'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'
    import Icon from '@iconify/svelte'
    import { getComparisonEligibility } from '$lib/calc/comparison'
    import DataAnalysisModal from './data-analysis-modal.svelte'
    import ComparisonModal from './comparison-modal.svelte'
    import DamageTraceView from './damage-trace-view.svelte'
    import DamageFactorList from './damage-factor-list.svelte'
    import { damageFactorRows, type DamageTraceCtx, type CritDisplayMode } from '$lib/calc/damage-trace'
    import {
        CARD,
        CARD_PAD,
        CARD_TITLE,
        CELL_VALUE_STRONG,
        NUMERIC_FONT_STYLE,
        STAT_ROW,
        STAT_VALUE_SM,
        SWATCH_DOT
    } from '$lib/calc/result.styles'

    interface Props extends ComponentsProps {
        team: [CharSlot, CharSlot, CharSlot]
        calcState: CalcState | null
        configState: ConfigState | null
        refreshKey?: number
    }

    let { team, calcState, configState, refreshKey = 0, class: className, style: styleProp }: Props = $props()

    const RIG_GRAD_TEXT =
        'background: var(--theme-rigcrit-grad); -webkit-background-clip: text; background-clip: text; color: transparent;'
    const NOCRIT_GRAD_TEXT =
        'background: var(--theme-nocrit-grad); -webkit-background-clip: text; background-clip: text; color: transparent;'
    const MISS_TEXT = 'color: var(--theme-modal-text); opacity: 0.45; text-decoration: line-through;'

    let charInfoMap = $state<Record<string, CharacterInfo>>({})
    let weaponInfoMap = $state<Record<string, WeaponInfo>>({})
    let charIcons = $state<Record<string, string>>({})
    let weaponIcons = $state<Record<string, string>>({})
    let cleanEntries = $state<ResultEntry[]>([])
    let entries = $state<ResultEntry[]>([])
    let loading = $state(true)
    let charElements = $derived(getCharElementMap())
    let resultAnalysis = $derived(getActiveProject()?.analysis)
    let rigCritEntryIds = $state<string[]>([])
    let noCritEntryIds = $state<string[]>([])
    let missEntryIds = $state<string[]>([])

    // 分段还原/乘区溯源上下文：与 computeAll 同源（拉表/配置 store），保证口径一致
    let traceCtx = $derived<DamageTraceCtx>({
        buffSets: getCalcState().buffSets,
        damageEntryBuffSetIds: getCalcState().damageEntryBuffSetIds,
        damageEntryDamageTypes: getCalcState().damageEntryDamageTypes,
        configState: getConfig(),
        team,
        charInfoMap,
        weaponInfoMap,
        conditionProfile: getConditionProfile()
    })

    /** @desc 条目的暴击展示口径：按用户勾选（凹暴/不暴）判定，不看数值——
     *  暴击率≥100% 时期望值天然等于全暴击值，用数值反推会把「必暴」误显示成「凹暴」 */
    const critModeOf = (entryId: string): CritDisplayMode =>
        rigCritEntryIds.includes(entryId) ? 'rig' : noCritEntryIds.includes(entryId) ? 'noCrit' : 'expected'

    $effect(() => {
        calcState
        configState
        loadData()
    })

    $effect(() => {
        if (refreshKey > 0) untrack(() => refreshAll())
    })

    /**
     * @desc 伤害条目被**异步重建**时重算结果。
     *
     * 条目不是纯派生：偏谐响应（震谐/骇破）的倍率要等技能缓存异步就绪后由 store 补建一次
     * （见 `calculation.store.init`）。若这里不跟着重算，进工程首帧已算过一遍的结果就会停在
     * 「响应伤害 = 0」，直到用户手动刷新。
     */
    let _entriesFp = ''
    $effect(() => {
        const list = getAllDamageEntries()
        const fp = `${list.length}:${list.reduce((sum, e) => sum + (e.ratioValue || 0), 0)}`
        if (fp === _entriesFp) return
        _entriesFp = fp
        if (loading) return
        untrack(() => refreshAll())
    })

    // 链/阶档位变化（含从数据分析弹窗打开角色详情配置修改）→ 重算表格 + 数据分析（图表 / 贡献）；
    // 指纹避免挂载期与 loadData 重复计算。`loading` 期间的改动由 `loadData()` 收尾处补算（见 refreshAll）。
    let _profileFp = ''
    $effect(() => {
        const p = getConditionProfile()
        const fp = `${p.chains.join(',')}|${p.refinements.join(',')}`
        if (fp === _profileFp) return
        _profileFp = fp
        if (loading) return
        untrack(() => refreshAll())
    })

    async function loadData() {
        loading = true
        try {
            const charNames = team.map((s) => s.character).filter((c): c is string => c !== null)
            const iconResults = await Promise.allSettled([getCharacterIcons(), getWeaponIcons()])
            if (iconResults[0].status === 'fulfilled') charIcons = iconResults[0].value
            if (iconResults[1].status === 'fulfilled') weaponIcons = iconResults[1].value

            const infoPromises = charNames.map((n) => getCharacterInfo(n).catch(() => null))
            const infos = await Promise.all(infoPromises)
            const cmap: Record<string, CharacterInfo> = {}
            for (let i = 0; i < charNames.length; i++) {
                if (infos[i]) cmap[charNames[i]] = infos[i]!
            }
            charInfoMap = cmap

            const weaponNames = team.map((s) => s.weapon).filter((w): w is string => w !== null)
            const wpPromises = weaponNames.map((n) => getWeaponInfo(n).catch(() => null))
            const wpInfos = await Promise.all(wpPromises)
            const wmap: Record<string, WeaponInfo> = {}
            for (let i = 0; i < weaponNames.length; i++) {
                if (wpInfos[i]) wmap[weaponNames[i]] = wpInfos[i]!
            }
            weaponInfoMap = wmap

            // 声骸技能文案（伤害类型规则2）：先补齐再计算，避免首次结果缺「视为/为 XX 伤害」推导
            const echoNames = team.map((s) => s.echoes?.[0]?.name).filter((n): n is string => !!n)
            await Promise.all(echoNames.map((n) => ensureEchoSkillText(n)))
        } catch {
            /* ignore */
        }
        rigCritEntryIds = getActiveProject()?.analysis?.rigCritEntryIds ?? []
        noCritEntryIds = getActiveProject()?.analysis?.noCritEntryIds ?? []
        missEntryIds = getActiveProject()?.analysis?.missEntryIds ?? []
        loading = false
        refreshAll()
    }

    /**
     * @desc 重算表格，并在数据分析弹窗打开时一并重跑「图表 + 贡献」的分析结果。
     *
     * 所有刷新入口都走这里，是为了堵住一条真实漏刷：链/阶改动会先落回队伍（工程 team），
     * 结果页 props 随之变化 → `loadData()` 置 `loading`，而指纹类 effect 在 `loading` 期间
     * 主动跳过；若收尾处不补一次分析，图表与词条 / Buff 贡献就会停在未重算的结果（实测复现：
     * 从数据分析弹窗打开「角色详情配置」改链阶）。
     */
    function refreshAll() {
        computeAll()
        if (showDataAnalysis) void runAnalysis(['substat', 'buff'])
    }

    function computeAll() {
        const calc = getCalcState()
        const config = getConfig()
        const dmgEntries = getAllDamageEntries()
        if (dmgEntries.length === 0) {
            cleanEntries = []
            entries = []
            return
        }
        cleanEntries = computeAllDamage(
            dmgEntries,
            calc.buffSets,
            calc.damageEntryBuffSetIds,
            calc.damageEntryDamageTypes,
            config,
            team,
            charInfoMap,
            weaponInfoMap,
            getConditionProfile()
        )
        applyModes(cleanEntries)
    }

    function applyModes(sourceEntries: ResultEntry[]) {
        const rigIds = new Set(rigCritEntryIds)
        const noCritIds = new Set(noCritEntryIds)
        const missIds = new Set(missEntryIds)
        entries = sourceEntries.map((e) => {
            // 未命中优先：该段伤害恒为 0（暴击/不暴击列保留理论值，期望/总伤/基准归零）
            if (missIds.has(e.id)) {
                return { ...e, expectedPerHit: 0, totalDamage: 0, totalDamageRaw: 0 }
            }
            if (rigIds.has(e.id)) {
                return { ...e, expectedPerHit: e.critPerHit, totalDamage: e.critPerHit }
            }
            if (noCritIds.has(e.id)) {
                return { ...e, expectedPerHit: e.nonCritPerHit, totalDamage: e.nonCritPerHit }
            }
            return e
        })
    }

    function setEntryMode(id: string, mode: 'expect' | 'crit' | 'nocrit' | 'miss') {
        let rig = rigCritEntryIds.includes(id) ? rigCritEntryIds.filter((i) => i !== id) : rigCritEntryIds
        let noCrit = noCritEntryIds.includes(id) ? noCritEntryIds.filter((i) => i !== id) : noCritEntryIds
        let miss = missEntryIds.includes(id) ? missEntryIds.filter((i) => i !== id) : missEntryIds
        if (mode === 'crit' && !rig.includes(id)) rig = [...rig, id]
        if (mode === 'nocrit' && !noCrit.includes(id)) noCrit = [...noCrit, id]
        if (mode === 'miss' && !miss.includes(id)) miss = [...miss, id]
        rigCritEntryIds = rig
        noCritEntryIds = noCrit
        missEntryIds = miss
        updateResultAnalysis({
            timings: resultAnalysis?.timings ?? [],
            rigCritEntryIds: rig,
            noCritEntryIds: noCrit,
            missEntryIds: miss
        })
        applyModes(cleanEntries)
    }

    let charSummaries = $derived.by(() => {
        const map = new Map<string, { total: number; count: number }>()
        for (const e of entries) {
            const cur = map.get(e.character) ?? { total: 0, count: 0 }
            cur.total += e.totalDamage
            cur.count++
            map.set(e.character, cur)
        }
        // 卡片顺序：伤害最高的角色 → … → 最低的角色 → 其它（无角色归属的永远排最后）
        return [...map.entries()]
            .map(([character, d]) => ({ character, totalDamage: d.total, entryCount: d.count }))
            .sort((a, b) => {
                if (!a.character) return 1
                if (!b.character) return -1
                return b.totalDamage - a.totalDamage
            })
    })

    let totalDamage = $derived(charSummaries.reduce((s, c) => s + c.totalDamage, 0))

    // ── 链/阶对比：资格判定 + 复算（取期望 totalDamageRaw，不套凹暴/不暴/未命中模式）──
    let showComparison = $state(false)
    let comparisonPoints = $state<{ chains: number[]; refinements: number[] }[]>(getActiveProject()?.comparison ?? [])
    let comparisonEligibility = $derived(
        getComparisonEligibility(
            getCalcState().buffSets,
            getGlobalBuffSetIds(),
            getAllDamageEntries(),
            getCalcState().damageEntryBuffSetIds
        )
    )

    /** @desc 按期望（totalDamageRaw）聚合原始（未套模式）条目为对比口径 */
    function aggregateExpectation(raw: ResultEntry[]): {
        entries: ResultEntry[]
        charSummaries: CharSummary[]
        totalDamage: number
    } {
        const map = new Map<string, { total: number; count: number }>()
        let total = 0
        for (const e of raw) {
            const d = e.totalDamageRaw
            total += d
            const cur = map.get(e.character) ?? { total: 0, count: 0 }
            cur.total += d
            cur.count++
            map.set(e.character, cur)
        }
        return {
            entries: raw,
            charSummaries: [...map.entries()].map(([character, d]) => ({
                character,
                totalDamage: d.total,
                entryCount: d.count
            })),
            totalDamage: total
        }
    }

    /** @desc 对比复算：给定完整队伍链/阶 profile，复算原始期望（不套凹暴/不暴/未命中） */
    function recomputeComparison(chains: number[], refinements: number[]) {
        const calc = getCalcState()
        const config = getConfig()
        const dmgEntries = getAllDamageEntries()
        const modified = {
            chains: [chains[0] ?? 0, chains[1] ?? 0, chains[2] ?? 0],
            refinements: [refinements[0] ?? 0, refinements[1] ?? 0, refinements[2] ?? 0]
        }
        const raw = computeAllDamage(
            dmgEntries,
            calc.buffSets,
            calc.damageEntryBuffSetIds,
            calc.damageEntryDamageTypes,
            config,
            team,
            charInfoMap,
            weaponInfoMap,
            modified
        )
        return aggregateExpectation(raw)
    }

    let selectedAlgorithm = $state<AlgorithmId>('single-loss')
    let substatAnalysis = $state<CharSubstatAnalysis[]>([])
    let buffAnalysis = $state<CharBuffAnalysis[]>([])
    let substatComputing = $state(false)
    let buffComputing = $state(false)
    /** @desc 请求序号：只接受最新一次的结果，避免快速切换算法时旧结果覆盖新结果 */
    let analysisSeq = 0

    /**
     * @desc 分析输入指纹（**全部廉价可比**：版本号 / 字符串 / 对象引用，不做深拷贝）。
     * 判定与缓存登记的口径在 `./analysis/analysis-cache.utils`（纯函数 + 单测）。
     */
    const analysisInputsOf = (): AnalysisInputs => {
        const p = getConditionProfile()
        return {
            table: getTableVersion(),
            entries: _entriesFp,
            profile: `${p.chains.join(',')}|${p.refinements.join(',')}`,
            teamRef: team,
            configRef: configState,
            charInfoRef: charInfoMap,
            weaponInfoRef: weaponInfoMap,
            echoTextRef: getEchoSkillText(),
            crit: `${rigCritEntryIds.join(',')}|${noCritEntryIds.join(',')}|${missEntryIds.join(',')}`,
            refresh: refreshKey
        }
    }

    /** @desc 已算结果的缓存登记：哪几部分是「按当前输入」算的（输入变了就只剩本次算出来的部分） */
    let analysisDone: AnalysisCache | null = null

    /**
     * @desc 跑直伤贡献分析（主线程分片，无 Worker）。
     *
     * `parts` 决定算哪一半：切换副词条算法时只重算副词条（Buff 与算法无关，重算纯属浪费）。
     * 输入与算法都没变时**直接返回**（弹窗重开 = 秒开）；每次结果都按 `analysisSeq` 校验，晚到的旧结果丢弃。
     */
    async function runAnalysis(parts: readonly AnalysisPart[]) {
        if (getAllDamageEntries().length === 0) return
        const inputs = analysisInputsOf()
        const need = analysisNeeded(analysisDone, parts, inputs, selectedAlgorithm)
        if (need.length === 0) return
        const seq = ++analysisSeq
        if (need.includes('substat')) substatComputing = true
        if (need.includes('buff')) buffComputing = true
        // 先让「计算中…」渲染出来，再开始同步重算
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (seq !== analysisSeq) return
        try {
            const res = await runContributionAnalysisAsync(
                analysisRequest(),
                { algorithm: selectedAlgorithm, parts: need },
                (partial) => {
                    if (seq !== analysisSeq) return
                    if (need.includes('substat')) substatAnalysis = partial.substat
                    if (need.includes('buff')) buffAnalysis = partial.buff
                }
            )
            if (seq !== analysisSeq) return
            if (need.includes('substat')) substatAnalysis = res.substat
            if (need.includes('buff')) buffAnalysis = res.buff
            // 只有「这次要的部分都算完、且没被更新的请求顶掉」才登记为有效结果
            analysisDone = nextAnalysisCache(analysisDone, inputs, need, selectedAlgorithm)
        } catch (err) {
            console.warn('[contribution-analysis] 直伤贡献分析失败', err)
        } finally {
            if (seq === analysisSeq) {
                substatComputing = false
                buffComputing = false
            }
        }
    }

    /**
     * @desc 打开弹窗后的分析调度：**先让开窗动画跑完再算**。
     *
     * 冷启动那一次重算 ≈130ms（真实工程可能更久），如果和弹窗进场动画挤在同一帧，
     * 动画就会掉帧；这里让步给空闲帧（`requestIdleCallback`，超时兜底），
     * 动画期间只用缓存结果 + 标题栏的「计算中…」提示。
     */
    function scheduleAnalysis() {
        const start = () => void runAnalysis(['substat', 'buff'])
        if (typeof window === 'undefined') return start()
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => start(), { timeout: 240 })
            return
        }
        window.setTimeout(start, 120)
    }

    /** @desc 组装直伤贡献分析入参（与 computeAll 同源：同一份 store 状态，不另建缓存） */
    function analysisRequest(): ContributionAnalysisRequest {
        const calc = getCalcState()
        return {
            damageEntries: getAllDamageEntries(),
            buffSets: calc.buffSets,
            damageEntryBuffSetIds: calc.damageEntryBuffSetIds,
            damageEntryDamageTypes: calc.damageEntryDamageTypes,
            configState: getConfig(),
            team,
            charInfoMap,
            weaponInfoMap,
            rigCritEntryIds,
            noCritEntryIds,
            missEntryIds,
            conditionProfile: getConditionProfile(),
            echoSkillText: getEchoSkillText()
        }
    }

    function handleOpenAnalysis() {
        showDataAnalysis = true
        scheduleAnalysis()
    }

    /** @desc 切换算法：只重算副词条那一半（Buff 贡献与算法无关） */
    function selectAlgorithm(id: AlgorithmId) {
        if (id === selectedAlgorithm) return
        selectedAlgorithm = id
        if (showDataAnalysis) void runAnalysis(['substat'])
    }

    let expandedEntryIds = $state<Set<string>>(new Set())
    let showDataAnalysis = $state(false)

    /** @desc 允许多开（设置-交互相关）：派生值，设置变化即生效 */
    let multiEntryExpand = $derived(getMultiEntryExpand())

    onMount(() => {
        registerPanel(
            'data-analysis',
            '数据分析',
            () => showDataAnalysis,
            (v) => {
                showDataAnalysis = v
                // 由 AI / 快捷键打开与点按钮打开必须同口径：打开即跑一次分析（输入没变时秒开，见 scheduleAnalysis）
                if (v) scheduleAnalysis()
            }
        )
        return () => unregisterPanel('data-analysis')
    })
    let tableContainer = $state<HTMLDivElement | undefined>()

    /** @desc 条目展开状态的选择逻辑见 $lib/utils/expand-state（单开 / 多开兼容，纯函数） */
    function toggleExpand(id: string, _index: number) {
        const expanding = !expandedEntryIds.has(id)
        expandedEntryIds = nextExpandedIds(expandedEntryIds, id, multiEntryExpand)
        if (expanding) {
            tick().then(() => {
                tableContainer
                    ?.querySelector<HTMLElement>(`[data-entry-id="${id}"]`)
                    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            })
        }
    }
</script>

<div
    data-sf="content"
    class="flex h-full flex-col {className}"
    style="color: var(--theme-modal-text); {styleProp || ''}"
>
    {#if loading}
        <div class="flex items-center justify-center py-20 text-xs text-(--theme-modal-text)/40">计算中…</div>
    {:else if entries.length === 0}
        <div class="flex items-center justify-center py-20 text-xs text-(--theme-modal-text)/40">暂无伤害数据</div>
    {:else}
        <!-- Summary：总伤害卡（较实的主题色底）+ 各角色卡（角色属性色 + 头像叠底）+ 数据分析方形按钮 -->
        <div class="shrink-0 border-b pl-3 pr-5 py-4" style="border-color: var(--theme-divider-border);">
            <div class="flex items-stretch gap-3">
                <div
                    class="flex min-w-0 flex-1 flex-nowrap items-stretch gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                    <div
                        class={`${CARD} ${CARD_PAD} min-w-48 flex-1`}
                        data-sf="card"
                        style="border-width: 1.5px; border-color: var(--theme-accent-bg);"
                    >
                        <div class="text-sm font-black tracking-tight text-(--theme-modal-text)">总伤害</div>
                        <div class={`mt-1.5 ${STAT_VALUE_SM} text-(--theme-accent-text)`}>
                            {Math.round(totalDamage).toLocaleString()}
                        </div>
                    </div>
                    {#each charSummaries as cs (cs.character)}
                        {@const isOther = !cs.character}
                        {@const elementColor = isOther
                            ? 'var(--theme-modal-text)'
                            : `var(--theme-element-${charElements[cs.character]}, #888)`}
                        <div
                            class={`${CARD} ${CARD_PAD} relative min-w-40 flex-1 overflow-hidden`}
                            data-sf="card"
                            style={isOther
                                ? 'border-width: 1.5px; border-style: dashed; border-color: var(--theme-divider-border);'
                                : `border-width: 1.5px; border-style: dashed; border-color: ${elementColor};`}
                        >
                            <div class="relative flex min-w-0 items-center gap-1.5">
                                <span class={SWATCH_DOT} style="background: {elementColor};"></span>
                                <span class="truncate text-sm font-black" style="color: {elementColor};">
                                    {cs.character || '其它伤害'}
                                </span>
                            </div>
                            <div class={`relative mt-1.5 ${STAT_VALUE_SM} text-(--theme-modal-text)`}>
                                {Math.round(cs.totalDamage).toLocaleString()}
                            </div>
                        </div>
                    {/each}
                </div>
                <!-- @desc 数据分析入口：固定正方形（宽高同为 88px），图标在上、文字在下 -->
                <button
                    onclick={handleOpenAnalysis}
                    class="flex h-[88px] w-[88px] shrink-0 self-center flex-col items-center justify-center gap-1 rounded-none border transition-colors hover:opacity-80"
                    style="background: color-mix(in srgb, var(--theme-accent-bg) 10%, transparent); color: var(--theme-accent-text); border-color: var(--theme-accent-bg);"
                    title="打开数据分析"
                >
                    <Icon icon="mdi:chart-box-outline" class="size-8 shrink-0" />
                    <span class="text-[11px] font-black tracking-tight">数据分析</span>
                </button>
            </div>
        </div>

        <!-- Detail table（表头放在滚动容器外，不吸附） -->
        <div
            class="shrink-0 border-b"
            data-sf="toolbar"
            data-sf-under="card"
            style="--sf-base: var(--theme-modal-bg); --sfu-base: var(--theme-modal-bg); border-color: var(--theme-divider-border);"
        >
            <table class="w-full table-fixed text-xs">
                <colgroup>
                    <col style="width: 19%" />
                    <col style="width: 28%" />
                    <col style="width: 12%" />
                    <col style="width: 8%" />
                    <col style="width: 10%" />
                    <col style="width: 10%" />
                    <col style="width: 10%" />
                    <col style="width: 3%" />
                </colgroup>
                <thead>
                    <tr
                        class="text-[11px] font-black tracking-[0.16em] text-(--theme-modal-text)/45"
                        style="border-bottom: 1px solid var(--theme-divider-border); {NUMERIC_FONT_STYLE}"
                    >
                        <th class=" py-2 px-3 text-left"> 来源 </th>
                        <th class=" py-2 px-3 text-left"> 条目 </th>
                        <th class=" py-2 px-3 text-right"> 倍率 </th>
                        <th class=" py-2 px-3 text-right"> 单位 </th>
                        <th class=" py-2 px-3 text-right"> 暴击 </th>
                        <th class=" py-2 px-3 text-right"> 不暴击 </th>
                        <th class=" py-2 px-3 text-right"> 期望 </th>
                        <th class=" py-2 px-3 w-8 text-right"></th>
                    </tr>
                </thead>
            </table>
        </div>
        <div class="theme-scrollbar flex-1 overflow-y-auto pb-48" bind:this={tableContainer}>
            <table class="w-full table-fixed text-xs">
                <colgroup>
                    <col style="width: 19%" />
                    <col style="width: 28%" />
                    <col style="width: 12%" />
                    <col style="width: 8%" />
                    <col style="width: 10%" />
                    <col style="width: 10%" />
                    <col style="width: 10%" />
                    <col style="width: 3%" />
                </colgroup>
                <tbody data-sf="card" style="--sf-base: var(--theme-modal-bg);">
                    {#each entries as entry, i (entry.id)}
                        {@const isExpanded = multiEntryExpand
                            ? expandedEntryIds.has(entry.id)
                            : expandedEntryIds.has(entry.id) && expandedEntryIds.size === 1}
                        <tr
                            onclick={() => toggleExpand(entry.id, i)}
                            data-press="row"
                            data-entry-id={entry.id}
                            class="cursor-pointer border-b transition-colors hover:bg-(--theme-modal-text)/3"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <td
                                class="py-1.5 px-3"
                                style="color: {entry.character
                                    ? `var(--theme-element-${charElements[entry.character]}, #888)`
                                    : 'var(--theme-modal-text)'}">{entry.character || '—'}</td
                            >
                            <td
                                class="py-1.5 px-3 max-w-48 truncate"
                                title={entry.displayName}
                                style="color: var(--theme-element-{entry.element}, #888)"
                            >
                                {entry.displayName}
                                {#each entry.damageTypes as dt (dt)}
                                    <span
                                        class="ml-1 rounded-none border px-1 text-[9px] font-medium align-middle"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                        >{DAMAGE_TYPE_SHORT[dt] ?? dt}</span
                                    >
                                {/each}
                            </td>
                            <td
                                class={`py-1.5 px-3 text-right ${STAT_ROW} text-(--theme-modal-text)/60`}
                                style={NUMERIC_FONT_STYLE}
                                >{((entry.ratioNum / entry.hits) * 100).toFixed(2)}%{#if entry.hits > 1}
                                    ×{entry.hits}{/if}</td
                            >
                            <td class="py-1.5 px-3 text-right text-(--theme-modal-text)/60">{entry.baseUnit}</td>
                            <td class={`py-1.5 px-3 text-right ${STAT_ROW} text-(--theme-modal-text)/60`}
                                >{entry.canCrit ? entry.critPerHit.toLocaleString() : '—'}</td
                            >
                            <td class={`py-1.5 px-3 text-right ${STAT_ROW} text-(--theme-modal-text)/60`}
                                >{entry.canCrit ? entry.nonCritPerHit.toLocaleString() : '—'}</td
                            >
                            <td
                                class={`py-1.5 px-3 text-right ${CELL_VALUE_STRONG}`}
                                style={missEntryIds.includes(entry.id)
                                    ? MISS_TEXT
                                    : rigCritEntryIds.includes(entry.id)
                                      ? RIG_GRAD_TEXT
                                      : noCritEntryIds.includes(entry.id)
                                        ? NOCRIT_GRAD_TEXT
                                        : 'color: var(--theme-accent-text)'}>{entry.expectedPerHit.toLocaleString()}</td
                            >
                            <td class="py-1.5 w-8"></td>
                        </tr>
                        {#if isExpanded}
                            <tr style="background: var(--theme-input-bg);">
                                <td colspan="8" class="p-0">
                                    <div
                                        transition:slide|local={slideParams(MOTION_MS.base)}
                                        class="space-y-3 border-b px-6 py-3 text-xs text-(--theme-modal-text)/60"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        {#if entry.baseUnit === '固定'}
                                            {@const fixedFactors = damageFactorRows(
                                                entry,
                                                missEntryIds.includes(entry.id)
                                            )}
                                            <div class="font-black font-sans text-(--theme-accent-text)">
                                                固定值为 {entry.baseValue.toLocaleString()}
                                            </div>
                                            <div class="font-black font-sans text-(--theme-accent-text)">
                                                最终 = {entry.baseValue.toLocaleString()}
                                            </div>
                                            {#if fixedFactors.length > 1}
                                                <DamageFactorList factors={fixedFactors} canCrit={entry.canCrit} />
                                            {/if}
                                        {:else if entry.baseUnit.startsWith('偏谐系数') || entry.baseUnit === '效应系数'}
                                            <DamageTraceView
                                                {entry}
                                                ctx={traceCtx}
                                                missed={missEntryIds.includes(entry.id)}
                                                critMode={critModeOf(entry.id)}
                                            />
                                            <div
                                                class="shrink-0 self-start inline-flex items-center rounded-none border overflow-hidden"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        setEntryMode(entry.id, 'expect')
                                                    }}
                                                    class="px-3 py-2 text-sm font-medium transition-colors"
                                                    style="background: {!missEntryIds.includes(entry.id)
                                                        ? 'var(--theme-accent-bg)'
                                                        : 'transparent'}; color: {!missEntryIds.includes(entry.id)
                                                        ? 'var(--theme-accent-text-on-bg, #ffffff)'
                                                        : 'var(--theme-modal-text)/40'};"
                                                >
                                                    期望
                                                </button>
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        setEntryMode(entry.id, 'miss')
                                                    }}
                                                    class="px-3 py-2 text-sm font-medium transition-colors border-l"
                                                    title="该段伤害直接归零（未命中）"
                                                    style="background: {missEntryIds.includes(entry.id)
                                                        ? 'color-mix(in srgb, var(--theme-modal-text) 24%, transparent)'
                                                        : 'transparent'}; color: {missEntryIds.includes(entry.id)
                                                        ? 'var(--theme-modal-text)'
                                                        : 'var(--theme-modal-text)/40'}; border-color: var(--theme-divider-border);"
                                                >
                                                    未命中
                                                </button>
                                            </div>
                                        {:else}
                                            <!-- Direct damage entry -->
                                            <DamageTraceView
                                                {entry}
                                                ctx={traceCtx}
                                                missed={missEntryIds.includes(entry.id)}
                                                critMode={critModeOf(entry.id)}
                                            />
                                            <div class="flex items-start gap-4">
                                                <div
                                                    class="shrink-0 self-start inline-flex items-center rounded-none border overflow-hidden"
                                                    style="border-color: var(--theme-divider-border);"
                                                >
                                                    <button
                                                        onclick={(e) => {
                                                            e.stopPropagation()
                                                            setEntryMode(entry.id, 'expect')
                                                        }}
                                                        class="px-3 py-2 text-sm font-medium transition-colors"
                                                        style="background: {!rigCritEntryIds.includes(entry.id) &&
                                                        !noCritEntryIds.includes(entry.id) &&
                                                        !missEntryIds.includes(entry.id)
                                                            ? 'var(--theme-accent-bg)'
                                                            : 'transparent'}; color: {!rigCritEntryIds.includes(
                                                            entry.id
                                                        ) &&
                                                        !noCritEntryIds.includes(entry.id) &&
                                                        !missEntryIds.includes(entry.id)
                                                            ? 'var(--theme-accent-text-on-bg, #ffffff)'
                                                            : 'var(--theme-modal-text)/40'};"
                                                    >
                                                        期望
                                                    </button>
                                                    <button
                                                        onclick={(e) => {
                                                            e.stopPropagation()
                                                            setEntryMode(entry.id, 'crit')
                                                        }}
                                                        class="px-3 py-2 text-sm font-medium transition-colors border-l"
                                                        style="background: {rigCritEntryIds.includes(entry.id)
                                                            ? 'var(--theme-rigcrit-grad)'
                                                            : 'transparent'}; color: {rigCritEntryIds.includes(entry.id)
                                                            ? '#ffffff'
                                                            : 'var(--theme-modal-text)/40'}; border-color: var(--theme-divider-border);"
                                                    >
                                                        凹暴
                                                    </button>
                                                    <button
                                                        onclick={(e) => {
                                                            e.stopPropagation()
                                                            setEntryMode(entry.id, 'nocrit')
                                                        }}
                                                        class="px-3 py-2 text-sm font-medium transition-colors border-l"
                                                        style="background: {noCritEntryIds.includes(entry.id)
                                                            ? 'var(--theme-nocrit-grad)'
                                                            : 'transparent'}; color: {noCritEntryIds.includes(entry.id)
                                                            ? '#ffffff'
                                                            : 'var(--theme-modal-text)/40'}; border-color: var(--theme-divider-border);"
                                                    >
                                                        不暴
                                                    </button>
                                                    <button
                                                        onclick={(e) => {
                                                            e.stopPropagation()
                                                            setEntryMode(entry.id, 'miss')
                                                        }}
                                                        class="px-3 py-2 text-sm font-medium transition-colors border-l"
                                                        title="该段伤害直接归零（未命中）"
                                                        style="background: {missEntryIds.includes(entry.id)
                                                            ? 'color-mix(in srgb, var(--theme-modal-text) 24%, transparent)'
                                                            : 'transparent'}; color: {missEntryIds.includes(entry.id)
                                                            ? 'var(--theme-modal-text)'
                                                            : 'var(--theme-modal-text)/40'}; border-color: var(--theme-divider-border);"
                                                    >
                                                        未命中
                                                    </button>
                                                </div>
                                            </div>
                                        {/if}
                                    </div>
                                </td>
                            </tr>
                        {/if}
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>

{#if showDataAnalysis && entries.length}
    <DataAnalysisModal
        {entries}
        {charSummaries}
        {team}
        {totalDamage}
        {resultAnalysis}
        {substatAnalysis}
        {buffAnalysis}
        {substatComputing}
        {buffComputing}
        algorithmsInfo={ALGORITHMS_INFO}
        {selectedAlgorithm}
        {rigCritEntryIds}
        {noCritEntryIds}
        comparisonEligible={comparisonEligibility.eligible}
        comparisonReason={comparisonEligibility.reason}
        oncompare={() => {
            // 兄弟弹窗互斥：从数据分析进入对比时关闭数据分析
            showDataAnalysis = false
            showComparison = true
        }}
        onSelectAlgorithm={selectAlgorithm}
        onUpdateResultAnalysis={(data) => updateResultAnalysis(data)}
        onclose={() => (showDataAnalysis = false)}
    />
{/if}

{#if showComparison && entries.length}
    <ComparisonModal
        open={showComparison}
        {team}
        timings={resultAnalysis?.timings ?? []}
        eligibility={comparisonEligibility}
        recompute={recomputeComparison}
        initialPoints={comparisonPoints}
        onback={(points) => {
            // 返回数据分析弹窗（兄弟互斥）+ 持久化对比配置
            comparisonPoints = points
            void updateComparisonPoints(points)
            showComparison = false
            showDataAnalysis = true
        }}
    />
{/if}
