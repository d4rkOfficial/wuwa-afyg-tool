<script lang="ts">
    import { getCharacterInfo, getWeaponInfo, getEchoInfo, getEchoSetInfo } from '$lib/data/api'
    import {
        getCharacterIcons,
        getWeaponIcons,
        getEchoIcons,
        getEchoSetIcons,
        getElementIcons,
        getWeaponTypeIcons
    } from '$lib/data/api'
    import { richTextToHtml, colorizeNumbers } from '$lib/utils/rich-text'
    import { ELEMENT_COLORS } from '$lib/consts/game-terms'
    import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
    import type { CharSlot } from '$lib/data/types'
    import Icon from '@iconify/svelte'

    interface Props {
        open: boolean
        team: [CharSlot, CharSlot, CharSlot]
        onCreateBuff?: (name: string) => void
        onCreateCustomHit?: (name: string) => void
        showBuffOption?: boolean
        showCustomHitOption?: boolean
        onclose: () => void
    }

    let {
        open,
        team,
        onCreateBuff,
        onCreateCustomHit,
        showBuffOption = true,
        showCustomHitOption = true,
        onclose
    }: Props = $props()

    let charIndex = $state(0)
    let charData = $state<CharacterInfo | null>(null)
    let weaponData = $state<WeaponInfo | null>(null)
    let echoSkillData = $state<{ desc: string; values: [string, string, string][] } | null>(null)
    let setBonuses = $state<{ name: string; pieces: number; bonuses: Record<string, string> }[] | null>(null)
    let loading = $state(false)
    let charIcons = $state<Record<string, string>>({})
    let weaponIcons = $state<Record<string, string>>({})
    let echoIcons = $state<Record<string, string>>({})
    let setIcons = $state<Record<string, string>>({})
    let elementIcons = $state<Record<string, string>>({})
    let weaponTypeIcons = $state<Record<string, string>>({})
    let ctxShow = $state(false)
    let ctxX = $state(0)
    let ctxY = $state(0)
    let scrollContainer = $state<HTMLDivElement | null>(null)

    let charNames = $derived(team.map((s) => s.character).filter((c): c is string => c !== null))
    let currentSlot = $derived(team[charIndex])
    let inherentSkills = $derived(charData?.statNodes.filter((n) => !n.name.endsWith('提升')) ?? [])
    let statAttrs = $derived(charData?.statNodes.filter((n) => n.name.endsWith('提升')) ?? [])
    let sortedStatAttrs = $derived(
        [...statAttrs].sort((a, b) => {
            if (a.name < b.name) return -1
            if (a.name > b.name) return 1
            const numA = parseFloat(a.desc?.match(/[\d.]+/)?.[0] ?? '0')
            const numB = parseFloat(b.desc?.match(/[\d.]+/)?.[0] ?? '0')
            return numA - numB
        })
    )

    $effect(() => {
        if (open) loadIcons()
    })

    $effect(() => {
        if (open && currentSlot.character) fetchData(currentSlot)
    })

    async function loadIcons() {
        const results = await Promise.allSettled([
            getCharacterIcons(),
            getWeaponIcons(),
            getEchoIcons(),
            getEchoSetIcons(),
            getElementIcons(),
            getWeaponTypeIcons()
        ])
        const [ci, wi, ei, si, eli, wti] = results
        if (ci.status === 'fulfilled') charIcons = ci.value
        if (wi.status === 'fulfilled') weaponIcons = wi.value
        if (ei.status === 'fulfilled') echoIcons = ei.value
        if (si.status === 'fulfilled') setIcons = si.value
        if (eli.status === 'fulfilled') elementIcons = eli.value
        if (wti.status === 'fulfilled') weaponTypeIcons = wti.value
    }

    async function fetchData(slot: CharSlot) {
        if (!slot.character) return
        loading = true
        charData = null
        weaponData = null
        echoSkillData = null
        setBonuses = null
        try {
            const ci = await getCharacterInfo(slot.character)
            charData = ci
            if (slot.weapon)
                getWeaponInfo(slot.weapon)
                    .then((w) => (weaponData = w))
                    .catch(() => {})
            const echoName = slot.echoes[0]?.name
            if (echoName)
                getEchoInfo(echoName)
                    .then((e) => (echoSkillData = e.skill))
                    .catch(() => {})
            if (slot.triggerSets.length > 0) {
                const setResults = await Promise.allSettled(slot.triggerSets.map((s) => getEchoSetInfo(s.name)))
                setBonuses = slot.triggerSets
                    .map((s, i) => ({
                        name: s.name,
                        pieces: s.pieces,
                        bonuses: setResults[i].status === 'fulfilled' ? setResults[i].value.bonuses : {}
                    }))
                    .filter((s) => Object.keys(s.bonuses).length > 0)
            }
        } catch {
            /* ignore */
        }
        loading = false
    }

    function handleCtxMenu(e: MouseEvent) {
        e.preventDefault()
        ctxX = e.clientX
        ctxY = e.clientY
        ctxShow = true
    }

    function handleCopy() {
        const s = window.getSelection()?.toString()
        if (s) navigator.clipboard.writeText(s).catch(() => {})
        ctxShow = false
    }

    function handleCreateBuffFromSel() {
        const s = window.getSelection()?.toString()
        if (s) {
            onCreateBuff?.(s.trim())
            onclose()
        }
        ctxShow = false
    }

    function handleCreateCustomHit() {
        const s = window.getSelection()?.toString()
        if (s && onCreateCustomHit) {
            onCreateCustomHit(s.trim())
            onclose()
        }
        ctxShow = false
    }

    function handleScrollTop() {
        scrollContainer?.scrollTo({ top: 0, behavior: 'smooth' })
        ctxShow = false
    }

    function handleScrollBottom() {
        if (scrollContainer) scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' })
        ctxShow = false
    }

    const img = (p: string) => p || ''
    const rd = (s: string) => colorizeNumbers(richTextToHtml(s))
    const fmtSubVal = (v: string) => {
        const n = parseFloat(v)
        if (isNaN(n) || n >= 1) return v
        return (n * 100).toFixed(1) + '%'
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="fixed inset-0 z-70 flex items-center justify-center select-text backdrop-blur-sm"
        onkeydown={(e) => e.key === 'Escape' && onclose()}
        oncontextmenu={handleCtxMenu}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            class="mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border text-(--theme-modal-text) shadow-2xl"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <div bind:this={scrollContainer} class="flex-1 overflow-y-auto rounded-xl hide-scrollbar">
                <div
                    class="sticky top-0 z-10 flex items-center justify-between border-b px-5 py-3"
                    style="background: color-mix(in srgb, var(--theme-modal-bg) 70%, transparent); backdrop-filter: blur(8px); border-color: var(--theme-divider-border);"
                >
                    <h2 class="text-base font-semibold">速查</h2>
                    <button
                        onclick={onclose}
                        class="flex size-7 items-center justify-center rounded-md text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/10 hover:text-(--theme-modal-text)"
                        ><Icon icon="mdi:close" class="size-4" /></button
                    >
                </div>
                <div
                    class="sticky top-[52px] z-10 flex gap-1 border-b px-5 py-2"
                    style="background: color-mix(in srgb, var(--theme-modal-bg) 70%, transparent); backdrop-filter: blur(8px); border-color: var(--theme-divider-border);"
                >
                    {#each charNames as name, i}
                        <button
                            onclick={() => {
                                charIndex = i
                            }}
                            class={[
                                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                                i === charIndex
                                    ? 'text-(--theme-accent-text)'
                                    : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/5'
                            ].join(' ')}
                            style={i === charIndex
                                ? 'background: color-mix(in srgb, var(--theme-accent-bg) 15%, transparent);'
                                : ''}
                        >
                            {#if img(charIcons[name])}<img
                                    src={img(charIcons[name])}
                                    alt={name}
                                    class="inline size-4 mr-1 rounded-full object-cover"
                                />{/if}{name}
                        </button>
                    {/each}
                </div>
                <div class="px-5 py-4">
                    {#if loading}
                        <div class="flex items-center justify-center py-16 text-sm text-(--theme-modal-text)/50">
                            加载中...
                        </div>
                    {:else if charData}
                        <div class="space-y-5">
                            <div class="flex items-center gap-3">
                                {#if img(charIcons[currentSlot.character ?? ''])}<img
                                        src={img(charIcons[currentSlot.character ?? ''])}
                                        alt=""
                                        class="size-10 rounded-md object-contain"
                                        style="background: var(--theme-input-bg);"
                                    />{/if}
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="text-base font-semibold">{currentSlot.character}</span>
                                    <span class="text-sm text-yellow-400">{'★'.repeat(charData.rarity)}</span>
                                    {#if img(elementIcons[charData.element])}<img
                                            src={img(elementIcons[charData.element])}
                                            alt={charData.element}
                                            class="size-4"
                                            title={charData.element}
                                        />{:else}
                                        <span
                                            class="rounded px-1.5 py-0.5 text-sm"
                                            style="background: var(--theme-input-bg);">{charData.element}</span
                                        >{/if}
                                    {#if img(weaponTypeIcons[charData.weaponType])}<img
                                            src={img(weaponTypeIcons[charData.weaponType])}
                                            alt={charData.weaponType}
                                            class="size-4 w-icon"
                                            title={charData.weaponType}
                                        />{:else}
                                        <span
                                            class="rounded px-1.5 py-0.5 text-sm"
                                            style="background: var(--theme-input-bg);">{charData.weaponType}</span
                                        >{/if}
                                </div>
                            </div>
                            <section>
                                <h3 class="mb-2 text-sm font-semibold tracking-wider text-(--theme-modal-text)/50">
                                    基础属性 (Lv90)
                                </h3>
                                <div class="grid grid-cols-4 gap-2">
                                    <div
                                        class="rounded-lg p-2.5 text-center"
                                        style="background: var(--theme-input-bg);"
                                    >
                                        <div class="text-sm text-(--theme-modal-text)/50">基础生命</div>
                                        <div class="mt-0.5 text-sm font-semibold tabular-nums">
                                            {charData.lv90BaseStats.hp}
                                        </div>
                                    </div>
                                    <div
                                        class="rounded-lg p-2.5 text-center"
                                        style="background: var(--theme-input-bg);"
                                    >
                                        <div class="text-sm text-(--theme-modal-text)/50">基础攻击</div>
                                        <div class="mt-0.5 text-sm font-semibold tabular-nums">
                                            {charData.lv90BaseStats.atk}
                                        </div>
                                    </div>
                                    <div
                                        class="rounded-lg p-2.5 text-center"
                                        style="background: var(--theme-input-bg);"
                                    >
                                        <div class="text-sm text-(--theme-modal-text)/50">基础防御</div>
                                        <div class="mt-0.5 text-sm font-semibold tabular-nums">
                                            {charData.lv90BaseStats.def}
                                        </div>
                                    </div>
                                    <div
                                        class="rounded-lg p-2.5 text-center"
                                        style="background: var(--theme-input-bg);"
                                    >
                                        <div class="text-sm text-(--theme-modal-text)/50">谐度破坏增幅</div>
                                        <div class="mt-0.5 text-sm font-semibold tabular-nums">
                                            {charData.lv90BaseStats.tuneBreakBoost}
                                        </div>
                                    </div>
                                </div>
                            </section>
                            {#if currentSlot.weapon}
                                <section>
                                    <h3 class="mb-2 text-sm font-semibold tracking-wider text-(--theme-modal-text)/50">
                                        武器
                                    </h3>
                                    <div class="rounded-lg p-3 space-y-2" style="background: var(--theme-input-bg);">
                                        <div class="flex items-center gap-2">
                                            {#if img(weaponIcons[currentSlot.weapon])}<img
                                                    src={img(weaponIcons[currentSlot.weapon])}
                                                    alt=""
                                                    class="size-8 rounded object-contain"
                                                    style="background: var(--theme-input-bg);"
                                                />{/if}
                                            <div>
                                                <div class="flex items-center gap-1.5 text-sm font-medium">
                                                    <span>{currentSlot.weapon}</span>{#if weaponData}<span
                                                            class="text-yellow-400 text-sm"
                                                            >{'★'.repeat(weaponData.rarity)}</span
                                                        >{/if}
                                                </div>
                                                {#if weaponData}
                                                    <div
                                                        class="text-sm text-(--theme-modal-text)/50 mt-0.5 flex items-center gap-2 flex-wrap"
                                                    >
                                                        <span>基础攻击</span>
                                                        <span class="text-(--theme-accent-text)"
                                                            >{weaponData.lv90BaseAtk}</span
                                                        >
                                                        <span class="text-(--theme-modal-text)/20">|</span>
                                                        <span>{weaponData.substat.name}</span>
                                                        <span class="text-(--theme-accent-text)"
                                                            >{fmtSubVal(weaponData.substat.value)}</span
                                                        >
                                                    </div>
                                                {/if}
                                            </div>
                                        </div>
                                        {#if weaponData}<div
                                                class="border-t pt-2 mt-2 text-sm text-(--theme-modal-text)/60 leading-relaxed"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                {@html rd(weaponData.effect.desc)}
                                            </div>{/if}
                                    </div>
                                </section>
                            {/if}
                            {#if currentSlot.echoes[0]?.name}
                                <section>
                                    <h3 class="mb-2 text-sm font-semibold tracking-wider text-(--theme-modal-text)/50">
                                        首位声骸
                                    </h3>
                                    <div class="rounded-lg p-3" style="background: var(--theme-input-bg);">
                                        <div class="flex items-center gap-2">
                                            {#if img(echoIcons[currentSlot.echoes[0].name])}<img
                                                    src={img(echoIcons[currentSlot.echoes[0].name])}
                                                    alt=""
                                                    class="size-8 rounded object-contain"
                                                    style="background: var(--theme-input-bg);"
                                                />{/if}
                                            <div class="text-sm font-medium">
                                                {currentSlot.echoes[0].name}<span
                                                    class="text-(--theme-modal-text)/50 ml-1"
                                                    >(C{currentSlot.echoes[0].cost})</span
                                                >{#if currentSlot.triggerSets.length > 0}<span
                                                        class="text-sm text-(--theme-accent-text) ml-1.5"
                                                        >[{currentSlot.triggerSets[0].name}]</span
                                                    >{/if}
                                            </div>
                                        </div>
                                        {#if echoSkillData}<div
                                                class="mt-2 text-sm text-(--theme-modal-text)/60 leading-relaxed border-t pt-2"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                {@html rd(echoSkillData.desc)}
                                            </div>{/if}
                                    </div>
                                </section>
                            {/if}
                            {#if setBonuses}
                                <section>
                                    <h3 class="mb-2 text-sm font-semibold tracking-wider text-(--theme-modal-text)/50">
                                        套装加成
                                    </h3>
                                    <div class="space-y-3">
                                        {#each setBonuses as set}
                                            <div class="rounded-lg p-3" style="background: var(--theme-input-bg);">
                                                <div class="flex items-center gap-2 mb-2">
                                                    {#if img(setIcons[set.name])}<img
                                                            src={img(setIcons[set.name])}
                                                            alt=""
                                                            class="size-6 rounded object-contain"
                                                            style="background: var(--theme-input-bg);"
                                                        />{/if}
                                                    <span class="text-sm font-medium">{set.name}</span>
                                                    <span class="text-sm text-(--theme-modal-text)/50"
                                                        >({set.pieces}件)</span
                                                    >
                                                </div>
                                                <div class="space-y-0.5">
                                                    {#each Object.entries(set.bonuses) as [pieces, desc]}
                                                        <div class="text-sm">
                                                            <span class="text-(--theme-accent-text) font-medium"
                                                                >{pieces}件套</span
                                                            ><span class="text-(--theme-modal-text)/70 ml-1"
                                                                >{@html rd(desc)}</span
                                                            >
                                                        </div>
                                                    {/each}
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                </section>
                            {/if}
                            <section class="border-t pt-4 mt-4" style="border-color: var(--theme-divider-border);">
                                <h3 class="mb-2 text-base font-semibold tracking-wider text-(--theme-modal-text)/50">
                                    技能
                                </h3>
                                <div class="space-y-3">
                                    {#each charData.skills as skill}
                                        <div
                                            class="rounded-lg border"
                                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                        >
                                            <div
                                                class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-(--theme-modal-text)"
                                            >
                                                <span
                                                    class="rounded px-1.5 py-0.5 text-sm text-(--theme-modal-text)/50"
                                                    style="background: color-mix(in srgb, var(--theme-modal-text) 8%, transparent);"
                                                    >{skill.type}</span
                                                >
                                                <span>{skill.name}</span>
                                            </div>
                                            <div
                                                class="border-t px-3 py-2 text-sm text-(--theme-modal-text)/60 leading-relaxed"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                {@html rd(skill.desc)}
                                            </div>
                                            {#if skill.values.length > 0}
                                                <div
                                                    class="border-t px-3 py-2 space-y-0.5"
                                                    style="border-color: var(--theme-divider-border);"
                                                >
                                                    {#each skill.values as [vname, vvalue, velement]}
                                                        <div
                                                            class="grid grid-cols-[1fr_auto_auto] gap-2 text-sm even:bg-[color-mix(in_srgb,var(--theme-modal-text)_5%,transparent)] px-1 py-0.5 text-(--theme-modal-text)/70"
                                                        >
                                                            <span class="text-(--theme-modal-text)/50 truncate"
                                                                >{vname}</span
                                                            >
                                                            <span class="tabular-nums whitespace-nowrap">{vvalue}</span>
                                                            {#if velement}
                                                                <span
                                                                    class="tabular-nums whitespace-nowrap"
                                                                    style="color: {ELEMENT_COLORS[velement] ??
                                                                        'var(--theme-modal-text)'}">{velement}</span
                                                                >
                                                            {/if}
                                                        </div>
                                                    {/each}
                                                </div>
                                            {/if}
                                        </div>
                                    {/each}
                                    {#each inherentSkills as skill}
                                        <div
                                            class="rounded-lg border"
                                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                        >
                                            <div
                                                class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-(--theme-modal-text)"
                                            >
                                                <span
                                                    class="rounded px-1.5 py-0.5 text-sm text-(--theme-modal-text)/50"
                                                    style="background: color-mix(in srgb, var(--theme-modal-text) 8%, transparent);"
                                                    >固有技能</span
                                                >
                                                <span>{skill.name}</span>
                                            </div>
                                            <div
                                                class="border-t px-3 py-2 text-sm text-(--theme-modal-text)/60 leading-relaxed"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                {@html rd(skill.desc)}
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </section>
                            {#if statAttrs.length > 0}
                                <section>
                                    <h3 class="mb-2 text-sm font-semibold tracking-wider text-(--theme-modal-text)/50">
                                        固有属性
                                    </h3>
                                    <div class="grid grid-cols-2 gap-2">
                                        {#each sortedStatAttrs as attr}
                                            <div class="rounded-lg p-2.5" style="background: var(--theme-input-bg);">
                                                <div class="text-sm text-(--theme-modal-text)/50">{attr.name}</div>
                                                {#if attr.desc}
                                                    <div
                                                        class="mt-0.5 text-sm font-semibold tabular-nums leading-relaxed"
                                                    >
                                                        {@html rd(attr.desc)}
                                                    </div>
                                                {/if}
                                            </div>
                                        {/each}
                                    </div>
                                </section>
                            {/if}
                            {#if charData.chains.length > 0}
                                <section class="border-t pt-4 mt-4" style="border-color: var(--theme-divider-border);">
                                    <h3
                                        class="mb-2 text-base font-semibold tracking-wider text-(--theme-modal-text)/50"
                                    >
                                        共鸣链
                                    </h3>
                                    <div class="space-y-3">
                                        {#each charData.chains as chain, i}
                                            <div
                                                class="rounded-lg border px-3 py-2"
                                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                            >
                                                <div class="flex items-center gap-2 text-sm font-medium">
                                                    <span class="text-sm text-(--theme-modal-text)/40">C{i + 1}</span
                                                    ><span>{chain.name}</span>
                                                </div>
                                                <div class="mt-1 text-sm text-(--theme-modal-text)/60 leading-relaxed">
                                                    {@html rd(chain.desc)}
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                </section>
                            {/if}
                        </div>
                    {:else}
                        <div class="flex items-center justify-center py-16 text-sm text-(--theme-modal-text)/40">
                            选择角色查看详情
                        </div>
                    {/if}
                </div>
                <div
                    class="sticky bottom-0 h-10 pointer-events-none"
                    style="background: linear-gradient(to top, var(--theme-modal-bg), transparent);"
                ></div>
            </div>
        </div>
    </div>
{/if}

{#if ctxShow}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-80" onclick={() => (ctxShow = false)} oncontextmenu={(e) => e.preventDefault()}>
        <div
            class="absolute min-w-36 rounded-lg border bg-(--theme-modal-bg) py-1 shadow-xl backdrop-blur-lg"
            style="border-color: var(--theme-divider-border); left: {ctxX}px; top: {ctxY}px;"
        >
            <button
                onclick={handleCopy}
                class="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left text-(--theme-modal-text) transition-colors hover:bg-(--theme-modal-text)/5"
                ><Icon icon="mdi:content-copy" class="size-3.5 shrink-0" /> 复制</button
            >
            {#if showBuffOption || showCustomHitOption}
                <div class="border-t my-1" style="border-color: var(--theme-divider-border);"></div>
            {/if}
            {#if showBuffOption}
                <button
                    onclick={handleCreateBuffFromSel}
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left text-(--theme-accent-text) transition-colors hover:bg-(--theme-modal-text)/5"
                    ><Icon icon="mdi:plus" class="size-3.5 shrink-0" /> 以此为名创建BUFF</button
                >
            {/if}
            {#if showCustomHitOption}
                <button
                    onclick={handleCreateCustomHit}
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left text-amber-400 transition-colors hover:bg-(--theme-modal-text)/5"
                    ><Icon icon="mdi:plus-circle-outline" class="size-3.5 shrink-0" /> 创建自定义直伤</button
                >
            {/if}
            <div class="border-t my-1" style="border-color: var(--theme-divider-border);"></div>
            <button
                onclick={handleScrollTop}
                class="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left text-(--theme-modal-text) transition-colors hover:bg-(--theme-modal-text)/5"
                ><Icon icon="mdi:arrow-up-bold-outline" class="size-3.5 shrink-0" /> 跳转到顶部</button
            >
            <button
                onclick={handleScrollBottom}
                class="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left text-(--theme-modal-text) transition-colors hover:bg-(--theme-modal-text)/5"
                ><Icon icon="mdi:arrow-down-bold-outline" class="size-3.5 shrink-0" /> 跳转到底部</button
            >
        </div>
    </div>
{/if}

<style>
    :global(.select-text) ::selection {
        background: var(--theme-modal-text);
        color: var(--theme-modal-bg);
    }
    :global(.rich-color-title) {
        color: var(--theme-layout-text);
        font-weight: 700;
    }
    :global(.rich-color-highlight) {
        color: #818cf8;
        font-weight: 600;
    }
    :global(.rich-color-ice) {
        color: #38bdf8;
    }
    :global(.rich-color-fire) {
        color: #fb923c;
    }
    :global(.rich-color-thunder) {
        color: #a78bfa;
    }
    :global(.rich-color-wind) {
        color: #34d399;
    }
    :global(.rich-color-light) {
        color: #facc15;
    }
    :global(.rich-color-dark) {
        color: #f472b6;
    }
    :global(.rich-size-xl) {
        font-size: 1.125rem;
    }
    :global(.rich-size-xs) {
        font-size: 0.625rem;
        opacity: 0.3;
    }
    :global(.rich-te) {
        color: #818cf8;
        border-bottom: 1px dashed #818cf8;
    }
    :global(.rich-highlight) {
        background: rgba(129, 140, 248, 0.15);
        padding: 0 0.25em;
        border-radius: 2px;
    }
    :global(.rich-num) {
        color: var(--theme-num, #ca8a04);
    }
    :global(.hide-scrollbar) {
        scrollbar-width: none;
        -ms-overflow-style: none;
    }
    :global(.hide-scrollbar::-webkit-scrollbar) {
        display: none;
    }
</style>
